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

describe('JsonOrYamlParseError', () => {
  it('is an Error carrying both underlying messages', () => {
    const error = new JsonOrYamlParseError(new Error('bad json'), new Error('bad yaml'));

    expect(error instanceof Error).toBe(true);
    expect(error.message).toContain('bad json');
    expect(error.message).toContain('bad yaml');
  });
});
