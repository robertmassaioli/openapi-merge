import fs from 'fs';
import os from 'os';
import path from 'path';
import { Configuration, Indent } from '../data';
import { loadConfiguration, validateConfigurationSemantics } from '../load-configuration';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-merge-cli-load-config-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Writes `contents` to a file in the temp dir and returns its absolute path. */
function writeConfig(fileName: string, contents: string): string {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

const validConfig = {
  inputs: [{ inputFile: './a.json' }],
  output: './out.json',
};

/** `loadConfiguration` returns the error message as a plain string. */
function expectError(result: Configuration | string): string {
  if (typeof result !== 'string') {
    throw new Error(`Expected an error string, got: ${JSON.stringify(result, null, 2)}`);
  }
  return result as string;
}

function expectConfig(result: Configuration | string): Configuration {
  if (typeof result === 'string') {
    throw new Error(`Expected a Configuration, got the error: ${result}`);
  }
  return result as Configuration;
}

describe('loadConfiguration - happy paths', () => {
  it('loads a valid JSON configuration', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify(validConfig));

    const config = expectConfig(await loadConfiguration(configPath));

    expect(config.output).toBe('./out.json');
    expect(config.inputs.length).toBe(1);
  });

  it('loads an equivalent YAML configuration identically', async () => {
    const configPath = writeConfig(
      'openapi-merge.yaml',
      'inputs:\n  - inputFile: ./a.json\noutput: ./out.json\n',
    );

    const config = expectConfig(await loadConfiguration(configPath));

    expect(config).toEqual(validConfig as unknown as Configuration);
  });

  it('accepts an inputURL input', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: [{ inputURL: 'https://example.com/spec.json' }],
      output: './out.json',
    }));

    expect(expectConfig(await loadConfiguration(configPath)).inputs.length).toBe(1);
  });

  it('accepts the legacy disputePrefix field', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: [{ inputFile: './a.json', disputePrefix: 'legacy' }],
      output: './out.json',
    }));

    expect(expectConfig(await loadConfiguration(configPath)).inputs.length).toBe(1);
  });

  it('accepts a spaces indent in formatting', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      ...validConfig,
      formatting: { indent: { style: 'spaces', width: 4 } },
    }));

    expect(expectConfig(await loadConfiguration(configPath)).formatting?.indent).toEqual({
      style: 'spaces',
      width: 4,
    });
  });
});

describe('loadConfiguration - file errors', () => {
  it('reports a readable error when the file does not exist', async () => {
    const message = expectError(await loadConfiguration(path.join(tmpDir, 'nope.json')));

    expect(message).toContain('Could not find or read');
    expect(message).toContain('nope.json');
  });

  it('defaults to openapi-merge.yaml, falling back to openapi-merge.json, when no location is given', async () => {
    // Exercises the default-lookup branch (try .yaml, then .json) through its
    // failure message, which names both candidates it tried. Runs from the
    // empty temp dir rather than the test process's ambient cwd -- relying on
    // "nothing named openapi-merge.* happens to exist in the package root
    // right now" would make this test's outcome depend on what else is lying
    // around there.
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const message = expectError(await loadConfiguration());

      expect(message).toContain('openapi-merge.yaml');
      expect(message).toContain('openapi-merge.json');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('surfaces a parse failure for a file that is neither JSON nor YAML', async () => {
    const configPath = writeConfig('openapi-merge.json', '{ "inputs": [\n\t- nope');

    const message = expectError(await loadConfiguration(configPath));

    expect(message).toContain('Could not parse configuration');
  });
});

describe('loadConfiguration - schema validation', () => {
  it('rejects a config with no inputs', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({ output: './out.json' }));

    expect(expectError(await loadConfiguration(configPath))).toContain('inputs');
  });

  it('rejects a config with no output', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({ inputs: [{ inputFile: './a.json' }] }));

    expect(expectError(await loadConfiguration(configPath))).toContain('output');
  });

  it('rejects an empty inputs array', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({ inputs: [], output: './out.json' }));

    expect(expectError(await loadConfiguration(configPath))).toContain('inputs');
  });

  it('rejects inputs of the wrong type', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: 'not-an-array',
      output: './out.json',
    }));

    expect(expectError(await loadConfiguration(configPath))).toContain('inputs');
  });

  it('rejects unknown top-level fields (noExtraProps)', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      ...validConfig,
      thisFieldDoesNotExist: true,
    }));

    expect(typeof await loadConfiguration(configPath)).toBe('string');
  });
});

describe('loadConfiguration - semantic validation', () => {
  it('rejects tab indentation for a .yaml output', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: [{ inputFile: './a.json' }],
      output: './out.yaml',
      formatting: { indent: { style: 'tabs' } },
    }));

    const message = expectError(await loadConfiguration(configPath));

    expect(message).toContain('Tab indentation is not supported for YAML output');
  });

  it('rejects tab indentation for a .yml output', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: [{ inputFile: './a.json' }],
      output: './out.yml',
      formatting: { indent: { style: 'tabs' } },
    }));

    expect(expectError(await loadConfiguration(configPath))).toContain('Tab indentation');
  });

  it('allows tab indentation for a .json output', async () => {
    const configPath = writeConfig('openapi-merge.json', JSON.stringify({
      inputs: [{ inputFile: './a.json' }],
      output: './out.json',
      formatting: { indent: { style: 'tabs' } },
    }));

    expect(expectConfig(await loadConfiguration(configPath)).output).toBe('./out.json');
  });
});

describe('validateConfigurationSemantics', () => {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const baseConfig: any = { inputs: [], output: 'merged.json' };

  it('accepts a config with no formatting block', () => {
    expect(validateConfigurationSemantics(baseConfig)).toBeUndefined();
  });

  it('accepts spaces with a YAML output', () => {
    const config = { ...baseConfig, output: 'merged.yaml',
      formatting: { indent: { style: 'spaces', width: 4 } as Indent } };
    expect(validateConfigurationSemantics(config)).toBeUndefined();
  });

  it('accepts spaces with a JSON output', () => {
    const config = { ...baseConfig, output: 'merged.json',
      formatting: { indent: { style: 'spaces', width: 4 } as Indent } };
    expect(validateConfigurationSemantics(config)).toBeUndefined();
  });

  it('accepts tabs with a JSON output', () => {
    const config = { ...baseConfig, output: 'merged.json',
      formatting: { indent: { style: 'tabs' } as Indent } };
    expect(validateConfigurationSemantics(config)).toBeUndefined();
  });

  it('rejects tabs with a .yaml output', () => {
    const config = { ...baseConfig, output: 'merged.yaml',
      formatting: { indent: { style: 'tabs' } as Indent } };
    const err = validateConfigurationSemantics(config);
    expect(err).toContain('Tab indentation is not supported for YAML');
    expect(err).toContain('merged.yaml');
  });

  it('rejects tabs with a .yml output', () => {
    const config = { ...baseConfig, output: 'merged.yml',
      formatting: { indent: { style: 'tabs' } as Indent } };
    expect(validateConfigurationSemantics(config)).toContain('YAML');
  });

  it('is case-insensitive on the output extension', () => {
    const config = { ...baseConfig, output: 'MERGED.YAML',
      formatting: { indent: { style: 'tabs' } as Indent } };
    expect(validateConfigurationSemantics(config)).toContain('YAML');
  });
});
