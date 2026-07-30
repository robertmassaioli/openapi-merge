import { interpolateHeaders, MissingEnvironmentVariableError } from '../interpolate-headers';

/**
 * Environment interpolation for inputURL headers (issue #61).
 *
 * The point of the feature is that a credential never has to be committed, so
 * the behaviour that matters most is what happens when a referenced variable is
 * absent: it must fail loudly. Substituting an empty string would send
 * `Authorization: Bearer ` and surface as a 401 that looks like the server
 * rejecting valid credentials.
 */
describe('interpolateHeaders (issue #61)', () => {
  it('substitutes a single variable', () => {
    const result = interpolateHeaders({ Authorization: 'Bearer ${TOKEN}' }, { TOKEN: 'abc123' });

    expect(result).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('substitutes several variables across several headers', () => {
    const result = interpolateHeaders(
      { Authorization: 'Bearer ${TOKEN}', 'X-API-Key': '${KEY}', Accept: 'application/json' },
      { TOKEN: 't', KEY: 'k' },
    );

    expect(result).toEqual({ Authorization: 'Bearer t', 'X-API-Key': 'k', Accept: 'application/json' });
  });

  it('substitutes the same variable more than once in one value', () => {
    const result = interpolateHeaders({ 'X-Pair': '${A}:${A}' }, { A: 'x' });

    expect(result).toEqual({ 'X-Pair': 'x:x' });
  });

  it('leaves headers with no references untouched', () => {
    const result = interpolateHeaders({ Accept: 'application/json' }, {});

    expect(result).toEqual({ Accept: 'application/json' });
  });

  it('throws when a referenced variable is unset, rather than sending an empty value', () => {
    expect(() => interpolateHeaders({ Authorization: 'Bearer ${NOPE}' }, {})).toThrow(
      MissingEnvironmentVariableError,
    );
  });

  it('names every missing variable at once', () => {
    // Three unset tokens should be learned on the first run, not one per run.
    try {
      interpolateHeaders({ A: '${ONE}', B: '${TWO}', C: '${THREE}' }, {});
      throw new Error('expected interpolateHeaders to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingEnvironmentVariableError);
      expect((e as MissingEnvironmentVariableError).variableNames.sort()).toEqual(['ONE', 'THREE', 'TWO']);
    }
  });

  it('treats an empty-string variable as set', () => {
    // Deliberately distinct from unset: someone may legitimately export an
    // empty value, and second-guessing that would be worse than honouring it.
    const result = interpolateHeaders({ 'X-Thing': '[${EMPTY}]' }, { EMPTY: '' });

    expect(result).toEqual({ 'X-Thing': '[]' });
  });

  it('ignores text that merely looks like a reference', () => {
    const result = interpolateHeaders({ 'X-Literal': '$NOTAREF and ${ }' }, {});

    expect(result).toEqual({ 'X-Literal': '$NOTAREF and ${ }' });
  });

  it('does not mutate the headers it was given', () => {
    const headers = { Authorization: 'Bearer ${TOKEN}' };
    interpolateHeaders(headers, { TOKEN: 'abc' });

    expect(headers).toEqual({ Authorization: 'Bearer ${TOKEN}' });
  });
});
