import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url)));

function matchesPattern(pattern, packageName) {
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    return new RegExp(pattern.slice(1, -1)).test(packageName);
  }
  return pattern === packageName;
}

function resolvedGroup(packageName, manager = 'gradle') {
  let group = null;
  for (const rule of config.packageRules) {
    if (rule.matchManagers && !rule.matchManagers.includes(manager)) continue;
    if (rule.matchDatasources) continue;
    if (rule.matchUpdateTypes) continue;
    if (
      rule.matchPackageNames &&
      !rule.matchPackageNames.some(p => matchesPattern(p, packageName))
    ) {
      continue;
    }
    if ('groupName' in rule) {
      group = rule.groupName;
    }
  }
  return group;
}

test('each yschimke BOM resolves to its own release-train group', () => {
  const boms = [
    ['ee.schimke.composeai:compose-ai-tools-bom', 'compose-ai-tools'],
    ['ee.schimke.composeai:compose-preview-daemon-bom', 'compose-preview-daemon'],
    ['ee.schimke.composeai:compose-preview-contracts-bom', 'compose-preview-contracts'],
    ['ee.schimke.composeai:compose-preview-ui-builder-bom', 'compose-ui-builder'],
    ['ee.schimke.composeai:rc-players-bom', 'rc-players'],
    ['ee.schimke.composeai:livery-bom', 'livery'],
  ];
  for (const [coordinate, expectedGroup] of boms) {
    assert.equal(resolvedGroup(coordinate), expectedGroup, coordinate);
  }
});

test('plugins, actions and module prefixes stay with their own release trains', () => {
  const cases = [
    ['ee.schimke.composeai.preview', 'gradle', 'compose-ai-tools'],
    ['yschimke/compose-ai-tools', 'github-actions', 'compose-ai-tools'],
    ['ee.schimke.composeai:preview-discovery', 'gradle', 'compose-ai-tools'],
    ['ee.schimke.composeai:preview-annotations', 'gradle', 'compose-preview-daemon'],
    ['ee.schimke.composeai:data-remotecompose-connector', 'gradle', 'compose-preview-daemon'],
    ['ee.schimke.composeai:data-render-core', 'gradle', 'compose-preview-contracts'],
    ['ee.schimke.composeai:component-catalog-protocol', 'gradle', 'compose-preview-contracts'],
    ['ee.schimke.composeai:design-guidelines-protocol', 'gradle', 'compose-preview-contracts'],
    ['ee.schimke.composeai:compose-preview-ui-builder-runtime', 'gradle', 'compose-ui-builder'],
    ['ee.schimke.composeai:rc-player-compose', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:rc-widget-launcher', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:rc-widget-wear', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:rc-creation-bridge', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:third-party-rc-embedded-player', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:third-party-remote-creation-compose', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:third-party-remote-creation-writer', 'gradle', 'rc-players'],
    ['ee.schimke.composeai:livery-client', 'gradle', 'livery'],
    ['ee.schimke.composeai:livery-launcher-widgets', 'gradle', 'livery'],
    ['ee.schimke.composeai.livery.catalog', 'gradle', 'livery'],
    ['yschimke/livery', 'github-actions', 'livery'],
  ];
  for (const [pkg, manager, expectedGroup] of cases) {
    assert.equal(resolvedGroup(pkg, manager), expectedGroup, `${pkg} (${manager})`);
  }
});
