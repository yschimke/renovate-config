import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url)));

function allowed(packageName) {
  const rule = config.packageRules.findLast(r =>
    r.allowedVersions && (!r.matchPackageNames || r.matchPackageNames.includes(packageName)));
  return new RegExp(rule.allowedVersions.slice(1, -1));
}

// Renovate compiles `allowedVersions` regexes with RE2, which rejects lookaround: a rule
// written with `(?!...)` fails config validation and silently never applies.
test('allowedVersions regexes avoid lookaround, which RE2 rejects', () => {
  for (const rule of config.packageRules) {
    if (rule.allowedVersions?.startsWith('/')) {
      assert.doesNotMatch(rule.allowedVersions, /\(\?<?[=!]/, rule.allowedVersions);
    }
  }
});

test('ClassGraph stays below the Java 25 6.x line, without snapshots', () => {
  const re = allowed('io.github.classgraph:classgraph');
  for (const v of ['4.8.199', '5.0.0']) assert.match(v, re);
  for (const v of ['6.0.0', '4.8.200-SNAPSHOT']) assert.doesNotMatch(v, re);
});

test('compose-bom skips 2026.11 while preserving snapshot/compat exclusions', () => {
  const rule = config.packageRules.findLast(r =>
    r.allowedVersions && r.matchPackageNames?.includes('androidx.compose:compose-bom'));
  assert.ok(rule.allowedVersions.startsWith('!/'));
  const excluded = new RegExp(rule.allowedVersions.slice(2, -1));
  for (const v of ['2026.09.00', '2026.12.00', '2025.11.01']) assert.doesNotMatch(v, excluded);
  for (const v of ['2026.11.00', '2026.11.01', '2026.09.00-SNAPSHOT', '2026.09.00-compat']) {
    assert.match(v, excluded);
  }
});

test('Compose 1.13 core artifacts are skipped while preserving snapshot/compat exclusions', () => {
  const rule = config.packageRules.findLast(r =>
    r.allowedVersions &&
    r.matchPackageNames?.some(p => p.includes('androidx\\.compose\\.')));
  assert.ok(rule.allowedVersions.startsWith('!/'));
  const excluded = new RegExp(rule.allowedVersions.slice(2, -1));
  for (const v of ['1.12.1', '1.14.0', '1.5.0']) assert.doesNotMatch(v, excluded);
  for (const v of ['1.13.0', '1.13.1', '1.12.1-SNAPSHOT', '1.12.1-compat']) {
    assert.match(v, excluded);
  }
});

