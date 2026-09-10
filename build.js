// Bundles the game into a single self-contained HTML file (dist/index.html).
// Usage: node build.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
let js = scripts.map((p) => fs.readFileSync(p, 'utf8')).join('\n;\n');
let out = html
  .replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
  .replace(/<script src="[^"]+"><\/script>\s*/g, '');
out = out.replace('</body>', '<script>\n' + js.replace(/<\/script>/g, '<\\/script>') + '\n</script>\n</body>');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'index.html'), out);
console.log('wrote dist/index.html (' + Math.round(out.length / 1024) + ' KB)');
