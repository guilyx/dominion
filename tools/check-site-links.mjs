// Checks that every internal link and asset in the built site resolves to a
// real file, and that every in-page anchor points at an id that exists.
// A broken link on a project page is the cheapest possible bug to prevent.
//
//     node tools/check-site-links.mjs _site
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '_site');
if (!existsSync(ROOT)) { console.error(`check-links: ${ROOT} does not exist — build the site first`); process.exit(1); }

// The game bundle under play/ is generated and full of inlined JavaScript, whose
// template literals look like attributes to a regex. It is checked separately
// at the bottom instead.
const GENERATED = path.join(ROOT, 'play');
const htmlFiles = [];
(function walk(dir) {
  if (dir === GENERATED) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
})(ROOT);

if (!htmlFiles.length) { console.error('check-links: no HTML files found'); process.exit(1); }

let problems = 0;
const referenced = new Set();
const fail = (file, msg) => { problems++; console.error(`  FAIL ${path.relative(ROOT, file)}: ${msg}`); };

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  for (const ref of refs) {
    if (/^(https?:|mailto:|data:|#$)/.test(ref)) continue;          // external or empty anchor

    if (ref.startsWith('#')) {                                       // in-page anchor
      const id = decodeURIComponent(ref.slice(1));
      if (!ids.has(id)) fail(file, `anchor ${ref} has no matching id`);
      continue;
    }

    const [rawPath, hash] = ref.split('#');
    let target = path.resolve(dir, decodeURIComponent(rawPath));
    referenced.add(target);
    if (!existsSync(target)) { fail(file, `${ref} -> missing ${path.relative(ROOT, target)}`); continue; }
    if (statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
      if (!existsSync(target)) { fail(file, `${ref} -> directory has no index.html`); continue; }
    }
    if (hash) {
      const targetIds = new Set([...readFileSync(target, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      if (!targetIds.has(decodeURIComponent(hash))) fail(file, `${ref} -> #${hash} does not exist there`);
    }
  }
}

// A screenshot nobody links to is dead weight in the repository and, more often,
// a sign that a figure was meant to be on a page and never made it.
const imgDir = path.join(ROOT, 'img');
if (existsSync(imgDir)) {
  for (const name of readdirSync(imgDir)) {
    const f = path.join(imgDir, name);
    if (!referenced.has(f)) { problems++; console.error(`  FAIL img/${name} is never referenced by any page`); }
  }
}

// The playable build has to actually be there, and be the real thing.
const game = path.join(ROOT, 'play', 'index.html');
if (!existsSync(game)) { problems++; console.error('  FAIL play/index.html is missing — the Play link goes nowhere'); }
else {
  const size = statSync(game).size;
  if (size < 400_000) { problems++; console.error(`  FAIL play/index.html is only ${size} bytes — the bundle did not inline`); }
  else if (!/DOMINION_VERSION/.test(readFileSync(game, 'utf8').slice(0, 200_000))) {
    problems++; console.error('  FAIL play/index.html is not a stamped Dominion build');
  }
}

console.log(problems
  ? `\ncheck-links: ${problems} problem(s) in ${htmlFiles.length} page(s)\n`
  : `check-links: ${htmlFiles.length} pages, every internal link and anchor resolves\n`);
process.exit(problems ? 1 : 0);
