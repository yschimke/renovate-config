#!/usr/bin/env bash
# Converges every repository in policy.json on one merge policy:
#   - repo settings: squash only, PR title as the squash headline, empty body, auto-merge on
#   - one branch ruleset on the default branch: no deletion, no force-push, PR required,
#     squash the only allowed method, the listed checks required, admins may bypass
#     through a pull request only (never a direct or force push)
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
REPOS=("$@"); ((${#REPOS[@]})) || mapfile -t REPOS < <(jq -r '.repos | keys[]' "$POLICY")
ACTIONS_APP_ID=15368   # GitHub Actions; pins each check to the app that must report it
drift=0

desired_ruleset() { # $1 repo, $2 current extra-approval flag
  jq --arg repo "$1" --argjson app "$ACTIONS_APP_ID" --argjson extra "$2" '
    .ruleset as $r | {
      name: $r.name, target: "branch", enforcement: "active",
      conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}},
      bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: $r.admin_bypass_mode}],
      rules: ([
        {type: "deletion"}, {type: "non_fast_forward"},
        {type: "pull_request", parameters: {
          required_approving_review_count: 0, dismiss_stale_reviews_on_push: false,
          required_reviewers: [], require_code_owner_review: false,
          require_last_push_approval: false, required_review_thread_resolution: false,
          require_extra_approval_for_unattributed_changes: $extra,
          allowed_merge_methods: ["squash"]}}
      ] + (if (.repos[$repo] | length) > 0 then [{type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: $r.strict_required_status_checks_policy,
          do_not_enforce_on_create: false,
          required_status_checks: [.repos[$repo][] | {context: ., integration_id: $app}]}}]
        else [] end))
    }' "$POLICY"
}
normalize() { # comparable form: rules and checks sorted, server-only fields dropped
  jq -S '{name, target, enforcement, conditions, bypass_actors,
    rules: ([.rules[] | {type, parameters: (.parameters // null)}
      | if .parameters.required_status_checks then
          .parameters.required_status_checks |= sort_by(.context) else . end] | sort_by(.type))}'
}

for repo in "${REPOS[@]}"; do
  full="$OWNER/$repo"; echo "== $full"
  # 1. repository merge settings
  want=$(jq -S .repo_settings "$POLICY")
  have=$(gh api "repos/$full" | jq -S --argjson w "$want" 'with_entries(select(.key as $k | $w | has($k)))')
  if [[ "$want" != "$have" ]]; then
    drift=1; diff <(echo "$have") <(echo "$want") | sed 's/^/   settings /' || true
    [[ $MODE == apply ]] && gh api -X PATCH "repos/$full" --input <(echo "$want") >/dev/null && echo "   settings: applied"
  fi
  # 2. the branch ruleset (matched by name, case-insensitively, so "Protect main" is renamed)
  name=$(jq -r .ruleset.name "$POLICY")
  id=$(gh api "repos/$full/rulesets" --jq "map(select(.name | ascii_downcase == (\"$name\" | ascii_downcase)))[0].id // empty")
  current='{}'; extra=false
  if [[ -n "$id" ]]; then
    current=$(gh api "repos/$full/rulesets/$id")
    extra=$(jq '[.rules[] | select(.type=="pull_request") | .parameters.require_extra_approval_for_unattributed_changes][0] // false' <<<"$current")
  fi
  desired=$(desired_ruleset "$repo" "$extra")
  if [[ -z "$id" ]] || [[ "$(normalize <<<"$current")" != "$(normalize <<<"$desired")" ]]; then
    drift=1
    if [[ -z "$id" ]]; then echo "   ruleset: missing"
    else diff <(normalize <<<"$current") <(normalize <<<"$desired") | grep '^[<>]' | grep -vE '^\S+\s+[{}],?$' | sed 's/^/   ruleset /' || true; fi
    if [[ $MODE == apply ]]; then
      if [[ -z "$id" ]]; then gh api -X POST "repos/$full/rulesets" --input <(echo "$desired") >/dev/null
      else gh api -X PUT "repos/$full/rulesets/$id" --input <(echo "$desired") >/dev/null; fi
      echo "   ruleset: applied"
    fi
  fi
done
[[ $MODE == apply ]] && exit 0
exit $drift
