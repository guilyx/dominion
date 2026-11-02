// Smoke test: loads the portable single-file build straight from disk (the
// same artifact the release ships), plays several minutes of simulated game
// time, opens every panel and round-trips a save. Any uncaught page error,
// failed assertion or panel that runs off the screen fails the run.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'test', 'screenshots');

// Prefer the project's own copy; fall back to a global install (NODE_PATH),
// so the test runs from a bare checkout as well as from CI.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
  catch {
    console.error('Playwright is not installed. Run:\n  npm install\n  npx playwright install --with-deps chromium');
    process.exit(1);
  }
}

// Always rebuild: testing a stale bundle would hide whatever the working tree
// actually changed.
const bundle = path.join(ROOT, 'dist', 'index.html');
execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'inherit' });
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
};

// Software rendering: CI runners have no GPU. DOMINION_CHROMIUM points the
// test at a Chromium that is already on the machine, so a container or a
// distro package can be reused instead of downloading another browser.
const browser = await chromium.launch({
  executablePath: process.env.DOMINION_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_(CERT|CONNECTION|NAME|INTERNET)/.test(m.text())) errors.push('console: ' + m.text()); });

try {
  console.log('\nBoot');
  await page.goto(pathToFileURL(bundle).href);
  await page.waitForSelector('#mm-new', { timeout: 30000 });
  check('the main menu renders', true);

  const version = await page.evaluate(() => window.DOMINION_VERSION);
  check('the build is version-stamped', !!version, `got ${JSON.stringify(version)}`);

  await page.click('#mm-new');
  await page.waitForSelector('#li-begin', { timeout: 30000 });
  await page.click('#li-begin');
  await page.waitForFunction(() => window.game && window.game.G && window.game.G.people.length > 0, { timeout: 30000 });
  check('a land generates and the tribe spawns', true);

  console.log('\nSimulation');
  const sim = await page.evaluate(() => {
    const g = window.game, G = g.G;
    try { for (let i = 0; i < 20 * 60 * 5; i++) g.simulate(1 / 20); }  // five minutes of game time
    catch (e) { return { error: e.message + '\n' + e.stack }; }
    const t = G.playerTown();
    return {
      time: Math.round(G.time), pop: G.god.pop, people: G.people.length, buildings: G.buildings.length,
      food: Math.round(t.food), wood: Math.round(t.wood), prayer: Math.round(G.god.prayer),
      enemies: G.enemyTowns().length, starved: G.god.deaths || 0,
    };
  });
  check('five minutes of simulation runs clean', !sim.error, sim.error);
  check('the tribe is still alive', sim.people > 0, JSON.stringify(sim));
  check('villagers are producing', sim.food > 0 || sim.wood > 0, JSON.stringify(sim));
  check('rival towns still exist', sim.enemies > 0, JSON.stringify(sim));
  console.log('       ' + JSON.stringify(sim));

  console.log('\nInterface');
  for (const [key, tab] of [['KeyB', 'build'], ['KeyM', 'miracles'], ['KeyC', 'creature'], ['KeyT', 'army'], ['KeyU', 'tribute'], ['KeyI', 'stats']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
    const m = await page.evaluate(() => {
      const p = document.getElementById('subpanel');
      const r = p.getBoundingClientRect();
      return { open: p.classList.contains('open'), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, content: p.textContent.trim().length };
    });
    check(`the ${tab} tab opens and fits the window`, m.open && m.top >= 0 && m.bottom <= m.vh + 1 && m.content > 20, JSON.stringify(m));
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }

  // Every build category must render its items.
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(400);
  const cats = await page.evaluate(async () => {
    const out = [];
    for (const chip of [...document.querySelectorAll('#subpanel [data-cat]')]) {
      chip.click();
      await new Promise((r) => setTimeout(r, 60));
      out.push({ id: chip.dataset.cat, items: document.querySelectorAll('#subpanel .item[data-kind]').length });
    }
    return out;
  });
  check('every build category lists buildings', cats.length >= 2 && cats.every((c) => c.items > 0), JSON.stringify(cats));
  await page.keyboard.press('KeyB');

  console.log('\nSave and load');
  const round = await page.evaluate(() => {
    const g = window.game;
    try {
      const before = { pop: g.G.people.length, buildings: g.G.buildings.length, time: Math.round(g.G.time) };
      g.save(true, '1');
      if (!g.listSaves().some((s) => s.slot === '1' && s.meta)) return { error: 'the save slot stayed empty' };
      g.load('1');
      return { before };
    } catch (e) { return { error: e.message + '\n' + e.stack }; }
  });
  check('a save round-trips', !round.error, round.error);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const g = window.game;
    try { for (let i = 0; i < 20 * 30; i++) g.simulate(1 / 20); }
    catch (e) { return { error: e.message + '\n' + e.stack }; }
    return { pop: g.G.people.length, buildings: g.G.buildings.length };
  });
  check('the game keeps running after a load', !after.error && after.pop > 0, JSON.stringify(after ?? {}) + (after.error || ''));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 5).join('\n       '));

  // A diagnostic, not an assertion: capturing a software-rendered WebGL canvas
  // can be slow on a CI runner, and a missing screenshot must not fail a run
  // whose checks all passed.
  try { await page.screenshot({ path: path.join(SHOTS, 'smoke.png'), timeout: 60000, animations: 'disabled' }); }
  catch (e) { console.log(`  note screenshot skipped (${e.message.split('\n')[0]})`); }
} catch (e) {
  failures++;
  console.error('\n  FAIL the run threw\n       ' + e.message);
  await page.screenshot({ path: path.join(SHOTS, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nSmoke test passed\n');
process.exit(failures ? 1 : 0);
