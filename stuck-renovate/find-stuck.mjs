#!/usr/bin/env node
// Finds Renovate PRs that should have automerged but did not, across every
// repository of the owner whose Renovate config extends this preset, and writes
// a Markdown report (and JSON) that the `Stuck Renovate PRs` issue carries.
//
// Read-only and dependency-free. Needs GITHUB_TOKEN for the API rate limit; a
// workflow's default token reads public repositories, which is all it sees.
//
//   node stuck-renovate/find-stuck.mjs --owner yschimke --json out.json --markdown out.md
//   node stuck-renovate/find-stuck.mjs --repos m3-catalog,wear-m3-catalog   # skip the search

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Healthy flow with platformAutomerge: CI (≈30 min on the slowest repos) plus
// one Renovate run (≈hourly). Anything open longer than this is stuck.
export const DEFAULT_STALE_HOURS = 6;

const PRESET = 'yschimke/renovate-config';
const CONFIG_FILES = [
  'renovate.json', 'renovate.json5', '.github/renovate.json', '.github/renovate.json5',
  '.gitlab/renovate.json', '.gitlab/renovate.json5', '.renovaterc', '.renovaterc.json', '.renovaterc.json5',
];
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

/** Latest check run per name: a re-run leaves the earlier attempt in the list. */
export function latestChecks(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns) {
    const prev = byName.get(run.name);
    if (!prev || (run.started_at ?? '') > (prev.started_at ?? '') ||
        ((run.started_at ?? '') === (prev.started_at ?? '') && run.id > prev.id)) {
      byName.set(run.name, run);
    }
  }
  return byName;
}

/**
 * Why a Renovate PR is still open. Pure: takes the PR (REST shape), its head's
 * check runs, the base branch's required check names, and the current time.
 * Returns null for a PR that is not stuck yet.
 */
export function classify(pr, checkRuns, requiredChecks, now = new Date(), staleHours = DEFAULT_STALE_HOURS) {
  const ageHours = (now - new Date(pr.created_at)) / 36e5;
  if (ageHours < staleHours) return null;

  const body = pr.body ?? '';
  const automergeIntended = /\*\*Automerge\*\*: Enabled/.test(body);
  const checks = latestChecks(checkRuns);
  const failed = [...checks.values()].filter(c => c.status === 'completed' && FAILED.has(c.conclusion)).map(c => c.name);
  const pending = [...checks.values()].filter(c => c.status !== 'completed');
  const required = new Set(requiredChecks);
  const requiredFailed = failed.filter(n => required.has(n));
  const requiredMissing = requiredChecks.filter(n => !checks.has(n));
  // Without required checks Renovate merges itself, and waits for every check.
  const blockingFailed = required.size ? requiredFailed : failed;
  const blockingPending = required.size ? pending.filter(c => required.has(c.name)) : pending;
  // A run started recently (a rebase, a re-run) is CI doing its job, not a stuck PR.
  const isStale = c => (now - new Date(c.started_at ?? now)) / 36e5 >= staleHours;
  if (blockingPending.some(c => !isStale(c)) && !blockingFailed.length && !requiredMissing.length &&
      pr.mergeable_state !== 'dirty') {
    return null;
  }

  const reasons = [];
  if (pr.mergeable_state === 'dirty') reasons.push('conflict');
  // Renovate posts this as a comment once anyone else commits to its branch, and then never
  // automerges the PR itself.
  if (pr.renovateEdited || /Edited\/Blocked/.test(body)) reasons.push('renovate-blocked');
  if (blockingFailed.length) reasons.push('check-failed');
  if (requiredMissing.length) reasons.push('check-missing');
  if (blockingPending.some(isStale)) reasons.push('check-pending');
  if (!reasons.length) {
    if (!automergeIntended) reasons.push('manual-by-config');
    // Native auto-merge only where required checks gate it; elsewhere Renovate merges itself.
    else if (!pr.auto_merge && required.size) reasons.push('automerge-not-armed');
    else reasons.push('green-but-open');
  }

  return {
    repo: pr.base.repo.full_name,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    branch: pr.head.ref,
    createdAt: pr.created_at,
    ageHours: Math.round(ageHours),
    automergeIntended,
    autoMergeArmed: Boolean(pr.auto_merge),
    reasons,
    failed: blockingFailed,
    advisoryFailed: failed.filter(n => !blockingFailed.includes(n)),
    pending: pending.map(c => c.name),
    missing: requiredMissing,
  };
}

export function renderMarkdown(stuck, { generatedAt, staleHours, scanned, unreadable = [] }) {
  const lines = [
    '<!-- stuck-renovate-report -->',
    `Renovate PRs open longer than ${staleHours}h in repositories extending \`${PRESET}\`.`,
    `Generated ${generatedAt} from ${scanned} open Renovate PRs by [\`stuck-renovate/\`](../tree/main/stuck-renovate).`,
    '',
  ];
  if (unreadable.length) {
    lines.push(`Not readable with the workflow's token, so not checked: ${unreadable.join(', ')}.`, '');
  }
  if (!stuck.length) {
    lines.push('Nothing is stuck.');
    return lines.join('\n') + '\n';
  }
  const actionable = stuck.filter(s => !s.reasons.includes('manual-by-config'));
  const manual = stuck.filter(s => s.reasons.includes('manual-by-config'));
  const row = s => {
    const detail = [
      s.failed.length && `failed: ${s.failed.join(', ')}`,
      s.missing.length && `never reported: ${s.missing.join(', ')}`,
      s.pending.length && `pending: ${s.pending.join(', ')}`,
      s.advisoryFailed.length && `advisory red: ${s.advisoryFailed.join(', ')}`,
    ].filter(Boolean).join('; ');
    return `| [${s.repo}#${s.number}](${s.url}) | ${s.title.replace(/\|/g, '\\|')} | ${s.ageHours}h | \`${s.reasons.join('`, `')}\` | ${detail} |`;
  };
  const table = items => [
    '| PR | Title | Age | Reason | Detail |',
    '| --- | --- | --- | --- | --- |',
    ...items.map(row),
  ];
  if (actionable.length) {
    lines.push(`### Should have automerged (${actionable.length})`, '', ...table(actionable), '');
  }
  if (manual.length) {
    lines.push(`### Automerge off by config — waiting on a human (${manual.length})`, '', ...table(manual), '');
  }
  lines.push('<details><summary>JSON</summary>', '', '```json', JSON.stringify(stuck, null, 1), '```', '', '</details>');
  return lines.join('\n') + '\n';
}

async function main(argv) {
  const args = Object.fromEntries(argv.flatMap((a, i) => a.startsWith('--') ? [[a.slice(2), argv[i + 1]]] : []));
  const owner = args.owner ?? 'yschimke';
  const staleHours = Number(args['stale-hours'] ?? DEFAULT_STALE_HOURS);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  const api = async (path, { allow404 = false } = {}) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token && { authorization: `Bearer ${token}` }),
      },
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      throw Object.assign(new Error(`${res.status} ${path}: ${await res.text()}`), { status: res.status });
    }
    return res.json();
  };

  const prs = [];
  if (args.repos) {
    // Named repositories only, without the owner-wide search.
    for (const name of args.repos.split(',')) {
      const repo = name.includes('/') ? name : `${owner}/${name}`;
      const open = await api(`/repos/${repo}/pulls?state=open&per_page=100`);
      prs.push(...open
        .filter(p => p.user.login === 'renovate[bot]')
        .map(p => ({ number: p.number, repository_url: `https://api.github.com/repos/${repo}` })));
    }
  } else {
    for (let page = 1; ; page++) {
      const q = encodeURIComponent(`is:pr is:open archived:false author:app/renovate user:${owner}`);
      const res = await api(`/search/issues?q=${q}&per_page=100&page=${page}`);
      prs.push(...res.items);
      if (res.items.length < 100) break;
    }
  }

  const usesPreset = new Map();
  const required = new Map();
  const stuck = [];
  const unreadable = [];
  for (const item of prs) {
    const repo = item.repository_url.replace('https://api.github.com/repos/', '');
    if (!usesPreset.has(repo)) {
      let found = false;
      for (const file of CONFIG_FILES) {
        const content = await api(`/repos/${repo}/contents/${file}`, { allow404: true });
        if (content?.content) {
          found = Buffer.from(content.content, 'base64').toString('utf8').includes(PRESET);
          break;
        }
      }
      usesPreset.set(repo, found);
    }
    if (!usesPreset.get(repo)) continue;

    try {
      const result = await inspect(repo, item.number);
      if (result) stuck.push(result);
    } catch (e) {
      // The search lists PRs in repositories the token cannot read (a private repository and a
      // workflow's default token); one of those must not cost the report for all the others.
      if (e.status !== 403 && e.status !== 404) throw e;
      unreadable.push(`${repo}#${item.number}`);
    }
  }

  async function inspect(repo, number) {
    const pr = await api(`/repos/${repo}/pulls/${number}`);
    const comments = await api(`/repos/${repo}/issues/${number}/comments?per_page=100`);
    pr.renovateEdited = comments.some(c => c.user.login === 'renovate[bot]' && /Edited\/Blocked/.test(c.body));
    const key = `${repo}@${pr.base.ref}`;
    if (!required.has(key)) {
      const rules = await api(`/repos/${repo}/rules/branches/${encodeURIComponent(pr.base.ref)}`, { allow404: true }) ?? [];
      required.set(key, rules
        .filter(r => r.type === 'required_status_checks')
        .flatMap(r => r.parameters.required_status_checks.map(c => c.context)));
    }
    const runs = [];
    for (let page = 1; ; page++) {
      const res = await api(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100&page=${page}`);
      runs.push(...res.check_runs);
      if (res.check_runs.length < 100) break;
    }
    return classify(pr, runs, required.get(key), new Date(), staleHours);
  }

  stuck.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
  const scanned = prs.filter(p => usesPreset.get(p.repository_url.replace('https://api.github.com/repos/', ''))).length;
  const markdown = renderMarkdown(stuck, { generatedAt: new Date().toISOString(), staleHours, scanned, unreadable });
  if (args.json) writeFileSync(args.json, JSON.stringify(stuck, null, 2) + '\n');
  if (args.markdown) writeFileSync(args.markdown, markdown);
  if (!args.json && !args.markdown) process.stdout.write(markdown);
  console.error(`${stuck.length} stuck of ${scanned} open Renovate PRs in preset repositories`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
