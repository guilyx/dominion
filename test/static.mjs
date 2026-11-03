// Static checks: every source file parses, the game's data tables agree with
// each other, and the bundler produces a genuinely self-contained page.
// No browser needed, so this runs in a second and gates every pull request.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// The one-line installers build asset names by hand, so they silently rot if a
// packaging target or its naming changes. Tie them back to the build config.
// Releases are cut by a script, not by hand, so the script and the changelog it
// edits have to stay in step with package.json.
console.log('\nThe release machinery works');
{
  const clPath = path.join(ROOT, 'CHANGELOG.md');
  const changelog = readFileSync(clPath, 'utf8');
  const pkg = JSON.parse(read('package.json'));

  check('the changelog has an [Unreleased] section', () => {
    assert(changelog.includes('## [Unreleased]\n'), 'CHANGELOG.md has no "## [Unreleased]" heading');
  });

  check('the changelog has a link for [Unreleased]', () => {
    assert(/^\[Unreleased\]: \S+$/m.test(changelog), 'no "[Unreleased]: <url>" link definition, so the bump script cannot update it');
  });

  check('the lockfile version matches package.json', () => {
    const lock = JSON.parse(read('package-lock.json'));
    eq(lock.version, pkg.version, 'package-lock.json root version');
    eq(lock.packages[''].version, pkg.version, 'package-lock.json packages[""] version');
  });

  // Run the real bump against throwaway copies: it must move all three files
  // together and leave the changelog parseable.
  check('a release can actually be cut', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'dominion-bump-'));
    try {
      mkdirSync(path.join(tmp, 'scripts', 'release'), { recursive: true });
      for (const f of ['package.json', 'package-lock.json', 'CHANGELOG.md']) copyFileSync(path.join(ROOT, f), path.join(tmp, f));
      copyFileSync(path.join(ROOT, 'scripts', 'release', 'bump.mjs'), path.join(tmp, 'scripts', 'release', 'bump.mjs'));

      // Seed an entry in the copy. Straight after a release [Unreleased] is
      // empty by design, and this check is about the machinery working, not
      // about whether there happens to be something to ship today — the next
      // check covers the empty case.
      const clTmp = path.join(tmp, 'CHANGELOG.md');
      writeFileSync(clTmp, readFileSync(clTmp, 'utf8').replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n\n- A seeded entry, so there is something to release.\n'));

      const out = execFileSync(process.execPath, ['scripts/release/bump.mjs', 'minor', '--date', '2026-01-31'],
        { cwd: tmp, encoding: 'utf8' }).trim();
      const [maj, min] = pkg.version.split('.').map(Number);
      eq(out, `${maj}.${min + 1}.0`, 'the printed version');

      const after = JSON.parse(readFileSync(path.join(tmp, 'package.json'), 'utf8'));
      eq(after.version, out, 'package.json was not bumped to');
      const lockAfter = JSON.parse(readFileSync(path.join(tmp, 'package-lock.json'), 'utf8'));
      eq(lockAfter.version, out, 'the lockfile was not bumped to');
      eq(lockAfter.packages[''].version, out, 'the lockfile package entry was not bumped to');

      const clAfter = readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
      assert(clAfter.includes(`## [${out}] - 2026-01-31`), 'the changelog has no dated section for the new version');
      assert(clAfter.includes('## [Unreleased]\n'), 'the changelog lost its [Unreleased] section');
      assert(new RegExp(`^\\[${out.replace(/\./g, '\\.')}\\]: \\S+$`, 'm').test(clAfter), 'the changelog has no link for the new version');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  check('it refuses to cut an empty release', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'dominion-empty-'));
    try {
      mkdirSync(path.join(tmp, 'scripts', 'release'), { recursive: true });
      for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(ROOT, f), path.join(tmp, f));
      copyFileSync(path.join(ROOT, 'scripts', 'release', 'bump.mjs'), path.join(tmp, 'scripts', 'release', 'bump.mjs'));
      writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [0.0.1] - 2020-01-01\n\n- old\n\n[Unreleased]: https://example.com/compare/v0.0.1...HEAD\n');
      let threw = false;
      try { execFileSync(process.execPath, ['scripts/release/bump.mjs', 'patch'], { cwd: tmp, stdio: 'pipe' }); }
      catch { threw = true; }
      assert(threw, 'the bump script cut a release with nothing under [Unreleased]');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  check('every file the release needs is actually tracked by git', () => {
    // `release/` in .gitignore once matched scripts/release/ too, so the bump
    // script was silently never committed.
    const needed = ['scripts/release/bump.mjs', 'CHANGELOG.md', '.github/workflows/release.yml', '.github/workflows/release-label.yml', 'install.sh', 'install.ps1'];
    for (const f of needed) {
      assert(existsSync(path.join(ROOT, f)), `${f} is missing`);
      let ignored = false;
      try { execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT, stdio: 'pipe' }); ignored = true; } catch { /* not ignored */ }
      assert(!ignored, `${f} is in .gitignore, so it would never reach the repository`);
    }
  });

  check('the release workflow accepts the labels the label check requires', () => {
    const rel = read('.github/workflows/release.yml');
    const lab = read('.github/workflows/release-label.yml');
    for (const part of ['major', 'minor', 'patch']) {
      assert(rel.includes(part), `release.yml never mentions "${part}"`);
      assert(lab.includes(`release:${part}`), `release-label.yml does not accept release:${part}`);
    }
    assert(lab.includes('release:none'), 'release-label.yml has no release:none for changes that ship nothing');
    assert(!existsSync(path.join(ROOT, 'release-please-config.json')), 'release-please config is still present alongside the label-driven release');
  });
}

console.log('\nThe installers agree with the packaging config');
{
  const build = JSON.parse(read('package.json')).build;
  const sh = read('install.sh');
  const ps = read('install.ps1');

  check('install.sh is valid POSIX shell', () => {
    execFileSync('sh', ['-n', path.join(ROOT, 'install.sh')], { stdio: 'pipe' });
  });

  check('install.ps1 has a balanced structure', () => {
    assert(ps.split('<#').length === ps.split('#>').length, 'unbalanced comment-help block');
    const stripped = ps.replace(/<#[\s\S]*?#>/g, '').replace(/"(?:[^"`]|`.)*"/g, '""')
      .replace(/'(?:[^']|'')*'/g, "''").replace(/#.*/g, '');
    for (const [o, c, name] of [['{', '}', 'braces'], ['(', ')', 'parens'], ['[', ']', 'brackets']]) {
      const n = stripped.split(o).length, m = stripped.split(c).length;
      assert(n === m, `unbalanced ${name} (${n - 1} vs ${m - 1})`);
    }
  });

  // electron-builder renames x64 per Linux target; everything else keeps its name.
  const archName = (target, arch) => (target === 'AppImage' && arch === 'x64') ? 'x86_64'
    : (target === 'deb' && arch === 'x64') ? 'amd64' : arch;
  const targetsOf = (os) => (build[os] && build[os].target) || [];

  check('install.sh offers every macOS archive the build produces', () => {
    for (const t of targetsOf('mac')) {
      if (t.target !== 'zip') continue;   // the script installs zips, not dmgs
      for (const arch of t.arch) assert(sh.includes(`mac-${arch}.zip`), `install.sh never downloads mac-${arch}.zip`);
    }
  });

  check('install.sh offers every Linux build it can install', () => {
    for (const t of targetsOf('linux')) {
      if (t.target !== 'AppImage') continue;  // deb needs a package manager, not this script
      for (const arch of t.arch) {
        const name = `linux-${archName('AppImage', arch)}.AppImage`;
        assert(sh.includes(name), `install.sh never downloads ${name}`);
      }
    }
  });

  check('install.ps1 names the Windows artifacts the build produces', () => {
    const expect = { nsis: build.nsis && build.nsis.artifactName, portable: build.portable && build.portable.artifactName };
    for (const [target, tpl] of Object.entries(expect)) {
      assert(tpl, `build.${target}.artifactName is not set, so its filename is unpredictable`);
      // Turn the electron-builder template into what the script should contain.
      const want = tpl.replace('${version}', '$Version').replace('${arch}', 'x64').replace('${ext}', 'exe');
      assert(ps.includes(want), `install.ps1 never downloads ${want}`);
    }
  });

  check('both installers point at this repository', () => {
    const pkgRepo = JSON.parse(read('package.json')).repository.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    assert(sh.includes(pkgRepo), `install.sh does not mention ${pkgRepo}`);
    assert(ps.includes(pkgRepo), `install.ps1 does not mention ${pkgRepo}`);
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


// ---------------------------------------------------------------------------
// The Pages workflow only rebuilds the site when a path in its filter changes.
// Anything the playable page is built from has to be in that list, or /play/
// quietly serves a stale build until something unrelated happens to touch it.
console.log('\nThe Pages workflow rebuilds when the game changes');
{
  const wf = read('.github/workflows/pages.yml');
  const filter = (wf.match(/paths:\n((?:\s+- '[^']+'\n|\s+#[^\n]*\n)+)/) || [, ''])[1];
  const globs = [...filter.matchAll(/- '([^']+)'/g)].map((m) => m[1]);
  const covered = (p) => globs.some((g) => (g.endsWith('/**') ? p.startsWith(g.slice(0, -2)) : g === p));

  check('the filter was parsed at all', () => assert(globs.length > 3, `only found ${globs.length} paths — the regex no longer matches`));

  // Everything index.html pulls in, which is exactly what the bundler inlines.
  const srcs = [...read('index.html').matchAll(/\s(?:src|href)="(?!https?:)([^"]+)"/g)].map((m) => m[1]);
  check('every file the game loads is covered', () => {
    assert(srcs.length > 10, `index.html only references ${srcs.length} local files — parsing went wrong`);
    const missing = srcs.filter((s) => !covered(s));
    assert(!missing.length, `a change to these would not republish the site: ${missing.join(', ')}`);
  });

  check('the version stamp and the bundler are covered', () => {
    for (const p of ['package.json', 'build.js', 'index.html'])
      assert(covered(p), `${p} is missing from the filter, so /play/ could go stale`);
  });

  check('the site sources are covered', () => {
    assert(covered('site/index.html'), 'site/** is missing from the filter');
  });
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll static checks passed\n');
process.exit(failures ? 1 : 0);