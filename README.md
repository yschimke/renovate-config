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

## Automerge

Patch and minor updates **auto-land once every CI check on the branch is
green**. Major updates never automerge — they get a 14-day soak and a manual
click.

The preset uses `platformAutomerge: false`, so **Renovate itself waits for all
checks to pass** and then merges — it can't merge ahead of CI, and it honours
*every* workflow, not just the ones marked required. PR creation stays on the
weekly `schedule`, but `automergeSchedule: ["at any time"]` lets a
newly-green PR merge on the next Renovate run (≈hourly) instead of waiting for
the next weekly window. No branch protection is required for this to be safe.

A grouped PR only automerges if **every** update in it qualifies, so a group
that happens to include a major bump stays manual until the major is handled.

### Switching to instant GitHub-native merge

If you'd rather have GitHub merge the instant required checks pass (seconds
instead of ≈an hour):

1. Enable **Settings → General → Allow auto-merge** on the repo.
2. Add a branch-protection rule on `main` that **requires** the CI checks
   (e.g. `Assemble (debug)`, `Unit tests`, `Android lint`, `ktfmt check`).
   This is essential — with native auto-merge, anything *not* required is not
   waited on.
3. Set `"platformAutomerge": true` in this preset.

Without step 2, native auto-merge would merge without waiting for CI, which is
why the default here is the Renovate-internal mechanism.

## Repository settings

[`repo-policy/`](repo-policy/README.md) holds the merge policy shared by the same repositories —
squash-only merges, required CI checks, and an admin bypass that works only through a pull
request — and the script that applies it.
