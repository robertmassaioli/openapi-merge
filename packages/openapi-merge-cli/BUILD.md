# How this package is built

`bun run build` runs three steps, in order:

1. **`tsgo --project tsconfig.build.json`** — emits every `src/*.ts` to `dist/`
   as CommonJS, plus the `.d.ts` declarations and their source maps.
2. **`build:bundle`** — `bun build src/index.ts --target=node --format=cjs`,
   which **overwrites** the `dist/index.js` that step 1 just produced with a
   self-contained bundle.
3. **`build:notices`** — writes `dist/THIRD-PARTY-NOTICES.txt`.

## Why `index.ts` is the bundled entry, and not `cli.ts`

`src/cli.ts` is a twenty-line wrapper: it imports `main` from `.` and installs
two process-level error handlers. Bundling the module it points at therefore
covers both of this package's entry points at once:

```
dist/cli.js    (bin, tsgo)  --require('.')-->  dist/index.js  (bundle)
dist/index.js  (main, bundle)
```

Bundling `cli.ts` instead would fix the `bin` and leave `require('openapi-merge-cli')`
resolving `commander` at runtime — which is the bug (see below). Bundling both
would duplicate ~800 KB.

## Why bundle at all

`commander@15` is `type: module`. The CommonJS output of step 1 `require()`s it,
and `require()` of an ESM module is unsupported before Node 20.19 / 22.12:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../commander/index.js
```

That broke **every invocation on Node 18 and 20**, both inside our declared
`engines: { node: ">=18" }` range. Bundling inlines commander (and `js-yaml`,
`ajv`, `ajv-formats`, `openapi-merge` and its `lodash`) after transpiling it to
CommonJS, so there is no ESM `require()` left to fail — and no runtime module
resolution at all, which is also what makes the artifact behave identically
under Node and Bun.

Full reasoning, alternatives considered and measurements:
[`ai-planning/30-proposal-bundle-the-cli.md`](../../ai-planning/30-proposal-bundle-the-cli.md).

## `--format=cjs` is not optional

`--target=node` **alone** emits ESM. Node ≥22.7 auto-detects module syntax in
`.js` and runs it anyway, so the mistake passes on a modern machine and fails on
exactly the old versions this bundling exists to support. Do not drop the flag.

## The overwrite in step 2 is reversible — mind the order

Running `tsgo` on its own after a build restores the *unbundled* `dist/index.js`.
It will look correct locally and fail on Node 18. `scripts/verify-node-runtime.sh`
greps the packed tarball for a leftover `require("commander")` for this reason;
it runs in CI on every branch.

## Consequences worth knowing

- **`dist/index.js` no longer resolves its dependencies at runtime.** They stay
  in `dependencies` because the declaration is still what `npm audit` and
  Dependabot read, and a dependency bump is now a release rather than something
  users pick up on their own.
- **`openapi-merge` is inlined**, so a library fix reaches CLI users only when
  the CLI is republished.
- **`../package.json` is inlined**, so `--version` reports the version present
  at build time. `prepublishOnly` rebuilds, so a publish always carries the
  version being published.
- **`dist/` still contains the step-1 modules** (`data.js`, `file-loading.js`,
  …). They are unreachable from either entry point and exist so the matching
  `.d.ts` files have something to sit beside.
- There are two copies of the `ExitCode` enum at runtime — one in `dist/cli.js`
  from tsgo, one inlined in the bundle. It is a numeric enum compared by value,
  so this is harmless.
