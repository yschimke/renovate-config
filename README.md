# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) preset for the Android / Compose / Kotlin repos.

## Usage

In a consuming repo's `renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>yschimke/renovate-config"]
}
```

Repo-specific rules (extra groups, pins, `enabled: false` floors) go in the
consumer's own `packageRules` — they are appended after the preset, so they
override it.

## Grouping philosophy

Updates are clustered **by release train**, not by namespace. Things that share
a version number and are ABI-coupled are grouped so they bump together;
everything else stays small so a single risky bump can't block the safe ones.

**Lockstep trains** (grouping is correctness):

- **kotlin** — Kotlin stdlib + Gradle plugins + the Compose compiler plugin
  + KSP. KSP tracks the compiler version and must move with it.
- **compose-multiplatform** — JetBrains Compose MP + its lifecycle / navigation
  companions.
- **androidx-compose** — the BOM-aligned AndroidX Compose artifacts.
- **androidx-wear** — Wear Compose / TV + Horologist.
- **androidx-room** — Room + SQLite (+ the Room plugin), which are KSP-coupled.
- **grpc** — gRPC + protobuf runtime / codegen.
- **compose-ai-tools** — the preview CLI, the `ee.schimke.composeai.preview`
  Gradle plugin, the annotation / connector / runtime artifacts and the
  `yschimke/compose-ai-tools` action refs. One release ships all of them, and a
  skew between a pinned action ref and the Gradle coords breaks preview
  discovery.
- **compose-preview-daemon** — the renderers, data extractors, render daemon and
  `compose-preview-daemon-bom`.
- **compose-preview-contracts** — the published wire contracts and
  `compose-preview-contracts-bom`.
- **compose-preview-server** — `compose-preview-serve` + `compose-preview-render-host`
  (historic coordinates; the server no longer publishes to Maven Central).
- **compose-ui-builder** — every `compose-preview-ui-builder-*` coordinate,
  `compose-preview-ui-builder-bom` included.
- **rc-players** — the RemoteCompose player artifacts.

**compose-preview-mcp** ([yschimke/compose-preview-mcp](https://github.com/yschimke/compose-preview-mcp),
`4.x`) is a release train with no rule here, on purpose: it publishes no Maven coordinate. Its
artifacts are GitHub release assets — the `compose-preview-mcp` distribution, which the CLI's
`mcp serve` resolves at run time, and the viewer it re-publishes from compose-preview-server — so
nothing a catalog pins can belong to it. It extends this preset as a consumer, and
`repo-policy/policy.json` requires its `gradle` check.

**compose-preview-client** ([yschimke/compose-preview-client](https://github.com/yschimke/compose-preview-client))
is the same: the mobile and Wear device-preview apps ship to Google Play, not Maven, so there is
no train for it here. It extends this preset as a consumer, and `repo-policy/policy.json` requires
its `ktfmt + core tests` and `Assemble mobile + wear` checks. Its own `renovate.json` keeps the
AndroidX Remote Compose player (`androidx.compose.remote`, an alpha line the apps' playback depends
on) out of the BOM-aligned `androidx-compose` group and off automerge.

**Convenience groups** (independent, but low-risk to batch):

- **kotlinx** — coroutines / serialization / io / datetime.
- **ktor**.
- **androidx** — catch-all for the remaining independently-versioned AndroidX
  libraries (core, activity, datastore, work, navigation3, test, …). The
  release-train groups above override this for their members.

**Infra:** `android-gradle-plugin`, `github-actions`.

### One Maven group, six release trains

`ee.schimke.composeai` is **not** one release train. Six repositories publish
into it, each cutting its own versions:

| Train | Repo | Version line |
| --- | --- | --- |
| `compose-ai-tools` | [yschimke/compose-ai-tools](https://github.com/yschimke/compose-ai-tools) | `2.1x.x` |
| `compose-preview-daemon` | [yschimke/compose-preview-daemon](https://github.com/yschimke/compose-preview-daemon) | `3.x` |
| `compose-preview-contracts` | [yschimke/compose-preview-contracts](https://github.com/yschimke/compose-preview-contracts) | `2.x` |
| `compose-preview-server` | [yschimke/compose-preview-server](https://github.com/yschimke/compose-preview-server) | `3.x`, independent of the contracts |
| `compose-ui-builder` | [yschimke/compose-ui-builder](https://github.com/yschimke/compose-ui-builder) | `3.x`, its own |
| `rc-players` | yschimke/rc-players | its own, already ahead |

Grouping them together is not just noise, it is wrong: one group means one
shared version ref in `libs.versions.toml`, and Renovate raises that ref to
whichever train released last — proposing a version the others never
published. That is exactly how wear-m3-catalog#199 broke, when the players
dragged four compose-ai-tools artifacts to a player-only version, and how
compose-preview-daemon#91 and #92 opened two branches with byte-identical
diffs, both rewriting one `composeai-contracts` ref.

The `compose-ai-tools` rule matches the whole group; the other five follow it
and carve their own coordinates back out. **Order is load-bearing** — Renovate
applies `packageRules` in sequence and the last match wins, so a repo-local
rule appended after the preset re-collapses all five unless it splits them the
same way.

Each train's BOM sits in that train's group, with its modules. A catalog that
resolves the train through `platform(<bom>)` pins only the BOM; one still
pinning a module beside it gets the BOM and the module in the same PR, never a
module bump on its own against a BOM left behind.

The daemon, the contracts and the server are listed by exact artifactId rather
than by prefix, because the names interleave three ways: `daemon-protocol` is a
contract but `daemon-core` is the daemon's, `data-render-core` is a contract but
`data-render-compose` is the daemon's, `slot-preview-runtime` is the daemon's
but `wear-preview-runtime` is compose-ai-tools'. A new published coordinate
therefore has to be added to the right list by hand; unlisted ones fall into
`compose-ai-tools`. Regenerate a train's list from its repository with
`grep -rhA2 -E '^  coordinates\($|artifactId *=' --include=build.gradle.kts . | grep -o '"[a-z0-9-]*"'`
— the `artifactId =` arm is what catches `daemon-connector-api` and the BOMs,
which the `coordinates(` form alone missed. The UI builder is the exception: all
of its coordinates are `compose-preview-ui-builder-*`, so its rule is a prefix.

### Why not "all of AndroidX" in one group?

AndroidX is not one release train — `core`, `room`, `work`, `wear`, `lifecycle`,
`compose` each version independently. Lumping them all into one PR means a
single breaking artifact blocks every safe bump riding along with it. The right
unit is the release train (things sharing a version), plus a catch-all for the
miscellaneous small libs where combining is harmless.

## Versions that are never upgrades

Two suffixes are filtered out of the candidate list for every Gradle
dependency, rather than disabled, so the next genuine release is still offered:

- **`-SNAPSHOT`** — Renovate's Gradle versioning ranks `1.0.0-SNAPSHOT` above
  `1.0.0-alpha18`, so an upstream publishing snapshots into a repository the
  build already reads is offered as though it were a release.
- **`-compat`** — JetBrains' legacy-API rebuilds (`kotlinx-datetime
  0.8.0-0.6.x-compat`) rank above the plain release, so the "upgrade" is a
  downgrade of API surface.

Both set `allowedVersions`, and **the last matching rule wins on a field**: a
repo-local rule that sets `allowedVersions` across the whole `gradle` manager
replaces these entirely for those dependencies and has to repeat the suffixes
itself.

## Java runtime policy

Keep the Java major selected by each repository and continue taking maintenance
updates within it. The shared preset suppresses **major** proposals for
`java-jdk` and `java-jre` from Renovate's `java-version` datasource, including
the `java` alias and platform-qualified names such as
`java-jdk?os=linux&architecture=x64`. It does not
freeze a patch release, downgrade projects already on a newer Java, or restrict
ordinary Java libraries and `actions/setup-java` action releases. Docker images
need a repository-local rule because their tags and runtime roles differ.

A new LTS alone does not establish compatibility with Gradle plugins, embedded
renderers, instrumentation agents or the runtime contract of published artifacts.
For example, [compose-preview-server#1738](https://github.com/yschimke/compose-preview-server/pull/1738)
passed its CI after replacing the visual harness's Java 21 with 25, but left
the distribution's Java 17 floor and Temurin 21 image unchanged. That is evidence
for that lane, rather than a migration of all three contracts. Conversely,
[ClassGraph 6](https://github.com/yschimke/compose-preview-server/pull/1741)
actually needs Java 25 and breaks the server's Java 17 dependency floor.

To adopt a new major, document the intended lane and runtime floor, check the
[Gradle compatibility matrix](https://docs.gradle.org/current/userguide/compatibility.html)
and plugin/renderer requirements, then verify compilation, tests, packaged startup
and representative renders on the selected JVM. Preserve coverage of any lower
runtime still supported. Update relevant container/toolchain declarations in the
same migration, or explain why they intentionally differ. Gradle supporting a JVM
does not prove every plugin or embedded component supports it.

A repository can then change its selected Java major in a reviewed PR, or append
a narrow local `packageRules` override with the same datasource/package match,
`matchUpdateTypes: ["major"]`, `enabled: true` and `automerge: false`. Remove or
adjust any local `allowedVersions` ceiling as part of that reviewed migration.
This is a proposal policy, not an assertion that every currently selected Java
line remains supported forever; review runtime support periodically.

Run the dependency-free policy regression tests with:

```sh
node --test tests/*.test.mjs
```

## Automerge

Patch and minor updates **auto-land once every CI check on the branch is
green**. Major updates never automerge — they get a 14-day soak and a manual
click.

The preset uses `platformAutomerge: false`, so **Renovate itself waits for all
checks to pass** and then merges — it can't merge ahead of CI, and it honours
*every* workflow, not just the ones marked required. The preset sets no
`schedule`, so updates are proposed on any Renovate run (≈hourly on the hosted
app) as soon as they are published, and `automergeSchedule: ["at any time"]`
lets a newly-green PR merge on the next run. Renovate's own run cadence is the
only delay; any soak comes from `minimumReleaseAge` (14 days for majors here,
plus whatever a repository sets locally), not from a weekly window. No branch
protection is required for this to be safe.

A grouped PR only automerges if **every** update in it qualifies, so a group
that happens to include a major bump stays manual until the major is handled.

### GitHub-native merge in the repositories under `repo-policy/`

The repositories in [`repo-policy/policy.json`](repo-policy/policy.json) that have required checks
set `"platformAutomerge": true` in their own `renovate.json`: GitHub merges the moment the required
checks pass, instead of on Renovate's next run.

GitHub auto-merge waits **only** for required checks, and those are deliberately the build and
unit-test jobs. Lint, formatting, render and other jobs still run and still show red on the PR,
but they no longer hold back an automerged Renovate PR. A repository with no required checks
(`compose-preview-imports`) stays on Renovate-managed automerge, which waits for every check.

The preset keeps `platformAutomerge: false` because other repositories extend it without any
required checks, and native auto-merge there would merge without waiting for CI.

### Rebasing only on conflict

The preset sets `rebaseWhen: "conflicted"`. Renovate's default (`auto`) rebases an automerging
branch every time its base moves, and every rebase reruns the full CI matrix. On these busy
repositories that churn was the largest single consumer of the account's shared runner pool:
over 48 hours to 2026-10-11, `renovate/compose-ai-tools` ran CI 24–28 times in meshcore-mobile and
homeassistant-remotecompose, and compose-ui-builder's compose-preview-server digest branch ran it
32 times in 16 hours, each run queued behind every other PR. With CI plus queueing slower than
`main` moved, a branch could be rebased again before its checks finished and never land.

Staying behind the base is safe here because the `Protect Main` ruleset does not require branches
to be up to date (`strict_required_status_checks_policy: false` in
[`repo-policy/policy.json`](repo-policy/policy.json)), the same as for every human PR. A branch is
still rebased when it conflicts, and a single PR can be rebased on demand from its checkbox.

## Stuck Renovate PRs

With the settings above a Renovate PR lands within a few hours, so one still open after that is a
fault to fix, not a PR to wait on. Two pieces find and clear them:

- **[`stuck-renovate.yml`](.github/workflows/stuck-renovate.yml)**, every 3 hours, runs
  [`stuck-renovate/find-stuck.mjs`](stuck-renovate/find-stuck.mjs) over every open Renovate PR of
  the owner whose repository extends this preset, and rewrites the issue labelled
  `stuck-renovate` with those open for over 6 hours and why: a red required check, a required
  check that never reported, a conflict Renovate did not rebase, an edited branch, auto-merge not
  armed. PRs whose automerge is off by config (majors, Compose Multiplatform) are listed apart, as
  waiting on a person. The issue closes itself when nothing is stuck. It uses the default token,
  so it sees public repositories only (`preview-coo-ee` is not covered).
- **A scheduled Claude Code task** reads that issue and follows
  [`.claude/skills/unstick-renovate`](.claude/skills/unstick-renovate/SKILL.md): nudge what is
  mechanical (arm auto-merge, tick Renovate's rebase box, re-run a lost job), push a small fix to
  the Renovate branch and let it automerge, or add a `packageRules` entry skipping the bad version
  with a `description` saying why and when to remove it. Anything that needs a decision is
  escalated as a comment on the issue. Each run reports what it did there.

Run the detector locally with `node stuck-renovate/find-stuck.mjs` (`--repos a,b` to skip the
owner-wide search).

## Repository settings

[`repo-policy/`](repo-policy/README.md) holds the merge policy shared by the same repositories —
squash-only merges, required CI checks, and an admin bypass for force-landing a PR — and the
script that applies it.
