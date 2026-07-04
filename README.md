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

**Convenience groups** (independent, but low-risk to batch):

- **kotlinx** — coroutines / serialization / io / datetime.
- **ktor**.
- **androidx** — catch-all for the remaining independently-versioned AndroidX
  libraries (core, activity, datastore, work, navigation3, test, …). The
  release-train groups above override this for their members.

**Infra:** `android-gradle-plugin`, `github-actions`.

### Why not "all of AndroidX" in one group?

AndroidX is not one release train — `core`, `room`, `work`, `wear`, `lifecycle`,
`compose` each version independently. Lumping them all into one PR means a
single breaking artifact blocks every safe bump riding along with it. The right
unit is the release train (things sharing a version), plus a catch-all for the
miscellaneous small libs where combining is harmless.
