import { ExitCode } from '../exit-codes';

/**
 * Exit codes are part of the CLI's machine-readable contract: shell scripts and
 * CI pipelines branch on them. These tests exist so that renumbering a member
 * fails here rather than silently in someone's pipeline.
 *
 * If you are adding a code, append the next unused integer, add a row to the
 * table in exit-codes.ts, and add it to `documented` below.
 */
const documented: { [member: string]: number } = {
  Success: 0,
  ErrorLoadingConfig: 1,
  ErrorLoadingInputs: 2,
  ErrorMerging: 3,
  ErrorUncaught: 4,
  ErrorUnsafePath: 5,
  ErrorInputUrlStatus: 6,
};

describe('ExitCode contract', () => {
  Object.keys(documented).forEach(member => {
    it(`keeps ExitCode.${member} at ${documented[member]}`, () => {
      expect(ExitCode[member as keyof typeof ExitCode]).toBe(documented[member]);
    });
  });

  it('has no members beyond the documented set', () => {
    const actual = Object.keys(ExitCode).filter(key => isNaN(Number(key))).sort();

    expect(actual).toEqual(Object.keys(documented).sort());
  });

  it('assigns every member a distinct value', () => {
    const values = Object.keys(documented).map(member => documented[member]);

    expect(new Set(values).size).toBe(values.length);
  });

  it('follows the POSIX convention that success is zero', () => {
    expect(ExitCode.Success).toBe(0);
  });
});
