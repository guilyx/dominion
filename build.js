// Bundles the game into a single self-contained HTML file (dist/index.html).
// That one file is the portable build: no server, no install, no network.
// Usage: node build.js [--out path]
const fs = require('fs');
const path = require('path');

// Resolve everything against the repo, not the shell's working directory, so
// the build works the same whether it is run from here, from npm or from CI.
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const outFile = outArg >= 0 && args[outArg + 1] ? path.resolve(args[outArg + 1]) : path.join(ROOT, 'dist', 'index.html');

const pkg = JSON.parse(read('package.json'));
const html = read('index.html');
const css = read('style.css');

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('No <script src> tags found in index.html');
const missing = scripts.filter((p) => !fs.existsSync(path.join(ROOT, p)));
if (missing.length) throw new Error('index.html references missing files: ' + missing.join(', '));

// Stamp the build so a player can tell which version they are running. The
// unbundled page has no stamp and reports itself as "dev".
const banner = `window.DOMINION_VERSION = ${JSON.stringify(pkg.version)};`;
const js = [banner, ...scripts.map(read)].join('\n;\n');

let out = html
  .replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
  .replace(/<script src="[^"]+"><\/script>\s*/g, '');
out = out.replace('</body>', '<script>\n' + js.replace(/<\/script>/g, '<\\/script>') + '\n</script>\n</body>');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(`wrote ${path.relative(process.cwd(), outFile) || outFile} — v${pkg.version}, ${Math.round(out.length / 1024)} KB, ${scripts.length} scripts inlined`);
