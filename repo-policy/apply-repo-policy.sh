#!/usr/bin/env bash
# Converges every repository in policy.json on one merge policy:
#   - repo settings: squash only, PR title as the squash headline, empty body, auto-merge on
#   - Actions: read-only default GITHUB_TOKEN (jobs declare what they need), and workflows may
#     open pull requests (release-please, generated-file refreshes)
#   - one branch ruleset on the default branch: no deletion, no force-push, PR required,
#     squash the only allowed method, the listed checks required, admins may bypass. The
#     required checks are the repository's build and unit-test jobs plus the common checks
#     (PR title, agent attribution); a common check is required only once the branch carries
#     the workflow job that reports it, so adding one never wedges open pull requests
#   - the same ruleset on any other branch developed through pull requests (branch_rulesets)
#   - a deletion-only ruleset on long-lived non-default branches (baselines, generated output,
#     port lanes): they may be force-pushed by the workflows that write them, never deleted
#
#   ./apply-repo-policy.sh            # check: print drift, exit 1 if any (read-only)
#   ./apply-repo-policy.sh --apply    # write the policy
#   ./apply-repo-policy.sh --apply m3-catalog a2ui-catalog   # limit to some repos
#
# Needs gh authenticated with admin rights on the repositories (the owner's `gh auth login`,
# or a fine-grained PAT with Administration: read/write). GITHUB_TOKEN cannot manage other repos.
set -euo pipefail
cd "$(dirname "$0")"
POLICY=policy.json
MODE=check; [[ "${1:-}" == --apply ]] && { MODE=apply; shift; }
OWNER=$(jq -r .owner "$POLICY")
REPOS=("$@")
((${#REPOS[@]})) ||
  mapfile -t REPOS < <(jq -r '[.repos, .long_lived_branches.repos, .branch_rulesets | keys[]] | unique[]' "$POLICY")
in_policy() { jq -e --arg r "$2" --arg s "$1" 'getpath($s / ".") | has($r)' "$POLICY" >/dev/null; }
for repo in "${REPOS[@]}"; do # never touch a repository the policy does not name
  { in_policy repos "$repo" || in_policy long_lived_branches.repos "$repo" || in_policy branch_rulesets "$repo"; } ||
    { echo "$repo is not in $POLICY; add it there first" >&2; exit 2; }
done
ACTIONS_APP_ID=15368   # GitHub Actions; pins each check to the app that must report it
drift=0

# desired_ruleset <name> <ref pattern> <checks json array> <extra-approval flag>
desired_ruleset() {
  jq --arg name "$1" --arg ref "$2" --argjson checks "$3" --argjson app "$ACTIONS_APP_ID" --argjson extra "$4" '
    .ruleset as $r | {
      name: $name, target: "branch", enforcement: "active",
      conditions: {ref_name: {include: [$ref], exclude: []}},
      bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: $r.admin_bypass_mode}],
      rules: ([
        {type: "deletion"}, {type: "non_fast_forward"},
        {type: "pull_request", parameters: {
          required_approving_review_count: 0, dismiss_stale_reviews_on_push: false,
          required_reviewers: [], require_code_owner_review: false,
          require_last_push_approval: false, required_review_thread_resolution: false,
          require_extra_approval_for_unattributed_changes: $extra,
          allowed_merge_methods: ["squash"]}}
      ] + (if ($checks | length) > 0 then [{type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: $r.strict_required_status_checks_policy,
          do_not_enforce_on_create: false,
          required_status_checks: [$checks[] | {context: ., integration_id: $app}]}}]
        else [] end))
    }' "$POLICY"
}
desired_long_lived() { # $1 repo
  jq --arg repo "$1" '.long_lived_branches as $l | ($l.repos[$repo]) as $b
    | def ref: if startswith("~") or startswith("refs/") then . else "refs/heads/" + . end; {
      name: $l.ruleset_name, target: "branch", enforcement: "active",
      conditions: {ref_name: {include: [$b.include[] | ref], exclude: [($b.exclude // [])[] | ref]}},
      bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: .ruleset.admin_bypass_mode}],
      rules: [{type: "deletion"}]
    }' "$POLICY"
}
# converge_ruleset <owner/repo> <desired json> <label>: create, or update the ruleset with the same
# name (case-insensitively, so "Protect main" is renamed); print drift, write only with --apply
converge_ruleset() {
  local full=$1 desired=$2 label=$3 name id current
  name=$(jq -r .name <<<"$desired")
  id=$(gh api "repos/$full/rulesets" --jq "map(select(.name | ascii_downcase == (\"$name\" | ascii_downcase)))[0].id // empty")
  current='{}'; [[ -n "$id" ]] && current=$(gh api "repos/$full/rulesets/$id")
  if [[ -z "$id" ]] || [[ "$(normalize <<<"$current")" != "$(normalize <<<"$desired")" ]]; then
    drift=1
    if [[ -z "$id" ]]; then echo "   $label: missing"
    else diff <(normalize <<<"$current") <(normalize <<<"$desired") | grep '^[<>]' | grep -vE '^\S+\s+[{}],?$' | sed "s/^/   $label /" || true; fi
    if [[ $MODE == apply ]]; then
      if [[ -z "$id" ]]; then gh api -X POST "repos/$full/rulesets" --input <(echo "$desired") >/dev/null
      else gh api -X PUT "repos/$full/rulesets/$id" --input <(echo "$desired") >/dev/null; fi
      echo "   $label: applied"
    fi
  fi
}
# required_checks <owner/repo> <branch> <own checks json>: the own checks plus each common check
# whose workflow on <branch> declares a job with that name. A common check not there yet is
# reported as pending (not drift): requiring it now would leave open PRs waiting forever.
required_checks() {
  local full=$1 branch=$2 checks=$3 check wf body
  while IFS=$'\t' read -r check wf; do
    body=$(gh api "repos/$full/contents/.github/workflows/$wf?ref=$branch" --jq .content 2>/dev/null | base64 -d 2>/dev/null || true)
    if grep -qE "^\s+name: ['\"]?$check['\"]?\s*$" <<<"$body"; then
      checks=$(jq -c --arg c "$check" '. + [$c]' <<<"$checks")
    else
      echo "   pending: '$check' is not a job in $wf on $branch yet" >&2
    fi
  done < <(jq -r '.common_required_checks[] | [.check, .workflow] | @tsv' "$POLICY")
  echo "$checks"
}
# extra_approval <owner/repo> <ruleset name>: keep the repository's own setting for this flag
extra_approval() {
  local id
  id=$(gh api "repos/$1/rulesets" --jq "map(select(.name | ascii_downcase == (\"$2\" | ascii_downcase)))[0].id // empty")
  [[ -n "$id" ]] || { echo false; return; }
  gh api "repos/$1/rulesets/$id" --jq '[.rules[] | select(.type=="pull_request") | .parameters.require_extra_approval_for_unattributed_changes][0] // false'
}
normalize() { # comparable form: rules and checks sorted, server-only fields dropped
  jq -S '{name, target, enforcement, conditions, bypass_actors,
    rules: ([.rules[] | {type, parameters: (.parameters // null)}
      | if .parameters.required_status_checks then
          .parameters.required_status_checks |= sort_by(.context) else . end] | sort_by(.type))}'
}

for repo in "${REPOS[@]}"; do
  full="$OWNER/$repo"; echo "== $full"
  if in_policy repos "$repo"; then
  # 1. repository merge settings
  want=$(jq -S .repo_settings "$POLICY")
  have=$(gh api "repos/$full" | jq -S --argjson w "$want" 'with_entries(select(.key as $k | $w | has($k)))')
  if [[ "$want" != "$have" ]]; then
    drift=1; diff <(echo "$have") <(echo "$want") | sed 's/^/   settings /' || true
    if [[ $MODE == apply ]]; then
      gh api -X PATCH "repos/$full" --input <(echo "$want") >/dev/null
      echo "   settings: applied"
    fi
  fi
  # 2. Actions workflow permissions
  want=$(jq -S .actions_workflow_permissions "$POLICY")
  have=$(gh api "repos/$full/actions/permissions/workflow" | jq -S)
  if [[ "$want" != "$have" ]]; then
    drift=1; diff <(echo "$have") <(echo "$want") | grep '^[<>]' | sed 's/^/   actions /' || true
    if [[ $MODE == apply ]]; then
      gh api -X PUT "repos/$full/actions/permissions/workflow" --input <(echo "$want") >/dev/null
      echo "   actions: applied"
    fi
  fi
  # 3. the default-branch ruleset
  name=$(jq -r .ruleset.name "$POLICY")
  default=$(gh api "repos/$full" --jq .default_branch)
  checks=$(required_checks "$full" "$default" "$(jq -c --arg r "$repo" '.repos[$r]' "$POLICY")")
  converge_ruleset "$full" "$(desired_ruleset "$name" "~DEFAULT_BRANCH" "$checks" "$(extra_approval "$full" "$name")")" ruleset
  fi
  # 4. other branches developed through pull requests: the same ruleset, scoped to the branch
  while IFS=$'\t' read -r branch own; do
    [[ -n "$branch" ]] || continue
    name="Protect $branch"
    checks=$(required_checks "$full" "$branch" "$own")
    converge_ruleset "$full" "$(desired_ruleset "$name" "refs/heads/$branch" "$checks" "$(extra_approval "$full" "$name")")" "$branch"
  done < <(jq -r --arg r "$repo" '(.branch_rulesets[$r] // [])[] | [.branch, (.checks | tojson)] | @tsv' "$POLICY")
  # 5. long-lived branches: deletion blocked
  if in_policy long_lived_branches.repos "$repo"; then
    converge_ruleset "$full" "$(desired_long_lived "$repo")" branches
  fi
done
[[ $MODE == apply ]] && exit 0
exit $drift
