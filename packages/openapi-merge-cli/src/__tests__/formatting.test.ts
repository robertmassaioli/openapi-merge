import { DEFAULT_INDENT, Indent } from '../data';
import { indentToJsonStringifyArg, indentToYamlArg } from '../formatting';
import { validateConfigurationSemantics } from '../load-configuration';

describe('indentToJsonStringifyArg', () => {
  it('returns the width as a number for spaces', () => {
    expect(indentToJsonStringifyArg({ style: 'spaces', width: 2 })).toBe(2);
    expect(indentToJsonStringifyArg({ style: 'spaces', width: 4 })).toBe(4);
    expect(indentToJsonStringifyArg({ style: 'spaces', width: 8 })).toBe(8);
  });

  it('returns a tab character for tabs', () => {
    expect(indentToJsonStringifyArg({ style: 'tabs' })).toBe('\t');
  });

  it('falls back to DEFAULT_INDENT when called with no argument', () => {
    // Sanity-check that DEFAULT_INDENT is the historical 2-space default.
    expect(DEFAULT_INDENT).toEqual({ style: 'spaces', width: 2 });
    expect(indentToJsonStringifyArg()).toBe(2);
    // Compile-time narrowing demo: after this check, DEFAULT_INDENT is a SpaceIndent.
    if (DEFAULT_INDENT.style === 'spaces') {
      expect(DEFAULT_INDENT.width).toBe(2);
    }
  });

  it('produces JSON output matching the historical default at the default indent', () => {
    const obj = { a: 1, b: { c: 2 } };
    const expected = JSON.stringify(obj, null, 2);
    const actual = JSON.stringify(obj, null, indentToJsonStringifyArg());
    expect(actual).toBe(expected);
  });

  it('produces tab-indented JSON when style is tabs', () => {
    const obj = { a: 1, b: { c: 2 } };
    const out = JSON.stringify(obj, null, indentToJsonStringifyArg({ style: 'tabs' }));
    expect(out).toContain('\n\t"a"');
    expect(out).toContain('\n\t"b"');
    expect(out).toContain('\n\t\t"c"');
  });
});

describe('indentToYamlArg', () => {
  it('returns the width as a number for spaces', () => {
    expect(indentToYamlArg({ style: 'spaces', width: 4 })).toBe(4);
  });

  it('falls back to DEFAULT_INDENT.width when called with no argument', () => {
    // Narrow DEFAULT_INDENT before reading `.width` (the type system
    // requires this; at runtime DEFAULT_INDENT is statically a SpaceIndent).
    if (DEFAULT_INDENT.style !== 'spaces') {
      throw new Error('DEFAULT_INDENT changed unexpectedly');
    }
    expect(indentToYamlArg()).toBe(DEFAULT_INDENT.width);
  });

  it('defensively returns the default width when called with tabs (should not happen in practice)', () => {
    // validateConfigurationSemantics should have rejected this config before we reach
    // this code path. If it doesn't, we fall back rather than throwing.
    if (DEFAULT_INDENT.style !== 'spaces') {
      throw new Error('DEFAULT_INDENT changed unexpectedly');
    }
    expect(indentToYamlArg({ style: 'tabs' })).toBe(DEFAULT_INDENT.width);
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
