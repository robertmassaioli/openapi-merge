# Build Timing: Bun + tsgo vs. Yarn/bolt + tsc

**Context:** the `feature/bun-and-tsgo` branch migrates tooling from Yarn/bolt +
`tsc` (TypeScript 3.9.10) + Jest to Bun workspaces + `tsgo`
(`@typescript/native-preview`, the Go-based TypeScript compiler) + `bun:test`.
This note records the measured timing difference between the two, taken on
2026-07-24 on the same machine, same source files, no other changes.

---

## Results

| Step | `main` (Yarn/bolt + tsc 3.9.10) | `feature/bun-and-tsgo` (Bun + tsgo) | Speedup |
| --- | --- | --- | --- |
| Library build (`openapi-merge`) | ~1.3–1.5s | ~0.2–0.3s* | ~5x |
| CLI build (`openapi-merge-cli`) | ~1.8s | ~0.2–0.3s* | ~6x |
| **Combined build (both packages)** | **~3.1–3.3s** | **~0.5–0.7s** | **~5–6x** |
| Full dependency install | ~7–9s per package (`yarn install`) | ~1–2s for the whole workspace (`bun install`) | ~5–8x |
| Full cold bootstrap (wipe `node_modules`, install + build) | not directly measured; extrapolates to ~15–20s given the install/build numbers above | ~2.9s | ~5–7x |

\* The combined tsgo build time (~0.5–0.7s) was measured as a single
`bun run build` across both workspaces; it was not cleanly separable into a
per-package figure the way the `tsc` runs were, so the per-package tsgo
numbers above are the combined figure split evenly, not independently timed.

## Method

- **This branch**: `rm -rf packages/*/dist && time bun run build` from the
  repo root (fans out to `tsgo --project .` in each package via
  `bun run --filter '*' build`). Ran 3 times for consistency; wall time was
  stable at ~0.5–0.7s. Cold bootstrap timed as
  `rm -rf node_modules packages/*/node_modules && time (bun install && bun run build)`.
- **`main`**: same source, but `main`'s tooling (bolt/Yarn 1) isn't installed
  on this machine, so:
  - `bun install` was tried first as a faster stand-in package manager, but
    it (and `npm install`) failed on `@atlassian/atlassian-openapi`: the
    committed root `yarn.lock` has a stale `resolved` URL pointing at
    Atlassian's private npm mirror (`packages.atlassian.com`), which 404s
    from outside that network. Worked around by patching that one `resolved`
    line in a local (uncommitted, reverted afterward) copy of `yarn.lock` to
    point at `registry.npmjs.org` instead.
  - Installed each package's dependencies independently via
    `npx --yes yarn@1 install` (classic Yarn, matching what `bolt` wraps),
    since `main`'s root `package.json` uses `"bolt": { "workspaces": [...] }`
    rather than native npm/Yarn `"workspaces"`, so plain Yarn does not
    hoist/link the two packages together. Manually symlinked
    `packages/openapi-merge-cli/node_modules/openapi-merge` to
    `packages/openapi-merge` to replicate the workspace link bolt would
    normally create (the CLI imports the library's compiled `dist/` output).
  - Timed `node_modules/.bin/tsc --project .` directly in each package after
    removing `dist/`, run twice per package for consistency.
  - All scratch changes (patched `yarn.lock`, installed `node_modules`, built
    `dist/`) were removed and `yarn.lock` was restored via `git checkout --`
    before switching back to `feature/bun-and-tsgo`; `main` was left
    unmodified in the working tree.

## Caveats

- `main`'s `TypeScript: "^3.8.3"` range resolves to `3.9.10` today, not
  `3.8.3` — the actual version historically used. This is likely close
  enough for a compiler-speed comparison (same compiler generation), but it's
  worth noting the comparison isn't against the exact original patch version.
- The stale `packages.atlassian.com` URL in `main`'s `yarn.lock` (see above)
  is a pre-existing issue unrelated to this migration. Anyone doing a fresh
  `bolt install`/`yarn install` of `main` outside Atlassian's network will hit
  the same 404 unless that `resolved` line is fixed. Worth a follow-up fix on
  `main` independent of the Bun/tsgo migration.
- These are single-machine, best-effort timings (a handful of runs each), not
  a rigorous benchmark — treat the ~5–6x figure as a rough order of magnitude,
  not a precise ratio.
