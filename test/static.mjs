// Static checks: every source file parses, the game's data tables agree with
// each other, and the bundler produces a genuinely self-contained page.
// No browser needed, so this runs in a second and gates every pull request.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${a}, expected ${b})`);

console.log('\nSource files parse');
const jsFiles = [
  ...readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
  'build.js', 'tools/serve.js', 'tools/make-icon.js', 'desktop/main.js',
].filter((f) => existsSync(path.join(ROOT, f)));
for (const f of jsFiles) check(f, () => new vm.Script(read(f), { filename: f }));

console.log('\nGame data is consistent');
// Run the namespace and the data table in a sandbox. Neither touches the DOM
// or Three.js, so a bare `window` is enough to load them.
const sandbox = { window: {}, console, Math, JSON, Date };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
new vm.Script(read('src/util.js'), { filename: 'util.js' }).runInContext(sandbox);
new vm.Script(read('src/data.js'), { filename: 'data.js' }).runInContext(sandbox);
const BW = sandbox.window.BW;

check('the data table loaded', () => assert(BW && BW.BUILDINGS, 'BW.BUILDINGS missing'));

const kinds = Object.keys(BW.BUILDINGS);

check('every build-menu entry is a real building', () => {
  const bad = BW.BUILD_ORDER.filter((k) => !BW.BUILDINGS[k]);
  assert(!bad.length, `BUILD_ORDER names unknown buildings: ${bad.join(', ')}`);
});

check('every building appears in the build menu', () => {
  const missing = kinds.filter((k) => !BW.BUILD_ORDER.includes(k));
  assert(!missing.length, `missing from BUILD_ORDER: ${missing.join(', ')}`);
});

check('every building sits in exactly one category', () => {
  const seen = new Map();
  for (const cat of BW.BUILD_CATEGORIES) {
    for (const k of cat.kinds) {
      assert(BW.BUILDINGS[k], `category "${cat.id}" names unknown building "${k}"`);
      assert(!seen.has(k), `"${k}" is in both "${seen.get(k)}" and "${cat.id}"`);
      seen.set(k, cat.id);
    }
  }
  const orphans = kinds.filter((k) => !seen.has(k));
  assert(!orphans.length, `no category holds: ${orphans.join(', ')}`);
});

check('category ids are unique', () => {
  const ids = BW.BUILD_CATEGORIES.map((c) => c.id);
  eq(new Set(ids).size, ids.length, 'duplicate category id');
});

check('every building has a name, cost and footprint', () => {
  for (const [k, d] of Object.entries(BW.BUILDINGS)) {
    assert(d.name, `${k} has no name`);
    assert(d.cost && typeof d.cost === 'object', `${k} has no cost`);
    for (const r of Object.keys(d.cost)) assert(BW.RESOURCES.includes(r), `${k} costs unknown resource "${r}"`);
    assert(d.w > 0 && d.d > 0, `${k} has no footprint`);
    assert(d.hp > 0, `${k} has no hp`);
    assert(d.buildTime > 0, `${k} has no buildTime`);
  }
});

check('every building has a render height', () => {
  const missing = kinds.filter((k) => BW.BUILDING_HEIGHT[k] === undefined);
  assert(!missing.length, `missing from BUILDING_HEIGHT: ${missing.join(', ')}`);
});

check('every era requirement points at a real era', () => {
  for (const [k, d] of Object.entries(BW.BUILDINGS)) {
    if (d.era === undefined) continue;
    assert(Number.isInteger(d.era) && d.era > 0 && d.era < BW.ERAS.length, `${k} wants era ${d.era}, which does not exist`);
  }
});

check('eras are ordered by rising insight', () => {
  for (let i = 1; i < BW.ERAS.length; i++) {
    assert(BW.ERAS[i].insight > BW.ERAS[i - 1].insight, `era "${BW.ERAS[i].name}" does not cost more insight than the one before`);
    assert(BW.ERAS[i].name, `era ${i} has no name`);
  }
  eq(BW.ERAS[0].insight, 0, 'the first era should cost no insight');
});

check('every referenced unlock exists', () => {
  const sources = [
    ...Object.entries(BW.BUILDINGS).map(([k, d]) => [`building ${k}`, d.unlock]),
    ...Object.entries(BW.MIRACLES).map(([k, d]) => [`miracle ${k}`, d.unlock]),
    ...Object.entries(BW.UNITS).map(([k, d]) => [`unit ${k}`, d.unlock]),
  ];
  for (const [who, u] of sources) if (u) assert(BW.UNLOCKS[u], `${who} needs unlock "${u}", which is not in UNLOCKS`);
});

check('worker jobs and slots line up', () => {
  for (const [kind, job] of Object.entries(BW.WORKER_JOB)) {
    assert(BW.BUILDINGS[kind], `WORKER_JOB names unknown building "${kind}"`);
    assert(BW.JOBS.includes(job), `"${kind}" employs unknown job "${job}"`);
    assert(BW.JOB_NAMES[job], `job "${job}" has no display name`);
    const slots = BW.WORKER_SLOTS[kind];
    assert(slots, `"${kind}" employs ${job} but has no WORKER_SLOTS`);
    eq(slots.length, BW.UPGRADE.maxLevel, `WORKER_SLOTS.${kind} needs one entry per level`);
    for (let i = 1; i < slots.length; i++) assert(slots[i] >= slots[i - 1], `WORKER_SLOTS.${kind} shrinks when upgraded`);
  }
  for (const kind of Object.keys(BW.WORKER_SLOTS)) assert(BW.WORKER_JOB[kind], `WORKER_SLOTS has "${kind}" but no job employs there`);
});

check('every job has a display name', () => {
  for (const j of BW.JOBS) assert(BW.JOB_NAMES[j], `job "${j}" has no display name`);
});

check('upgrade tables have one entry per level', () => {
  const n = BW.UPGRADE.maxLevel;
  for (const key of ['costMul', 'time', 'scale', 'capacity', 'storage', 'impress', 'yield', 'hp']) {
    eq(BW.UPGRADE[key].length, n, `UPGRADE.${key} should have ${n} entries`);
  }
  for (const k of BW.UPGRADABLE) assert(BW.BUILDINGS[k], `UPGRADABLE names unknown building "${k}"`);
});

check('adjacency rules name real buildings', () => {
  for (const [kind, rules] of Object.entries(BW.ADJACENCY)) {
    assert(BW.BUILDINGS[kind], `ADJACENCY names unknown building "${kind}"`);
    assert(typeof rules.cap === 'number', `ADJACENCY.${kind} has no cap`);
    for (const [other, v] of Object.entries(rules)) {
      if (other === 'cap') continue;
      assert(typeof v === 'number', `ADJACENCY.${kind}.${other} is not a number`);
      // "water" and "highGround" are terrain, "<kind>Town" is a town-wide wonder.
      if (other === 'water' || other === 'highGround') continue;
      const base = other.endsWith('Town') ? other.slice(0, -4) : other;
      assert(BW.BUILDINGS[base], `ADJACENCY.${kind} refers to unknown building "${base}"`);
    }
  }
});

check('every miracle is in the miracle menu, and vice versa', () => {
  const missing = Object.keys(BW.MIRACLES).filter((k) => !BW.MIRACLE_ORDER.includes(k));
  assert(!missing.length, `missing from MIRACLE_ORDER: ${missing.join(', ')}`);
  const unknown = BW.MIRACLE_ORDER.filter((k) => !BW.MIRACLES[k]);
  assert(!unknown.length, `MIRACLE_ORDER names unknown miracles: ${unknown.join(', ')}`);
});

check('every biome has a name and a growth rate', () => {
  for (const b of Object.keys(BW.BIOME_NAMES)) assert(BW.BIOME_GROWTH[b] !== undefined, `biome "${b}" has no growth rate`);
  for (const b of Object.keys(BW.BIOME_GROWTH)) assert(BW.BIOME_NAMES[b], `biome "${b}" has no display name`);
});

check('every skill rank is named', () => {
  assert(BW.SKILL_NAMES.length >= 2, 'SKILL_NAMES needs at least two ranks');
  for (const n of BW.SKILL_NAMES) assert(typeof n === 'string' && n, 'a skill rank has no name');
});

check('holy units cost something payable', () => {
  const payable = [...BW.RESOURCES, 'prayer'];
  for (const [k, u] of Object.entries(BW.HOLY_UNITS)) {
    assert(u.name, `holy unit "${k}" has no name`);
    assert(BW.JOBS.includes(k), `holy unit "${k}" is not a job`);
    for (const r of Object.keys(u.cost)) assert(payable.includes(r), `${k} costs unknown "${r}"`);
  }
});

check('every campaign land is playable', () => {
  for (const land of BW.LANDS) {
    assert(land.name && land.seed && land.size > 0, `land "${land.name}" is incomplete`);
    assert(land.enemies.length >= 1, `land "${land.name}" has no rivals`);
    assert(land.objectives.length >= 1, `land "${land.name}" has no objectives`);
    for (const e of land.enemies) assert(BW.TRIBE_NAMES.includes(e.name), `land "${land.name}" has unknown tribe "${e.name}"`);
  }
});

// electron-builder only validates its config when it runs, which costs minutes.
// Checking the keys against its own shipped schema costs nothing and catches an
// unknown or misplaced option straight away. Skipped on a bare checkout.
console.log('\nThe packaging config matches electron-builder\'s schema');
let scheme = null;
try { scheme = createRequire(import.meta.url)('app-builder-lib/scheme.json'); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; /* bare checkout: no devDependencies */ }
if (!scheme) {
  console.log('  skip app-builder-lib is not installed (run npm install to enable)');
} else {
  const build = JSON.parse(read('package.json')).build;
  const SECTIONS = {
    linux: 'LinuxConfiguration', win: 'WindowsConfiguration', mac: 'MacConfiguration',
    nsis: 'NsisOptions', portable: 'PortableOptions',
  };
  for (const [key, defName] of Object.entries(SECTIONS)) {
    if (!build[key]) continue;
    check(`build.${key} uses only known options`, () => {
      const def = scheme.definitions[defName];
      assert(def && def.properties, `electron-builder has no schema for ${defName}`);
      const unknown = Object.keys(build[key]).filter((k) => !(k in def.properties));
      assert(!unknown.length, `unknown option(s) for ${defName}: ${unknown.join(', ')}`);
    });
  }
  check('the Windows installer and portable build have distinct names', () => {
    const a = (build.nsis || {}).artifactName, b = (build.portable || {}).artifactName;
    if (!a && !b) return;
    assert(a !== b, 'nsis and portable would write to the same filename and overwrite each other');
  });
}

console.log('\nThe portable build is self-contained');
const out = path.join(ROOT, 'dist', 'test-bundle.html');
execFileSync(process.execPath, [path.join(ROOT, 'build.js'), '--out', out], { stdio: 'pipe' });
const bundle = readFileSync(out, 'utf8');
const pkg = JSON.parse(read('package.json'));

check('no external script or stylesheet is left behind', () => {
  assert(!/<script[^>]+\ssrc=/.test(bundle), 'the bundle still loads an external script');
  assert(!/<link[^>]+stylesheet[^>]*href="(?!https:\/\/fonts\.googleapis)/.test(bundle), 'the bundle still loads a local stylesheet');
});
check('every source file made it in', () => {
  for (const f of jsFiles.filter((f) => f.startsWith('src/'))) {
    const marker = read(f).split('\n').find((l) => l.startsWith('// ') && l.length > 10);
    if (marker) assert(bundle.includes(marker.trim()), `${f} is missing from the bundle`);
  }
});
check('the build is stamped with the package version', () => {
  assert(bundle.includes(`window.DOMINION_VERSION = "${pkg.version}"`), `bundle is not stamped with v${pkg.version}`);
});
check('the bundle is a plausible size', () => {
  assert(bundle.length > 400_000, `bundle is only ${bundle.length} bytes — something did not inline`);
});

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll static checks passed\n');
process.exit(failures ? 1 : 0);
