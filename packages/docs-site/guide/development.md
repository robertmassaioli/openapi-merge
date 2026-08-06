# Developing on openapi-merge

This repository is a multi-package monorepo (`packages/openapi-merge`, `packages/openapi-merge-cli`, and this
documentation site at `packages/docs-site`), managed with [Bun](https://bun.sh/) workspaces. Packages are compiled
with [`tsgo`](https://github.com/microsoft/typescript-go), the Go-based native preview of the TypeScript compiler.

## Setup

```bash
bun install
```

## Running things

```bash
bun run cli                    # run the CLI tool in dev mode
bun run --cwd packages/openapi-merge build -- --watch   # watch-build the library, so the CLI picks up changes live
```

If you're changing the library and testing against the CLI, run the library's watch build in one terminal and
`bun run cli` in another — the CLI imports the library's compiled `dist/`, not its TypeScript source directly.

## Before committing

```bash
bun run test   # bun:test, both packages
bun run lint   # eslint --fix, then a full tsgo typecheck of both packages
```

`bun run lint` also runs automatically on every `git commit` via a Husky pre-commit hook (`.husky/pre-commit`), so a
broken build is caught locally rather than in CI.

## Working on this documentation site

```bash
bun run --cwd packages/docs-site dev       # live-reloading local preview
bun run --cwd packages/docs-site build     # production build, including the generated API reference
bun run --cwd packages/docs-site preview   # serve the production build locally
```

Both `dev` and `build` first build `packages/openapi-merge` (`build:lib`): the [playground](/playground) imports the
library's compiled `dist/`, the same way `openapi-merge-cli` does, so it has to exist before Vite bundles the site.
`build` then regenerates the library's TypeDoc API reference straight into `public/api/` (so it's always built from
the checked-out source, not a stale copy), and finally runs the VitePress production build. Both `public/api/` and
`.vitepress/dist` are gitignored — nothing generated here is committed.

## The `ai-planning/` convention

Design decisions in this repository are written up **before** the implementation, not after — see
[`ai-planning/README.md`](https://github.com/robertmassaioli/openapi-merge/blob/main/ai-planning/README.md) on
GitHub for the numbering scheme and layout. If you're proposing a non-trivial change, a short proposal there
describing the current behaviour, what's changing and why, saves a lot of back-and-forth in review.

## Contributing

Issues and pull requests are welcome at
[github.com/robertmassaioli/openapi-merge](https://github.com/robertmassaioli/openapi-merge). If you're fixing a bug,
a `bun:test` case that reproduces it first makes review much faster.
