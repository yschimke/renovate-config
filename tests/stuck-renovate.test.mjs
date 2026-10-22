import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, latestChecks, renderMarkdown } from '../stuck-renovate/find-stuck.mjs';

const now = new Date('2026-10-22T20:00:00Z');
const AUTOMERGE = '🚦 **Automerge**: Enabled.';
const MANUAL = '🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.';

function pr(overrides = {}) {
  return {
    number: 1795,
    title: 'fix(deps): update dependency x to v2',
    html_url: 'https://github.com/yschimke/r/pull/1795',
    created_at: '2026-10-22T10:00:00Z',
    body: AUTOMERGE,
    mergeable_state: 'blocked',
    auto_merge: { merge_method: 'squash' },
    head: { ref: 'renovate/x', sha: 'abc' },
    base: { ref: 'main', repo: { full_name: 'yschimke/r' } },
    ...overrides,
  };
}

const run = (name, conclusion, started_at = '2026-10-22T10:05:00Z', id = 1) =>
  ({ id, name, started_at, status: conclusion ? 'completed' : 'in_progress', conclusion });

test('a young PR is not stuck yet', () => {
  assert.equal(classify(pr({ created_at: '2026-10-22T17:00:00Z' }), [], ['gradle'], now), null);
});

test('only the latest attempt of a check counts', () => {
  const checks = latestChecks([
    run('gradle', 'failure', '2026-10-22T10:05:00Z', 1),
    run('gradle', 'success', '2026-10-22T11:05:00Z', 2),
  ]);
  assert.equal(checks.get('gradle').conclusion, 'success');
});

test('a failed required check is the reason; a red advisory check is only reported', () => {
  const result = classify(pr(), [run('gradle', 'failure'), run('visual-harness', 'failure')], ['gradle'], now);
  assert.deepEqual(result.reasons, ['check-failed']);
  assert.deepEqual(result.failed, ['gradle']);
  assert.deepEqual(result.advisoryFailed, ['visual-harness']);
});

test('without required checks any red check blocks Renovate-managed automerge', () => {
  const result = classify(pr({ auto_merge: null }), [run('lint', 'failure')], [], now);
  assert.deepEqual(result.reasons, ['check-failed']);
});

test('a required check that never reported is flagged', () => {
  const result = classify(pr(), [run('gradle', 'success')], ['gradle', 'Conventional Commit title'], now);
  assert.deepEqual(result.reasons, ['check-missing']);
  assert.deepEqual(result.missing, ['Conventional Commit title']);
});

test('a pending check counts only once it has itself been running for hours', () => {
  const fresh = run('gradle', null, '2026-10-22T19:30:00Z');
  const stale = run('gradle', null, '2026-10-22T11:00:00Z');
  assert.equal(classify(pr(), [fresh], ['gradle'], now), null);
  assert.deepEqual(classify(pr(), [stale], ['gradle'], now).reasons, ['check-pending']);
});

test('conflicts and edited branches are reported', () => {
  const result = classify(pr({ mergeable_state: 'dirty', body: `${AUTOMERGE}\n### ⚠ Edited/Blocked Notification` }), [], [], now);
  assert.deepEqual(result.reasons, ['conflict', 'renovate-blocked']);
});

test('green PRs split by why they did not merge', () => {
  const green = [run('gradle', 'success')];
  assert.deepEqual(classify(pr({ auto_merge: null }), green, ['gradle'], now).reasons, ['automerge-not-armed']);
  assert.deepEqual(classify(pr(), green, ['gradle'], now).reasons, ['green-but-open']);
  assert.deepEqual(classify(pr({ body: MANUAL, auto_merge: null }), green, ['gradle'], now).reasons, ['manual-by-config']);
  // No required checks: Renovate merges itself, so native auto-merge is never expected.
  assert.deepEqual(classify(pr({ auto_merge: null }), green, [], now).reasons, ['green-but-open']);
});

test('the report separates PRs a human is meant to merge', () => {
  const stuck = [
    classify(pr(), [run('gradle', 'failure')], ['gradle'], now),
    classify(pr({ number: 7, body: MANUAL, auto_merge: null }), [run('gradle', 'success')], ['gradle'], now),
  ];
  const md = renderMarkdown(stuck, { generatedAt: now.toISOString(), staleHours: 6, scanned: 9 });
  assert.match(md, /### Should have automerged \(1\)/);
  assert.match(md, /### Automerge off by config — waiting on a human \(1\)/);
  assert.match(md, /failed: gradle/);
  assert.match(renderMarkdown([], { generatedAt: '', staleHours: 6, scanned: 0 }), /Nothing is stuck\./);
});
