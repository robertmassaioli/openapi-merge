# AI Planning

Design documents and implementation proposals, written before the work rather
than after it. Each records what was measured, what was decided, and — where it
matters — where the proposal turned out to be wrong.

## Layout

```
ai-planning/
├── issues/          proposals that address a specific GitHub issue
└── *.md             everything else
```

### `issues/`

One proposal per GitHub issue, named `proposal-<issue-number>-<slug>.md`. Every
file in here links to its issue at the top and carries a status
(`Proposal` / `✅ Fixed` / `⛔ Superseded`).

Start from [`issue-triage-value-vs-effort.md`](issue-triage-value-vs-effort.md),
which scores every open issue by value and effort and links to the proposal for
each one that has been written up.

### Top level

Cross-cutting work that no single issue asked for — tooling, test coverage,
dependency health, build migrations. Named by topic rather than by number.

| Document | What it covers |
| --- | --- |
| [`issue-triage-value-vs-effort.md`](issue-triage-value-vs-effort.md) | Value/effort scoring of every open issue; the index into `issues/` |
| [`proposal-code-coverage.md`](proposal-code-coverage.md) | Making the coverage numbers trustworthy and enforced |
| [`proposal-closing-coverage-gaps.md`](proposal-closing-coverage-gaps.md) | Closing the gaps that measurement then exposed |
| [`proposal-cli-test-coverage.md`](proposal-cli-test-coverage.md) | ⛔ Superseded by the above; kept for history |
| [`proposal-dependency-updates.md`](proposal-dependency-updates.md) | Dependency audit and the phased upgrade path |
| [`bun-tsgo-migration-build-timings.md`](bun-tsgo-migration-build-timings.md) | Measured build timings for the Bun + tsgo migration |

## Conventions

- **A proposal is written before the implementation** and updated with results
  afterwards, including any prediction that turned out to be wrong. The
  corrections are the most useful part; do not quietly edit them away.
- **Claims are measured, not assumed.** If a proposal states a number, it was
  produced by running something.
- **Superseded documents are marked, not deleted.** They record why an approach
  was abandoned.
