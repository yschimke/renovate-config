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
- **admin bypass in `pull_request` mode**: an admin can land a PR whose checks are red or pending
  ("Merge without waiting for requirements to be met", or `gh pr merge <n> --squash --admin`),
  but cannot push or force-push to `main` directly. Every bypass is recorded in the repository's
  rule insights.

## Choosing required checks

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
