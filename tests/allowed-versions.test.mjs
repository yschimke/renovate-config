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

