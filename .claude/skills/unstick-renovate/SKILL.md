---
name: unstick-renovate
description: Work through the "Stuck Renovate PRs" issue in yschimke/renovate-config and get every listed Renovate PR merged, fixed, or deliberately skipped. Use when a scheduled run or the user asks to fix stuck, red or unmerged Renovate PRs across the repositories that extend this preset.
---

# Unstick Renovate PRs

Every repository extending this preset automerges minor/patch/digest/pin updates, and the ones in
`repo-policy/policy.json` with required checks use `platformAutomerge`: GitHub merges the moment the
`Protect Main` required checks pass. A healthy Renovate PR is gone within a few hours. The
`Stuck Renovate PRs` workflow (`.github/workflows/stuck-renovate.yml`, every 3 hours) lists the
ones that are not in the issue labelled `stuck-renovate`. This skill clears that list.

Each stuck PR ends in exactly one of these outcomes, in order of preference:

1. **Land it** — a mechanical nudge, or a small fix pushed to the Renovate branch.
2. **Skip the version** — a `packageRules` entry, with a `description` saying why, so Renovate
   stops offering that version and closes the PR itself.
3. **Escalate** — it needs a person's decision; say exactly what and why on the tracking issue.

Never leave a PR untouched without one of those, and never merge with admin bypass, skip or
disable a test, or delete a check to get green.

## 1. Read the list

Read the open issue labelled `stuck-renovate` in `yschimke/renovate-config` (body = the latest
report; its JSON block has `repo`, `number`, `branch`, `reasons`, `failed`, `missing`). If it is
closed or says "Nothing is stuck", stop.

Work at most **5 PRs that need code changes** per run (mechanical nudges don't count); leave the
rest for the next run and say so. Work the oldest first.

For each PR, re-read its live state first (`pull_request_read` get + get_check_runs): the report
can be up to 3 hours old. Skip a PR that has merged, closed, or gone green and armed since.

Attach each repository you touch with `add_repo` (access `push`) and clone it shallowly as that
tool says. Read the repo's `AGENTS.md`/`CLAUDE.md` before changing anything in it.

## 2. Reason → action

| Reason | Meaning | Action |
| --- | --- | --- |
| `automerge-not-armed` | green, Renovate says automerge, the base has required checks, GitHub auto-merge is off | `enable_pr_auto_merge` (squash). Only reported where required checks gate the merge. |
| `green-but-open` | green but not merged: armed with required checks, or (no required checks) Renovate has not merged it itself | With required checks: check mergeability and the ruleset (a required check from a different app, an approval rule, an unresolved thread); fix the cause if it is in the PR, otherwise escalate — the ruleset is `repo-policy/`'s to change. Without required checks: **never** enable GitHub auto-merge (it would not wait for CI); tick the rebase box so Renovate re-evaluates, and check the Dependency Dashboard / Renovate log for why it held back. |
| `conflict` | Renovate rebases on conflict (`rebaseWhen: conflicted`) but has not | Tick the rebase box: edit the PR body replacing `- [ ] <!-- rebase-check -->` with `- [x] <!-- rebase-check -->`. If the body has `Edited/Blocked`, see below. |
| `renovate-blocked` | someone pushed to the branch, so Renovate stops updating it | If those commits are a fix still needed, finish the job (section 3). If the branch is just stale, tick the rebase box — Renovate then discards the edits and recreates it. |
| `check-missing` | a required check never reported | The workflow never ran for this head (a `paths:` filter, a missing trigger, a renamed job). Tick the rebase box once. If it still never reports, it is a repository bug: fix the workflow in that repository (separate PR) or escalate if the fix is the policy's. |
| `check-pending` | a required check has been queued/running for hours | Cancelled runner, stuck queue. Re-run the job once (`actions_run_trigger` `rerun_failed_jobs`, or `rerun_workflow_run`). |
| `check-failed` | a required (or, with no required checks, any) check is red | Section 3. |
| `manual-by-config` | automerge is deliberately off (majors, Compose Multiplatform, held groups) | Do not merge. If it is red, fix it like `check-failed` so the human sees a green PR. If green, list it in the summary as waiting on review and do nothing else. |

`advisoryFailed` checks (red but not required) do not block a `platformAutomerge` merge. Do not
work on them unless they are also the reason the required gate failed (e.g. compose-preview-server's
`gradle` gate fails when `visual-harness` fails).

## 3. A red check

Get the failed job logs (`get_job_logs` with `failed_only`). Decide which case it is:

**Not this update.** The same check is red on the base branch, or the job died before any test ran
(checkout, dependency download, runner lost), or the error names a service the update does not
touch. Re-run the failed jobs once. If it fails again identically and `main` is also red, that is
`main`'s problem: do not touch the Renovate PR; note it in the summary (and fix `main` only if the
fix is small and obvious, as its own PR).

**The update broke the build, and the fix is small** — an API rename or deprecation, a changed
default, a lockfile/golden/generated file to refresh, a formatter change, a test asserting the old
version. **Fix and land it**:

1. Clone the repository and check out the Renovate branch (`git fetch origin <branch> && git checkout <branch>`).
2. Reproduce the failure locally with the repository's own tooling — `build-brief ./gradlew …`, or the
   repo's launcher (e.g. `scripts/agent-gradle.sh`) if it ships one. Regenerate generated files with the
   repo's tasks, never by hand.
3. Make the minimal fix, run the failing check plus the repo's fast checks (format, lint, unit tests).
4. Commit with a Conventional Commit message (`fix(deps): adapt to <lib> <version> <what changed>`)
   and push to the Renovate branch. **No agent `Co-authored-by` trailer and no agent author identity**:
   these repositories reject agent attribution (`Reject agent attribution` is a required check).
   A `Claude-Session:` link trailer is fine.
5. Make sure GitHub auto-merge is still armed (`enable_pr_auto_merge` if not) — only in a
   repository whose base branch has required checks, and never on a `manual-by-config` PR.
6. `subscribe_pr_activity` on the PR, so a new CI failure wakes this session to finish it.

Renovate stops rebasing a branch someone else committed to. That is fine for a PR about to merge;
if a newer version supersedes it, Renovate opens a fresh branch.

**The update needs real work, or the version itself is bad** — a major migration, a new JVM or
toolchain floor, an upstream regression, a visual/behaviour change that needs a human eye, or a
fix that would spread across many files. **Skip the version**:

1. Add a `packageRules` entry to the repository's Renovate config (`renovate.json` or
   `.github/renovate.json`), appended **after** the existing rules — the last matching rule wins:

   ```json
   {
     "description": "<lib> <version> <what breaks>: <evidence, one or two sentences>. Skipped from <PR URL>. Remove when <condition: upstream fix released / migration done in #N>.",
     "matchPackageNames": ["<package or /regex/>"],
     "allowedVersions": "!/^(1\\.2\\.3|.*-SNAPSHOT|.*-compat)$/"
   }
   ```

   - One bad release: exclude exactly that version, so the next patch is still offered.
   - A whole line that needs migration: a ceiling, and say what the migration needs, like the
     ClassGraph and Java rules in compose-preview-server do. Prefer a positive regex that only
     matches releases (`"/^1\\.[0-9.]+$/"`) over a range (`"(,2.0.0)"`), which admits
     `1.9.0-SNAPSHOT`.
   - `allowedVersions` **replaces** the preset's `-SNAPSHOT` / `-compat` filters for the matched
     Gradle dependencies (README, "Versions that are never upgrades"), so a negated regex carries
     them in the same alternation, as above. Renovate's regexes are RE2: no lookahead.
   - Several repositories broken by the same upstream release: put the rule in this preset's
     `default.json` instead, once, and add a test case to `tests/` if it is policy-shaped.

2. Open a PR with that change against the repository's default branch (title
   `chore(renovate): skip <lib> <version>`), body linking the stuck PR and the failing log, and
   enable auto-merge on it. Renovate closes the stuck PR on its next run.
3. If a migration is worth doing later, open (or find) an issue for it and link it from the rule's
   description.

**Unclear which.** Escalate: one comment on the tracking issue naming the PR, the failing check, the
log excerpt that matters, and the two options with your recommendation. Leave the PR as is.

## 4. Report

Finish with one comment on the tracking issue summarising the run — one line per PR handled:
`<repo>#<n>: landed / fixed (<commit>) — waiting on CI / skipped <version> (<rule PR>) / re-ran / escalated: <question> / waiting on review (manual-by-config)`,
and which PRs were left for the next run. Do not close the issue: the workflow closes it when
nothing is stuck. End every GitHub comment with the Claude Code footer.
