import {
  buildConfiguration, CandidateFile, chosenInputs, classify, isScannable, OptionalFieldBlock, PER_INPUT_OPTIONAL_BLOCKS,
  PLACEHOLDER_INPUT, renderInitYaml, selectInputs, suggestedOutput, TOP_LEVEL_OPTIONAL_BLOCKS,
} from '../init-command';
import { load as loadYaml } from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import ConfigurationSchema from '../configuration.schema.json';
import { Configuration } from '../data';

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

  it('never scans either default configuration filename', () => {
    // Not just the one `init` currently writes -- a leftover openapi-merge.json
    // from before this tool wrote YAML is not an OpenAPI document either.
    expect(isScannable('openapi-merge.yaml')).toBe(false);
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

/**
 * `renderInitYaml` -- the file `init` actually writes.
 *
 * The comments are the whole point of 34, so "it produces a string" is not
 * enough: these tests check that the comments are inert (the active part is
 * exactly what `buildConfiguration` would have produced), and that every
 * commented block, uncommented in isolation, is something the real schema
 * accepts -- not just plausible-looking YAML.
 */
describe('init YAML rendering (renderInitYaml)', () => {
  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(ConfigurationSchema);

  /** Parses just the active (uncommented) part of a rendered file. */
  function parseActive(rendered: string): unknown {
    return loadYaml(rendered);
  }

  function render(inputs: ReadonlyArray<string>): string {
    return renderInitYaml(chosenInputs(inputs), buildConfiguration(inputs).output);
  }

  describe('the active part is inert -- comments add nothing to what is parsed', () => {
    it('with several inputs', () => {
      const inputs = ['./service-a.yaml', './service-b.yaml'];
      expect(parseActive(render(inputs))).toEqual(buildConfiguration(inputs));
    });

    it('with a single input', () => {
      const inputs = ['./only.yaml'];
      expect(parseActive(render(inputs))).toEqual(buildConfiguration(inputs));
    });

    it('with no inputs -- the placeholder case', () => {
      expect(parseActive(render([]))).toEqual(buildConfiguration([]));
    });
  });

  it('the active document validates against the real configuration schema', () => {
    expect(validate(parseActive(render(['./a.yaml', './b.yaml', './c.yaml'])))).toBe(true);
  });

  it('is deterministic -- the same inputs render the same bytes twice', () => {
    const inputs = ['./a.yaml', './b.yaml'];
    expect(render(inputs)).toBe(render(inputs));
  });

  it('quotes an input path with YAML-special characters so the file still parses as a scalar', () => {
    // Unquoted, js-yaml would read "a: b.yaml" as a nested mapping key rather
    // than a plain string -- this is what yamlScalar() exists to prevent.
    const inputs = ['./a: b.yaml'];
    const rendered = render(inputs);
    const parsed = parseActive(rendered) as Configuration;

    expect(parsed.inputs).toEqual([{ inputFile: './a: b.yaml' }]);
    expect(validate(parsed)).toBe(true);
  });

  it('shows the full per-input block exactly once, regardless of how many inputs were found', () => {
    const rendered = render(['./a.yaml', './b.yaml', './c.yaml']);

    for (const block of PER_INPUT_OPTIONAL_BLOCKS) {
      const occurrences = rendered.split(`# ${block.name}:`).length - 1;
      expect(occurrences).toBe(1);
    }
    // Every input after the first points back at it instead of repeating it.
    const pointerOccurrences = rendered.split('see the commented block under the first input above').length - 1;
    expect(pointerOccurrences).toBe(2);
  });

  it('attaches the per-input block to the one placeholder input when nothing was found', () => {
    const rendered = render([]);

    for (const block of PER_INPUT_OPTIONAL_BLOCKS) {
      expect(rendered).toContain(`# ${block.name}:`);
    }
  });

  describe('field coverage matches data.ts', () => {
    it('every optional top-level Configuration field is represented', () => {
      // Cross-checked by hand against Configuration in data.ts. Update this list
      // (and TOP_LEVEL_OPTIONAL_BLOCKS) if a field is added, renamed or removed.
      const expected = [
        'outputRoot', 'formatting', 'serversStrategy', 'securitySchemesStrategy', 'pruneUnusedComponents', 'info',
      ];
      expect(TOP_LEVEL_OPTIONAL_BLOCKS.map(block => block.name).sort()).toEqual([...expected].sort());
    });

    it('every optional per-input field (ConfigurationInputBase + DisputeV2) is represented', () => {
      // Cross-checked by hand against ConfigurationInputBase and DisputeV2 in
      // data.ts. Update this list (and PER_INPUT_OPTIONAL_BLOCKS) if a field is
      // added, renamed or removed. Deliberately excludes the deprecated
      // `disputePrefix` (DisputeV1) -- see the note on TOP_LEVEL_OPTIONAL_BLOCKS.
      const expected = ['pathModification', 'operationSelection', 'description', 'duplicatePathHandling', 'tag', 'dispute'];
      expect(PER_INPUT_OPTIONAL_BLOCKS.map(block => block.name).sort()).toEqual([...expected].sort());
    });
  });

  describe('every commented block is independently valid once uncommented', () => {
    // Not "uncomment everything at once": `dispute` is prefix XOR suffix, and
    // an input is inputFile XOR inputURL, so an all-uncommented document would
    // fail ajv for reasons that have nothing to do with whether any individual
    // block is correct. Each block is tested in isolation instead, merged into
    // an otherwise-minimal, otherwise-valid base document.

    const baseInputs = ['./a.yaml', './b.yaml'];
    const baseConfig = buildConfiguration(baseInputs) as Configuration;

    for (const block of TOP_LEVEL_OPTIONAL_BLOCKS) {
      it(`top-level: ${block.name}`, () => {
        const fragment = loadYaml(block.yaml) as Partial<Configuration>;
        const doc = { ...baseConfig, ...fragment };

        expect(validate(doc)).toBe(true);
      });
    }

    for (const block of PER_INPUT_OPTIONAL_BLOCKS) {
      it(`per-input: ${block.name}`, () => {
        const fragment = loadYaml(block.yaml) as Record<string, unknown>;
        const doc: Configuration = {
          ...baseConfig,
          inputs: [{ ...baseConfig.inputs[0], ...fragment }, ...baseConfig.inputs.slice(1)],
        };

        expect(validate(doc)).toBe(true);
      });
    }
  });

  describe('a block uncommented in place in the real rendered file, not just in isolation', () => {
    // The two describe blocks above validate `block.yaml` at zero indent --
    // the *source* string, which never actually passes through
    // renderCommentedBlock. What they cannot catch is a rendering bug in how
    // much indent gets applied where -- in particular the +4 (not +2) hop
    // from a list item's own line to its sibling keys
    // (PER_INPUT_BLOCK_INDENT). These tests take the literal string `init`
    // writes, strip the comment marker off one block's own YAML lines --
    // leaving its explanation line commented, the way a person editing the
    // file would actually uncomment a setting -- and parse and validate the
    // *whole resulting document*.

    function findBlock(blocks: ReadonlyArray<OptionalFieldBlock>, name: string): OptionalFieldBlock {
      const found = blocks.find(block => block.name === name);
      if (found === undefined) {
        throw new Error(`No block named '${name}'`);
      }
      return found;
    }

    /** Strips the `indent + '# '` prefix from exactly one block's YAML lines within a rendered file. */
    function uncommentBlockInPlace(rendered: string, block: OptionalFieldBlock, indent: string): string {
      const yamlLines = block.yaml.split('\n');
      const commentedLines = yamlLines.map(line => `${indent}# ${line}`);
      const uncommentedLines = yamlLines.map(line => `${indent}${line}`);

      const lines = rendered.split('\n');
      const start = lines.findIndex((_line, i) => commentedLines.every((expected, j) => lines[i + j] === expected));
      if (start === -1) {
        throw new Error(`Could not find '${block.name}' rendered at indent ${JSON.stringify(indent)}`);
      }

      lines.splice(start, commentedLines.length, ...uncommentedLines);
      return lines.join('\n');
    }

    it('a top-level block (zero indent)', () => {
      const block = findBlock(TOP_LEVEL_OPTIONAL_BLOCKS, 'formatting');
      const rendered = render(['./a.yaml']);

      const doc = loadYaml(uncommentBlockInPlace(rendered, block, ''));

      expect(validate(doc)).toBe(true);
    });

    it('a per-input block (the +4 hop into a list item)', () => {
      const block = findBlock(PER_INPUT_OPTIONAL_BLOCKS, 'tag');
      const rendered = render(['./a.yaml', './b.yaml']);

      const doc = loadYaml(uncommentBlockInPlace(rendered, block, '    '));

      expect(validate(doc)).toBe(true);
    });
  });
});
