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
- **compose-preview-contracts** — the nine published wire contracts.
- **compose-preview-server** — `compose-preview-serve` + `compose-preview-render-host`.
- **rc-players** — the RemoteCompose player artifacts.

**Convenience groups** (independent, but low-risk to batch):

- **kotlinx** — coroutines / serialization / io / datetime.
- **ktor**.
- **androidx** — catch-all for the remaining independently-versioned AndroidX
  libraries (core, activity, datastore, work, navigation3, test, …). The
  release-train groups above override this for their members.

**Infra:** `android-gradle-plugin`, `github-actions`.

### One Maven group, four release trains

`ee.schimke.composeai` is **not** one release train. Four repositories publish
into it, each cutting its own versions:

| Train | Repo | Version line |
| --- | --- | --- |
| `compose-ai-tools` | [yschimke/compose-ai-tools](https://github.com/yschimke/compose-ai-tools) | `1.5x.x` |
| `compose-preview-contracts` | [yschimke/compose-preview-contracts](https://github.com/yschimke/compose-preview-contracts) | `2.x` |
| `compose-preview-server` | [yschimke/compose-preview-server](https://github.com/yschimke/compose-preview-server) | `2.x`, independent of the contracts |
| `rc-players` | yschimke/rc-players | its own, already ahead |

Grouping them together is not just noise, it is wrong: one group means one
shared version ref in `libs.versions.toml`, and Renovate raises that ref to
whichever train released last — proposing a version the other three never
published. That is exactly how wear-m3-catalog#199 broke, when the players
dragged four compose-ai-tools artifacts to a player-only version.

The `compose-ai-tools` rule matches the whole group; the other three follow it
and carve their own coordinates back out. **Order is load-bearing** — Renovate
applies `packageRules` in sequence and the last match wins, so a repo-local
rule appended after the preset re-collapses all four unless it splits them the
same way.

The contracts and the server are listed by exact artifactId rather than by
prefix, because the names interleave with compose-ai-tools': `daemon-protocol`
is a contract but `daemon-core` is not, `data-render-core` is a contract but
`data-render-compose` is not. A new published coordinate therefore has to be
added to the right list by hand; unlisted ones fall into `compose-ai-tools`.

### Why not "all of AndroidX" in one group?

AndroidX is not one release train — `core`, `room`, `work`, `wear`, `lifecycle`,
`compose` each version independently. Lumping them all into one PR means a
single breaking artifact blocks every safe bump riding along with it. The right
unit is the release train (things sharing a version), plus a catch-all for the
miscellaneous small libs where combining is harmless.

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
