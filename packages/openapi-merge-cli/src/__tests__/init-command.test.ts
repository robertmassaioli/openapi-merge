import {
  buildConfiguration, CandidateFile, classify, isScannable, PLACEHOLDER_INPUT, selectInputs, suggestedOutput,
} from '../init-command';

/**
 * The decisions behind `openapi-merge-cli init` (see init-command.ts).
 *
 * Pure functions, tested directly. What matters most is what the scan
 * *rejects*: `init` runs in a working directory full of files that are not
 * specifications, and a generator that sweeps up `package.json` is worse than
 * one that finds nothing.
 */
describe('init scanning (classify)', () => {
  it('accepts an OpenAPI 3.0 document', () => {
    expect(classify({ openapi: '3.0.3', info: {}, paths: {} })).toEqual({ kind: 'openapi', version: '3.0.3' });
  });

  it('accepts 3.1 and 3.2', () => {
    expect(classify({ openapi: '3.1.0' })).toEqual({ kind: 'openapi', version: '3.1.0' });
    expect(classify({ openapi: '3.2.0' })).toEqual({ kind: 'openapi', version: '3.2.0' });
  });

  it('recognises Swagger 2.0 separately rather than ignoring it', () => {
    // People do try to merge 2.0 documents (issue #110); being told "found but
    // unsupported" is more useful than silence.
    expect(classify({ swagger: '2.0', info: {}, paths: {} })).toEqual({ kind: 'swagger2' });
  });

  it('rejects a package.json', () => {
    expect(classify({ name: 'thing', version: '1.0.0', dependencies: {} })).toEqual({ kind: 'not-a-spec' });
  });

  it('rejects a tsconfig', () => {
    expect(classify({ compilerOptions: { strict: true } })).toEqual({ kind: 'not-a-spec' });
  });

  it('rejects an openapi-merge configuration, which is JSON with inputs', () => {
    expect(classify({ inputs: [{ inputFile: './a.yaml' }], output: './out.yaml' })).toEqual({ kind: 'not-a-spec' });
  });

  it('rejects a future major version this tool cannot merge', () => {
    expect(classify({ openapi: '4.0.0' })).toEqual({ kind: 'not-a-spec' });
  });

  it('rejects a non-string openapi field', () => {
    expect(classify({ openapi: 3 })).toEqual({ kind: 'not-a-spec' });
  });

  it('rejects things that are not objects at all', () => {
    for (const value of [null, undefined, 'a string', 42, ['an', 'array']]) {
      expect(classify(value).kind).toBe(value instanceof Array ? 'not-a-spec' : 'not-a-spec');
    }
  });
});

describe('init scanning (isScannable)', () => {
  it('accepts json, yaml and yml', () => {
    expect(['a.json', 'a.yaml', 'a.yml'].every(isScannable)).toBe(true);
  });

  it('is case-insensitive about the extension', () => {
    expect(isScannable('API.YAML')).toBe(true);
  });

  it('rejects other extensions without opening them', () => {
    expect(['a.ts', 'a.md', 'README', 'a.jsonc', 'a.yaml.bak'].some(isScannable)).toBe(false);
  });

  it('never scans the configuration file it is about to write', () => {
    expect(isScannable('openapi-merge.json')).toBe(false);
  });
});

describe('init input selection', () => {
  const file = (relativePath: string, parsed: unknown): CandidateFile => ({ relativePath, parsed });
  const spec = (version: string) => ({ openapi: version, info: { title: 'T', version: '1' }, paths: {} });

  it('picks only the OpenAPI files', () => {
    const result = selectInputs([
      file('./package.json', { name: 'p' }),
      file('./api.yaml', spec('3.0.3')),
      file('./tsconfig.json', { compilerOptions: {} }),
    ]);

    expect(result.inputs).toEqual(['./api.yaml']);
  });

  it('sorts by path, so two runs produce the same file', () => {
    // Directory iteration order is not guaranteed, and a generator whose output
    // varies between runs makes for confusing diffs.
    const result = selectInputs([
      file('./zebra.yaml', spec('3.0.3')),
      file('./alpha.yaml', spec('3.0.3')),
      file('./middle.yaml', spec('3.0.3')),
    ]);

    expect(result.inputs).toEqual(['./alpha.yaml', './middle.yaml', './zebra.yaml']);
  });

  it('reports Swagger 2.0 files separately', () => {
    const result = selectInputs([file('./legacy.json', { swagger: '2.0' }), file('./api.yaml', spec('3.0.3'))]);

    expect(result.inputs).toEqual(['./api.yaml']);
    expect(result.swagger2).toEqual(['./legacy.json']);
  });

  it('treats an unparseable file as simply not a candidate', () => {
    // index.ts passes `undefined` for anything that failed to parse. A working
    // directory containing a broken YAML file is ordinary, not an error.
    const result = selectInputs([file('./broken.yaml', undefined), file('./api.yaml', spec('3.0.3'))]);

    expect(result.inputs).toEqual(['./api.yaml']);
  });

  it('reports one minor version when the inputs agree', () => {
    const result = selectInputs([file('./a.yaml', spec('3.0.0')), file('./b.yaml', spec('3.0.3'))]);

    // Differing patch levels are not a mismatch.
    expect(result.minorVersions).toEqual(['3.0']);
  });

  it('reports every minor version when they disagree', () => {
    const result = selectInputs([file('./a.yaml', spec('3.0.3')), file('./b.yaml', spec('3.1.0'))]);

    // This is what lets init warn that the config it just wrote will be
    // refused by the merge for mixed versions.
    expect(result.minorVersions).toEqual(['3.0', '3.1']);
  });

  it('reports no versions when nothing was found', () => {
    expect(selectInputs([file('./package.json', { name: 'p' })]).minorVersions).toEqual([]);
  });
});

describe('init output path', () => {
  it('follows YAML inputs', () => {
    expect(suggestedOutput(['./a.yaml', './b.yaml'])).toBe('./openapi.yaml');
  });

  it('keeps the short .yml spelling', () => {
    expect(suggestedOutput(['./a.yml'])).toBe('./openapi.yml');
  });

  it('uses JSON for JSON inputs', () => {
    expect(suggestedOutput(['./a.json'])).toBe('./openapi.json');
  });

  it('falls back to JSON for a mix, rather than guessing', () => {
    expect(suggestedOutput(['./a.yaml', './b.json'])).toBe('./openapi.json');
  });

  it('falls back to JSON when there are no inputs', () => {
    expect(suggestedOutput([])).toBe('./openapi.json');
  });
});

describe('init configuration', () => {
  it('writes one input per file found', () => {
    expect(buildConfiguration(['./a.yaml', './b.yaml'])).toEqual({
      inputs: [{ inputFile: './a.yaml' }, { inputFile: './b.yaml' }],
      output: './openapi.yaml',
    });
  });

  it('writes a placeholder rather than an empty inputs array', () => {
    // `inputs` is @minItems 1 in the generated schema, so an empty array would
    // produce a file the very next run rejects -- a generator whose output its
    // own tool refuses.
    expect(buildConfiguration([])).toEqual({
      inputs: [{ inputFile: PLACEHOLDER_INPUT }],
      // The output follows the placeholder's extension, exactly as it follows
      // real inputs -- the rule does not change just because nothing was found.
      output: './openapi.yaml',
    });
  });
});
