# repo-policy

One merge policy for every repository that extends this Renovate preset, applied from
[`policy.json`](policy.json) by [`apply-repo-policy.sh`](apply-repo-policy.sh). It replaces the
per-repository `scripts/setup-repo-protection.sh` copies the catalog repositories used to carry.

```sh
./apply-repo-policy.sh                        # read-only: print drift, exit 1 if any
./apply-repo-policy.sh --apply                # converge every repository
./apply-repo-policy.sh --apply m3-catalog     # or just some
```

It needs `gh` logged in as the owner (or a fine-grained PAT with **Administration: read/write**).
No workflow can run it: a default `GITHUB_TOKEN` cannot administer other repositories, and the
check-only mode is what to re-run after anyone changes a setting in the GitHub UI.

## What every repository gets

**Repository settings**

| Setting | Value | Why |
| --- | --- | --- |
| Merge methods | squash only | one commit per PR on `main`; release-please reads them |
| Squash title / body | `PR_TITLE` / `BLANK` | the PR title is the commit headline even for a one-commit PR, so the `Conventional Commit title` check validates what actually lands; a blank body keeps branch `Co-authored-by:` trailers off `main` |
| Auto-merge | on | lets GitHub-native auto-merge be used |
| Delete branch on merge, update-branch button | on | |
| Actions `GITHUB_TOKEN` default | read-only | every job declares the permissions it needs; a write default hands them to jobs that never asked |
| Actions may create and approve PRs | on | release-please and the generated-file refreshes open PRs with `GITHUB_TOKEN`; with 0 required approvals, approving grants nothing extra |

**The `Protect Main` ruleset**, on the default branch:

- no deletion, no force-push (`non_fast_forward`);
- a pull request is required (0 approvals — single maintainer), squash the only allowed method;
- the repository's checks from `policy.json` are required, pinned to the GitHub Actions app so
  no other integration can satisfy one by reporting the same name;
- **admin bypass in `always` mode**: an admin can land a PR whose checks are red or pending
  ("Merge without waiting for requirements to be met", the GitHub mobile app's merge button, or
  `gh pr merge <n> --squash --admin`). Every bypass is recorded in the repository's rule insights.

  `always` rather than `pull_request` is deliberate. `pull_request` ("For pull requests only")
  would also stop an admin pushing or force-pushing to `main`, but GitHub then reports
  `viewerCanMergeAsAdmin: false`, and neither the mobile app nor `gh pr merge` offers the bypass —
  only the merge box on github.com does ([cli/cli#13388](https://github.com/cli/cli/issues/13388)).
  `exempt` keeps mobile merging but skips the rules silently, with no bypass audit entry, so it
  is not used. The cost of `always`: an admin's direct or force push to `main` is not blocked.

**The `Protect long-lived branches` ruleset**, on the non-default branches listed under
`long_lived_branches` in `policy.json`: deletion is blocked and nothing else. These are preview
baselines (`preview/*`, `compose-preview/*`), design records, the Wear Compose port lane
(`wear-compose-cmp`) and, in the `-out` repositories, every generated branch except `agent/**/*` (any depth).
The workflows that write them force-push (a `design-artifacts/*` branch is rewritten on every
republish), so a force-push rule would break them. No workflow in compose-ai-tools or the
design-parity driver deletes a branch. Per-PR branches (`ui-builder-designs/pr-N`) are left out.

**Other branches developed through pull requests** (`branch_rulesets`, e.g. wear-m3-catalog's
`wear-compose-cmp` port lane) get the same ruleset as `main`, named `Protect <branch>` and
scoped to that branch. `Protect Main` covers only the default branch, so without this a pull
request into such a branch has no required checks at all.

## Choosing required checks

Required checks are each repository's **build and unit-test jobs** (`repos` in `policy.json`),
plus the two **common checks** every repository carries: `Conventional Commit title` (squash
merges use the PR title as the commit headline) and `Reject agent attribution`. Lint, format,
render and visual-diff jobs still run and show red on a PR, but they do not block merging.

A common check is required on a branch only once that branch's workflow declares the job, so
landing the workflow and requiring the check never have to be ordered by hand: re-run the
script after the workflow merges. Until then the check is reported as `pending`, not drift.


A required check must **report on every PR**:

- A job skipped by its `if:` counts as passing.
- A workflow that never triggers (a `paths:` filter, a `types:` list missing `reopened`) leaves
  the check "Expected — waiting" forever, and the PR can only land by admin bypass.
- Renaming a job that is a required check blocks every PR until `policy.json` is updated and
  re-applied. Change both in the same sitting.

So path-filtered workflows (`plugin-pin`, `e2e-external`, `catalog-registry`'s `lint`) are left
out, and a repository whose jobs are only path-filtered (`compose-preview-imports`) gets the
ruleset with no required checks.

The longer-term shape is one aggregate gate job per repository — `compose-preview-server`'s
`gradle` job is the pattern: `needs:` the jobs it covers, `if: !cancelled()`, and fail unless
every result is `success`. Then the list here shrinks to the gate plus `Conventional Commit
title` and `Reject agent attribution`, and adding or renaming a job never touches the ruleset.

## Agent repositories

`skills` and `compose-agent-plugins` use the same merge settings and common
checks. Their required validation jobs are `Validate manifests and skills`
and `validate`, respectively. To apply just these repositories with an owner
credential that has Administration access:

```sh
./apply-repo-policy.sh --apply skills compose-agent-plugins
./apply-repo-policy.sh skills compose-agent-plugins
```

Apply again after their common-check workflows merge: the script requires
those checks only once their jobs exist on the default branch.
