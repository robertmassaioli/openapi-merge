import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonOrYamlParseError, readFileAsString, readYamlOrJSON } from '../file-loading';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-merge-cli-file-loading-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readFileAsString', () => {
  it('reads UTF-8 contents back verbatim', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(filePath, 'hello world');

    expect(await readFileAsString(filePath)).toBe('hello world');
  });

  it('round-trips non-ASCII characters', async () => {
    const filePath = path.join(tmpDir, 'u.txt');
    fs.writeFileSync(filePath, 'résumé — 日本語');

    expect(await readFileAsString(filePath)).toBe('résumé — 日本語');
  });

  it('reads an empty file as an empty string', async () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(filePath, '');

    expect(await readFileAsString(filePath)).toBe('');
  });

  it('rejects when the file does not exist', async () => {
    let message = '';
    try {
      await readFileAsString(path.join(tmpDir, 'missing.txt'));
    } catch (e) {
      message = String(e);
    }

    expect(message).toContain('ENOENT');
  });
});

describe('readYamlOrJSON', () => {
  it('parses JSON without falling through to YAML', async () => {
    const parsed = await readYamlOrJSON('{"openapi":"3.0.3","info":{"title":"t","version":"1"}}');

    expect(parsed).toEqual({ openapi: '3.0.3', info: { title: 't', version: '1' } });
  });

  it('parses YAML when JSON parsing fails', async () => {
    const parsed = await readYamlOrJSON('openapi: 3.0.3\ninfo:\n  title: t\n  version: "1"\n');

    expect(parsed).toEqual({ openapi: '3.0.3', info: { title: 't', version: '1' } });
  });

  it('parses a JSON scalar', async () => {
    expect(await readYamlOrJSON('42')).toBe(42);
  });

  it('throws JsonOrYamlParseError when the input is neither JSON nor YAML', async () => {
    // Valid as neither: an unterminated JSON object whose second line is also
    // invalid YAML (a tab-indented sequence item).
    const bad = '{ "openapi": "3.0.3"\n\t- not valid';

    let caught: unknown;
    try {
      await readYamlOrJSON(bad);
    } catch (e) {
      caught = e;
    }

    expect(caught instanceof JsonOrYamlParseError).toBe(true);
  });

  it('reports both the JSON and the YAML error in its message', async () => {
    const bad = '{ "openapi": "3.0.3"\n\t- not valid';

    let message = '';
    try {
      await readYamlOrJSON(bad);
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('JSON Error:');
    expect(message).toContain('YAML Error:');
    expect(message).toContain('Failed to parse the input as either JSON or YAML.');
  });
});

describe('issue #165: double-quoted scalar with line continuation', () => {
  // https://github.com/robertmassaioli/openapi-merge/issues/165
  //
  // The reporter's YAML nests a double-quoted, line-continued scalar
  // (`"...;\` + `\  ...` on the next line) inside a sequence item, with the
  // continuation line indented to the *same* column as the `description:`
  // key itself (4 spaces). This reproduces their exact error, including the
  // reported column (`(11:5)` in their trace vs. `(4:5)` here, both column
  // 5 -- the offset is just where `tags:` starts in each file).
  //
  // Two independent YAML 1.2 parsers (js-yaml 5 here, and the `yaml` npm
  // package used as a cross-check) both reject this input and both accept
  // it once the continuation line is indented one column further (5
  // spaces, past the key). That agreement indicates the input is genuinely
  // invalid per the spec -- a folded line inside a double-quoted scalar
  // must be indented *more* than the enclosing block node, and equal
  // indentation is "deficient". js-yaml 3 (used through 1.3.2) was lenient
  // and accepted it anyway; js-yaml 5 (used since 2.0.0) does not. So this
  // looks like a stricter, spec-compliant transitive dependency upgrade
  // surfacing a pre-existing issue in the input file, not YAML handling
  // that openapi-merge-cli implements itself -- worth confirming with the
  // reporter whether their actual file has this same-column indentation.
  const deficientIndentation = [
    'tags:',
    '  - name: My-service processing',
    '    description: "Processing My-service incoming requests: validates input from the client service;\\',
    '    \\ forwards enriched data to the downstream service."',
    '',
  ].join('\n');

  it('reproduces the reported parse failure for continuation lines indented the same as their key', async () => {
    let caught: unknown;
    try {
      await readYamlOrJSON(deficientIndentation);
    } catch (e) {
      caught = e;
    }

    expect(caught instanceof JsonOrYamlParseError).toBe(true);
    expect((caught as Error).message).toContain('deficient indentation');
  });

  it('parses successfully once the continuation line is indented past its key (valid YAML)', async () => {
    const validlyIndented = [
      'tags:',
      '  - name: My-service processing',
      '    description: "Processing My-service incoming requests: validates input from the client service;\\',
      '     \\ forwards enriched data to the downstream service."',
      '',
    ].join('\n');

    const parsed = await readYamlOrJSON(validlyIndented);

    expect(parsed).toEqual({
      tags: [
        {
          name: 'My-service processing',
          description: 'Processing My-service incoming requests: validates input from the client service; forwards enriched data to the downstream service.',
        },
      ],
    });
  });
});

describe('JsonOrYamlParseError', () => {
  it('is an Error carrying both underlying messages', () => {
    const error = new JsonOrYamlParseError(new Error('bad json'), new Error('bad yaml'));

    expect(error instanceof Error).toBe(true);
    expect(error.message).toContain('bad json');
    expect(error.message).toContain('bad yaml');
  });
});
