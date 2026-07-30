import { synthesizeConfiguration } from '../synthesize-configuration';

/**
 * Building a Configuration from command-line arguments (issue #45).
 *
 * A pure function, tested directly: the output-path defaulting depends on the
 * working directory once it reaches the CLI, and asserting on it there would
 * either write into the repository or prove nothing.
 */
describe('synthesizeConfiguration (issue #45)', () => {
  it('turns local paths into inputFile entries', () => {
    const config = synthesizeConfiguration(['a.yaml', 'b.yaml'], { output: './out.yaml' });

    expect(config).toEqual({
      inputs: [{ inputFile: 'a.yaml' }, { inputFile: 'b.yaml' }],
      output: './out.yaml',
    });
  });

  it('turns http and https arguments into inputURL entries', () => {
    const config = synthesizeConfiguration(
      ['https://example.com/a.json', 'http://example.com/b.json'],
      { output: './out.json' },
    );

    expect(config).toEqual({
      inputs: [{ inputURL: 'https://example.com/a.json' }, { inputURL: 'http://example.com/b.json' }],
      output: './out.json',
    });
  });

  it('mixes files and URLs in one merge', () => {
    const config = synthesizeConfiguration(['./local.yaml', 'https://example.com/remote.yaml'], {});

    expect(config).toEqual({
      inputs: [{ inputFile: './local.yaml' }, { inputURL: 'https://example.com/remote.yaml' }],
      output: './merged.yaml',
    });
  });

  it('rejects an empty input list with an actionable message', () => {
    const result = synthesizeConfiguration([], {});

    expect(typeof result).toBe('string');
    expect(result).toContain('--config');
  });

  describe('default output path', () => {
    it('follows a .yaml first input', () => {
      expect(synthesizeConfiguration(['a.yaml'], {})).toMatchObject({ output: './merged.yaml' });
    });

    it('follows a .yml first input, keeping the short spelling', () => {
      expect(synthesizeConfiguration(['a.yml'], {})).toMatchObject({ output: './merged.yml' });
    });

    it('falls back to .json for a .json input', () => {
      expect(synthesizeConfiguration(['a.json'], {})).toMatchObject({ output: './merged.json' });
    });

    it('falls back to .json when the first input has no extension', () => {
      expect(synthesizeConfiguration(['spec'], {})).toMatchObject({ output: './merged.json' });
    });

    it('is decided by the FIRST input, not a later one', () => {
      expect(synthesizeConfiguration(['a.yaml', 'b.json'], {})).toMatchObject({ output: './merged.yaml' });
    });

    it('ignores a URL query string when reading the extension', () => {
      // `spec.yaml?v=2` must not become `merged.yaml?v=2`.
      expect(synthesizeConfiguration(['https://example.com/spec.yaml?v=2'], {})).toMatchObject({
        output: './merged.yaml',
      });
    });

    it('is overridden by an explicit output', () => {
      expect(synthesizeConfiguration(['a.yaml'], { output: './somewhere/else.json' })).toMatchObject({
        output: './somewhere/else.json',
      });
    });
  });

  describe('flags applied uniformly to every input', () => {
    it('applies a dispute prefix to all inputs', () => {
      const config = synthesizeConfiguration(['a.json', 'b.json'], { disputePrefix: 'Svc' });

      expect(config).toMatchObject({
        inputs: [
          { inputFile: 'a.json', dispute: { prefix: 'Svc' } },
          { inputFile: 'b.json', dispute: { prefix: 'Svc' } },
        ],
      });
    });

    it('applies path modification to all inputs', () => {
      const config = synthesizeConfiguration(['a.json'], { prepend: '/api', stripStart: '/v1' });

      expect(config).toMatchObject({
        inputs: [{ inputFile: 'a.json', pathModification: { prepend: '/api', stripStart: '/v1' } }],
      });
    });

    it('omits pathModification entirely when neither flag is given', () => {
      const config = synthesizeConfiguration(['a.json'], {});

      // Not `pathModification: {}` -- the schema is generated with
      // --noExtraProps and an empty object is meaningless noise in the config
      // this then validates.
      expect(config).toEqual({ inputs: [{ inputFile: 'a.json' }], output: './merged.json' });
    });
  });
});
