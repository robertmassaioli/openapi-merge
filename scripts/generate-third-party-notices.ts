/**
 * Writes `dist/THIRD-PARTY-NOTICES.txt` for the CLI package.
 *
 * The CLI's `dist/index.js` is a bundle: commander, js-yaml, ajv, ajv-formats,
 * openapi-merge and their own dependencies are compiled into it. Every one is
 * MIT or BSD licensed, and both licences require the copyright notice to travel
 * with the code.
 *
 * Unbundled that happened for free -- each dependency shipped its own LICENSE
 * inside node_modules. Bundled it does not, so the notices must be collected at
 * build time and published in the tarball.
 *
 * See ai-planning/30-proposal-bundle-the-cli.md §4.4.
 */
import fs from 'fs';
import path from 'path';

const CLI_DIR = path.resolve(import.meta.dir, '..', 'packages', 'openapi-merge-cli');
const DIST_DIR = path.join(CLI_DIR, 'dist');
const SOURCE_MAP = path.join(DIST_DIR, 'index.js.map');
const OUTPUT = path.join(DIST_DIR, 'THIRD-PARTY-NOTICES.txt');

const LICENCE_FILENAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt',
  'license', 'license.md', 'LICENSE-MIT', 'LICENSE-MIT.txt',
];

type Notice = { name: string; version: string; licence: string; text: string | undefined };

/**
 * The bundled package list comes from the source map's `sources` array, not
 * from walking `dependencies` in package.json.
 *
 * Walking the declared graph was tried first and does not work here. Bun
 * installs into an isolated store -- `node_modules/.bun/<pkg>@<version>/node_modules/<pkg>`,
 * reached through symlinks -- so a Node-style walk up the `node_modules` chain
 * from a dependent's directory fails to resolve packages that are genuinely
 * installed and genuinely bundled. `jsonpointer`, pulled in by
 * `@atlassian/atlassian-openapi`, is exactly this case: the walk threw on it,
 * and it does appear in the finished bundle.
 *
 * The source map lists the real path of every file the bundler actually read.
 * That is precisely the set compiled into `index.js`, which is precisely the
 * set we are obliged to attribute -- no resolution guesswork, and it cannot
 * drift from the artifact because it is generated from it.
 */
function bundledPackageDirs(): string[] {
  if (!fs.existsSync(SOURCE_MAP)) {
    throw new Error(`${SOURCE_MAP} not found. 'build:bundle' must run before 'build:notices'.`);
  }

  const map = JSON.parse(fs.readFileSync(SOURCE_MAP, 'utf8')) as { sources?: string[] };
  const dirs = new Set<string>();

  for (const source of map.sources ?? []) {
    const marker = source.lastIndexOf('node_modules/');
    if (marker === -1) {
      continue; // our own source, or a workspace sibling
    }

    const after = source.slice(marker + 'node_modules/'.length);
    const segments = after.split('/');
    // A scoped package is two path segments, not one.
    const name = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
    if (name === undefined || name === '') {
      continue;
    }

    const absolute = path.resolve(DIST_DIR, source.slice(0, marker + 'node_modules/'.length) + name);
    if (fs.existsSync(path.join(absolute, 'package.json'))) {
      dirs.add(absolute);
    }
  }

  return [...dirs];
}

function findLicenceText(pkgDir: string): string | undefined {
  for (const filename of LICENCE_FILENAMES) {
    const candidate = path.join(pkgDir, filename);
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8').trim();
    }
  }
  return undefined;
}

const notices: Notice[] = bundledPackageDirs()
  .map(dir => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    return {
      name: String(pkg.name),
      version: String(pkg.version ?? '0.0.0'),
      licence: String(pkg.license ?? pkg.licenses ?? 'UNKNOWN'),
      text: findLicenceText(dir),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (notices.length === 0) {
  // Zero bundled packages means the source map was read but matched nothing --
  // far more likely a broken assumption here than a genuinely dependency-free
  // bundle. Publishing an empty notice file would be worse than not publishing.
  throw new Error(`No bundled packages found in ${SOURCE_MAP}. The source map format may have changed.`);
}

const header = [
  'THIRD PARTY NOTICES',
  '',
  'openapi-merge-cli publishes dist/index.js as a bundle, so the packages below',
  'are compiled into it rather than installed alongside it. Their licences are',
  'reproduced here in full, as those licences require.',
  '',
  `Generated at build time from the bundle's source map: ${notices.length} packages.`,
  '',
];

const body = notices.map(n => {
  const rule = '='.repeat(78);
  const text = n.text ?? `[No licence file in the published package; declared as ${n.licence}.]`;
  return `${rule}\n${n.name}@${n.version}  (${n.licence})\n${rule}\n\n${text}\n`;
});

fs.writeFileSync(OUTPUT, `${header.join('\n')}\n${body.join('\n')}`);

console.log(`Wrote dist/THIRD-PARTY-NOTICES.txt (${notices.length} bundled packages)`);
const missing = notices.filter(n => n.text === undefined);
if (missing.length > 0) {
  console.warn(`  warning: no licence file found for: ${missing.map(n => n.name).join(', ')}`);
}
