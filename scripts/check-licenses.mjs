/**
 * AGPL-3.0 dependency license gate.
 *
 * Walks `node_modules` directly instead of using `license-checker`, because
 * that tool does not understand npm workspaces (it reports zero packages for a
 * workspace root). Fails when any installed package carries a license that
 * cannot be distributed under AGPL-3.0 — GPL-2.0, SSPL, BSL, Elastic, "free for
 * now", proprietary, unknown, or missing. Runs in CI on every push; there is no
 * manual override, because one incompatible dependency silently voids the
 * license promise the project is built on.
 *
 * Scanning the whole tree (including devDependencies) is intentional: anything
 * that can enter a build or a vendored checkout gets reviewed, which errs on
 * the safe side.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = join(ROOT, 'node_modules');

/** Own workspace packages — AGPL by declaration, no need to re-review each time. */
const OWN_SCOPE = '@ycomm/';

/**
 * Licenses combinable with an AGPL-3.0 distribution.
 * The dangerous cases are listed explicitly below the allow-list so the intent
 * of every exclusion is visible.
 */
const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  // Zero-clause MIT (public-domain dedication) — compatible and even less
  // restrictive than MIT; used by nodemailer.
  'MIT-0',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'PostgreSQL',
  'Zlib',
  'X11',
  'WTFPL',
  'Artistic-2.0',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  // Data tables (browserslist/spdx) shipped under Creative Commons — attribution
  // satisfied by the packages' own notices, so redistribution under AGPL is fine.
  'CC-BY-3.0',
  'CC-BY-4.0',
]);

const EXPLICITLY_DENIED = [
  'GPL-2.0', // NOT compatible with AGPL-3.0 (different copyleft generations)
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'SSPL-1.0',
  'BSL-1.1',
  'Elastic-2.0',
  'Commons-Clause',
  'SEE LICENSE IN',
  'UNLICENSED',
  'UNKNOWN',
  'PROPRIETARY',
];

function normalizeLicense(value) {
  let raw;
  if (Array.isArray(value)) raw = value.join(';');
  else if (typeof value === 'object' && value !== null && typeof value.type === 'string')
    raw = value.type; // old npm format: { "type": "MIT" }
  else if (typeof value === 'string') raw = value;
  else raw = 'UNKNOWN';

  return raw
    .replace(/\*/g, '')
    .replace(/\(([^)]*)\)/g, '$1')
    .split(/;|\s+OR\s+|\s+AND\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Recursively collect all installable packages, following workspace symlinks is unnecessary. */
function collectPackages() {
  const found = new Map();
  const queue = [NODE_MODULES];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!existsSync(current)) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name.startsWith('.')) continue;
      const fullPath = join(current, entry.name);

      // Scoped folder: descend into @scope/name.
      if (entry.isDirectory() && entry.name.startsWith('@')) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isDirectory()) continue;

      const manifestPath = join(fullPath, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue; // broken manifest — not our license problem
      }

      const name = manifest.name;
      if (typeof name !== 'string' || name.startsWith(OWN_SCOPE)) continue;
      if (!found.has(name)) found.set(name, { name, licenses: normalizeLicense(manifest.license) });
    }
  }

  return [...found.values()];
}

function main() {
  const packages = collectPackages();
  const violations = [];

  for (const pkg of packages) {
    if (pkg.licenses.length === 0) {
      violations.push(`  - ${pkg.name}: no license declared`);
      continue;
    }
    for (const license of pkg.licenses) {
      if (EXPLICITLY_DENIED.includes(license)) {
        violations.push(`  - ${pkg.name}: license "${license}" is incompatible with AGPL-3.0`);
      } else if (!ALLOWED.has(license)) {
        violations.push(`  - ${pkg.name}: unrecognized license "${license}" — review and allow-list it`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`Dependency license check FAILED (${violations.length}):`);
    for (const violation of violations) console.error(violation);
    console.error('\nFix by replacing the dependency or dropping it from the tree.');
    process.exit(1);
  }

  console.log(`license check OK — ${packages.length} installed packages all AGPL-compatible`);
}

main();