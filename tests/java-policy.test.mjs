import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url)));
const javaPackages = [
  'java', 'java-jdk', 'java-jre', 'java?system=true',
  'java-jdk?os=linux&architecture=x64',
  'java-jre?os=linux&architecture=x64',
];

function matches(pattern, value) {
  return pattern.startsWith('/') && pattern.endsWith('/')
    ? new RegExp(pattern.slice(1, -1)).test(value)
    : pattern === value;
}

// Check the actual preset's Java-specific policy against Renovate dependency
// records. Other preset rules group dependencies and do not change `enabled`.
function enabled(datasource, packageName, updateType) {
  let result = true;
  for (const rule of config.packageRules) {
    if (!rule.matchDatasources?.includes(datasource)) continue;
    if (rule.matchPackageNames && !rule.matchPackageNames.some(p => matches(p, packageName))) continue;
    if (rule.matchUpdateTypes && !rule.matchUpdateTypes.includes(updateType)) continue;
    if (rule.enabled !== undefined) result = rule.enabled;
  }
  return result;
}

test('JDK and JRE major proposals require an explicit repository opt-in', () => {
  for (const name of javaPackages) {
    assert.equal(enabled('java-version', name, 'major'), false, name);
  }
});

test('Java maintenance and pin updates remain available', () => {
  for (const name of javaPackages) {
    for (const type of ['minor', 'patch', 'pin', 'digest']) {
      assert.equal(enabled('java-version', name, type), true, `${name} ${type}`);
    }
  }
});

test('the hold does not disable Java libraries, actions or image updates', () => {
  for (const [datasource, name] of [
    ['maven', 'io.github.classgraph:classgraph'],
    ['github-tags', 'actions/setup-java'],
    ['docker', 'eclipse-temurin'],
    ['java-version', 'unrelated-package'],
  ]) {
    assert.equal(enabled(datasource, name, 'major'), true, name);
  }
});
