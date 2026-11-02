// Desktop test: launches the *packaged* Electron app (not the source tree),
// confirms it loads the bundled game, that the renderer has no Node access,
// that saves can be written, and that a land actually plays.
// Run `npm run dist:dir` first. On Linux this needs a display (use xvfb-run).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'test', 'screenshots');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let electron;
try { ({ _electron: electron } = await import('playwright')); }
catch {
  try { ({ _electron: electron } = createRequire(import.meta.url)('playwright')); }
  catch { console.error('Playwright is not installed. Run: npm install'); process.exit(1); }
}

// electron-builder names the unpacked directory per platform.
const CANDIDATES = {
  linux: ['linux-unpacked/dominion', 'linux-arm64-unpacked/dominion'],
  win32: ['win-unpacked/Dominion.exe'],
  darwin: ['mac/Dominion.app/Contents/MacOS/Dominion', 'mac-arm64/Dominion.app/Contents/MacOS/Dominion'],
}[process.platform] || [];

const exe = CANDIDATES.map((c) => path.join(ROOT, 'release', c)).find((p) => existsSync(p));
if (!exe) {
  console.error(`No packaged app found under release/ for ${process.platform}.\nRun "npm run dist:dir" first.`);
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
};

console.log(`\nPackaged app: ${path.relative(ROOT, exe)}`);
const app = await electron.launch({
  executablePath: exe,
  // Container and CI runners have no GPU and no usable sandbox.
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const win = await app.firstWindow();
  await win.waitForSelector('#mm-new', { timeout: 90000 });
  check('the app opens a window with the main menu', true);

  const info = await win.evaluate(() => ({
    title: document.title,
    version: window.DOMINION_VERSION,
    three: typeof THREE !== 'undefined',
    nodeExposed: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
    storage: (() => { try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); return true; } catch { return false; } })(),
  }));
  check('it loads the bundled game', info.three && /Dominion/i.test(info.title), JSON.stringify(info));
  check('it reports the packaged version', info.version === pkg.version, `got ${info.version}, expected ${pkg.version}`);
  check('the renderer has no Node access', info.nodeExposed === false, 'window.require or window.process is exposed to the game');
  check('saves can be written', info.storage === true, 'localStorage is unavailable, so the game could not save');

  await win.click('#mm-new');
  await win.waitForSelector('#li-begin', { timeout: 90000 });
  await win.click('#li-begin');
  await win.waitForFunction(() => window.game && window.game.G && window.game.G.people.length > 0, { timeout: 90000 });

  const played = await win.evaluate(() => {
    try { for (let i = 0; i < 600; i++) window.game.simulate(0.1); }
    catch (e) { return { error: e.message }; }
    const G = window.game.G;
    return { people: G.people.length, buildings: G.buildings.length };
  });
  check('a land generates and plays', !played.error && played.people > 0 && played.buildings > 0, JSON.stringify(played));
  console.log('       ' + JSON.stringify(played));

  // Diagnostic only; see the note in smoke.mjs.
  try { await win.screenshot({ path: path.join(SHOTS, 'desktop.png'), timeout: 60000, animations: 'disabled' }); }
  catch (e) { console.log(`  note screenshot skipped (${e.message.split('\n')[0]})`); }
} catch (e) {
  failures++;
  console.error('\n  FAIL the run threw\n       ' + e.message);
} finally {
  await app.close().catch(() => {});
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nDesktop test passed\n');
process.exit(failures ? 1 : 0);
