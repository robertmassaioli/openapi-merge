#!/usr/bin/env bun
/**
 * Summarise the lcov output that `bun test --coverage` writes for each package.
 *
 * Why this exists rather than just reading Bun's own table: Bun's `All files`
 * row is the *unweighted mean* of the per-file percentages, so a one-line file
 * at 100% cancels out a 200-line file at 20%. That makes it useless for
 * tracking a package over time. This computes covered / total from the lcov
 * `LF`/`LH`/`FNF`/`FNH` records instead, which is what the number should mean.
 * See ai-planning/proposal-code-coverage.md §2.4.
 *
 * Prints a Markdown table. When GITHUB_STEP_SUMMARY is set (i.e. in GitHub
 * Actions) it appends there too, so the numbers show up on the run page without
 * anyone downloading an artifact.
 *
 * Exits non-zero only if no coverage data was found at all -- the actual
 * enforcement is `coverageThreshold` in each package's bunfig.toml, and this
 * script must never become a second, competing gate.
 */
import fs from 'fs';
import path from 'path';

type Totals = {
  linesHit: number;
  linesFound: number;
  funcsHit: number;
  funcsFound: number;
};

const PACKAGES_DIR = 'packages';

function emptyTotals(): Totals {
  return { linesHit: 0, linesFound: 0, funcsHit: 0, funcsFound: 0 };
}

function parseLcov(contents: string): Totals {
  const totals = emptyTotals();

  for (const line of contents.split('\n')) {
    if (line.startsWith('LF:')) totals.linesFound += Number(line.slice(3));
    else if (line.startsWith('LH:')) totals.linesHit += Number(line.slice(3));
    else if (line.startsWith('FNF:')) totals.funcsFound += Number(line.slice(4));
    else if (line.startsWith('FNH:')) totals.funcsHit += Number(line.slice(4));
  }

  return totals;
}

function percent(hit: number, found: number): string {
  if (found === 0) {
    return 'n/a';
  }
  return `${((hit / found) * 100).toFixed(2)}%`;
}

function row(name: string, t: Totals): string {
  return `| \`${name}\` | ${percent(t.linesHit, t.linesFound)} | ${t.linesHit}/${t.linesFound} `
    + `| ${percent(t.funcsHit, t.funcsFound)} | ${t.funcsHit}/${t.funcsFound} |`;
}

function main(): void {
  const packageNames = fs.existsSync(PACKAGES_DIR)
    ? fs.readdirSync(PACKAGES_DIR).sort()
    : [];

  const found: Array<{ name: string; totals: Totals }> = [];

  for (const name of packageNames) {
    const lcovPath = path.join(PACKAGES_DIR, name, 'coverage', 'lcov.info');
    if (fs.existsSync(lcovPath)) {
      found.push({ name, totals: parseLcov(fs.readFileSync(lcovPath, 'utf-8')) });
    }
  }

  if (found.length === 0) {
    console.error(
      `No coverage data found. Expected ${PACKAGES_DIR}/*/coverage/lcov.info -- `
      + `run \`bun run test\` first (each package's bunfig.toml sets coverageReporter).`,
    );
    process.exit(1);
  }

  const combined = found.reduce((acc, { totals }) => ({
    linesHit: acc.linesHit + totals.linesHit,
    linesFound: acc.linesFound + totals.linesFound,
    funcsHit: acc.funcsHit + totals.funcsHit,
    funcsFound: acc.funcsFound + totals.funcsFound,
  }), emptyTotals());

  const lines = [
    '## Code coverage',
    '',
    'Weighted (covered / total), computed from lcov — not Bun\'s unweighted `All files` mean.',
    '',
    '| Package | Lines | | Functions | |',
    '| --- | --- | --- | --- | --- |',
    ...found.map(({ name, totals }) => row(name, totals)),
    row('all packages', combined),
    '',
    'Per-file floors are enforced by `coverageThreshold` in each package\'s `bunfig.toml`;',
    'a breach fails the test job rather than this summary.',
  ];

  const markdown = `${lines.join('\n')}\n`;
  console.log(markdown);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined && summaryPath !== '') {
    fs.appendFileSync(summaryPath, markdown);
  }
}

main();
