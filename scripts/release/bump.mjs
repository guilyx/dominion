// Cut a release: bump the version everywhere it is written and date the changelog.
//
//     node scripts/release/bump.mjs patch|minor|major [--version X.Y.Z] [--date YYYY-MM-DD]
//
// Prints the new version on stdout, and nothing else, so the release workflow can
// read it. Run when a pull request labelled release:patch, release:minor or
// release:major merges into main. It refuses to release when `## [Unreleased]` in
// CHANGELOG.md has nothing under it, so an empty release cannot be cut by accident.
//
// What it changes:
//   * `version` in package.json;
//   * `version` and `packages[""].version` in package-lock.json — edited as JSON,
//     never by text replacement, because dependencies share version strings;
//   * CHANGELOG.md: the [Unreleased] entries become `## [X.Y.Z] - date` under a fresh
//     empty [Unreleased], and the compare links at the bottom follow.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_URL = 'https://github.com/guilyx/black_and_white';
const PARTS = ['major', 'minor', 'patch'];

const die = (msg) => { console.error(`bump: ${msg}`); process.exit(1); };

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
let part = null, explicit = null, date = new Date().toISOString().slice(0, 10);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--version') explicit = argv[++i];
  else if (a === '--date') date = argv[++i];
  else if (!part) part = a;
  else die(`unexpected argument "${a}"`);
}
if (explicit && !/^\d+\.\d+\.\d+$/.test(explicit)) die(`--version must look like 1.2.3, got "${explicit}"`);
if (!explicit && !PARTS.includes(part)) die(`first argument must be one of ${PARTS.join(', ')} (or pass --version X.Y.Z)`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must look like 2026-01-31, got "${date}"`);

const bumped = (version, which) => {
  const [major, minor, patch] = version.split('.').map(Number);
  if (which === 'major') return `${major + 1}.0.0`;
  if (which === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

// ------------------------------------------------------------------- versions
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const old = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(old || '')) die(`package.json has no usable version (got "${old}")`);

const next = explicit || bumped(old, part);
if (next === old) die(`the new version is the same as the old one (${old})`);

// ------------------------------------------------------------------ changelog
// Done first: if there is nothing to release, nothing else should have changed.
const clPath = path.join(ROOT, 'CHANGELOG.md');
let changelog;
try { changelog = readFileSync(clPath, 'utf8'); }
catch { die('CHANGELOG.md is missing'); }

const head = '## [Unreleased]\n';
const start = changelog.indexOf(head);
if (start < 0) die('CHANGELOG.md has no "## [Unreleased]" section');
const bodyStart = start + head.length;
const nextHeading = changelog.indexOf('\n## [', bodyStart);
const end = nextHeading < 0 ? changelog.length : nextHeading;
if (!changelog.slice(bodyStart, end).trim()) {
  die('CHANGELOG.md has nothing under [Unreleased]; there is nothing to release');
}

changelog = changelog.slice(0, bodyStart) + `\n## [${next}] - ${date}\n` + changelog.slice(bodyStart);

// Follow the compare links at the bottom. The first release has no previous tag to
// compare against, so it links to the tag itself.
const unreleasedLink = `[Unreleased]: ${REPO_URL}/compare/v${old}...HEAD`;
const newLinks = changelog.includes(unreleasedLink)
  ? `[Unreleased]: ${REPO_URL}/compare/v${next}...HEAD\n[${next}]: ${REPO_URL}/compare/v${old}...v${next}`
  : null;
if (newLinks) {
  changelog = changelog.replace(unreleasedLink, newLinks);
} else if (changelog.includes(`[Unreleased]: ${REPO_URL}/commits/main`)) {
  changelog = changelog.replace(
    `[Unreleased]: ${REPO_URL}/commits/main`,
    `[Unreleased]: ${REPO_URL}/compare/v${next}...HEAD\n[${next}]: ${REPO_URL}/releases/tag/v${next}`,
  );
} else {
  die('CHANGELOG.md has no [Unreleased] compare link at the bottom to update');
}
writeFileSync(clPath, changelog);

// ------------------------------------------------------------- package + lock
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const lockPath = path.join(ROOT, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
if (lock.version !== old || !lock.packages || lock.packages[''].version !== old) {
  die(`package-lock.json is out of step with package.json (lock says ${lock.version}, package says ${old}). Run npm install --package-lock-only.`);
}
lock.version = next;
lock.packages[''].version = next;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

process.stdout.write(next + '\n');
