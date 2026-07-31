import { merge } from '../index';
import { doc30, doc31, expectSuccess, ok, op, tagged } from './_helpers/documents';

/**
 * Issue #112: tagging every operation from one input.
 *
 * Lets a merged document say which service an operation came from without
 * anyone editing the upstream specifications, which are usually owned by
 * another team. The complement to the tag *filtering* in #100 and #111.
 */
describe('tag injection (issue #112)', () => {
  const opTags = (output: ReturnType<typeof expectSuccess>, path: string): string[] | undefined =>
    output.paths?.[path]?.get?.tags;

  it('adds the tag to every operation from that input', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: op('a') }, '/b': { get: op('b') } } }),
          tag: { name: 'billing' },
        },
      ]),
    );

    expect(opTags(output, '/a')).toEqual(['billing']);
    expect(opTags(output, '/b')).toEqual(['billing']);
  });

  it('leaves other inputs untagged', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30({ paths: { '/a': { get: op('a') } } }), tag: { name: 'billing' } },
        { oas: doc30({ paths: { '/b': { get: op('b') } } }) },
      ]),
    );

    expect(opTags(output, '/a')).toEqual(['billing']);
    expect(opTags(output, '/b')).toBeUndefined();
  });

  it("appends to an operation's existing tags rather than replacing them", () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: tagged('a', ['reports']) } } }),
          tag: { name: 'billing' },
        },
      ]),
    );

    // The operation's own tags say what it does; the injected one says where it
    // came from. Both are worth keeping.
    expect(opTags(output, '/a')).toEqual(['reports', 'billing']);
  });

  it('does not duplicate a tag the operation already carries', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: tagged('a', ['billing']) } } }),
          tag: { name: 'billing' },
        },
      ]),
    );

    expect(opTags(output, '/a')).toEqual(['billing']);
  });

  it('declares the injected tag in the top-level tags array', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/a': { get: op('a') } } }),
          tag: { name: 'billing', description: 'The billing service.' },
        },
      ]),
    );

    // Operations carrying a tag the document never declares is legal but
    // unhelpful for anything building navigation from `tags`.
    expect(output.tags).toEqual([{ name: 'billing', description: 'The billing service.' }]);
  });

  it('omits the description key entirely when none is given', () => {
    const output = expectSuccess(
      merge([{ oas: doc30({ paths: { '/a': { get: op('a') } } }), tag: { name: 'billing' } }]),
    );

    expect(output.tags).toEqual([{ name: 'billing' }]);
  });

  it('keeps the first description when two inputs inject the same tag', () => {
    const output = expectSuccess(
      merge([
        { oas: doc30({ paths: { '/a': { get: op('a') } } }), tag: { name: 'shared', description: 'First.' } },
        { oas: doc30({ paths: { '/b': { get: op('b') } } }), tag: { name: 'shared', description: 'Second.' } },
      ]),
    );

    expect(output.tags).toEqual([{ name: 'shared', description: 'First.' }]);
    expect(opTags(output, '/a')).toEqual(['shared']);
    expect(opTags(output, '/b')).toEqual(['shared']);
  });

  it('keeps an input\'s own tag declarations alongside the injected one', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({
            paths: { '/a': { get: tagged('a', ['reports']) } },
            tags: [{ name: 'reports', description: 'Reporting.' }],
          }),
          tag: { name: 'billing' },
        },
      ]),
    );

    expect(output.tags).toEqual([{ name: 'billing' }, { name: 'reports', description: 'Reporting.' }]);
  });

  it('runs after operationSelection, so the injected tag cannot affect filtering', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc30({ paths: { '/keep': { get: tagged('keep', ['public']) }, '/drop': { get: tagged('drop', ['internal']) } } }),
          operationSelection: { includeTags: ['public'] },
          tag: { name: 'internal' },
        },
      ]),
    );

    // `/drop` is excluded because includeTags saw only the author's tags.
    // Injecting first would have made includeTags: ['internal'] match
    // everything -- a filter that appears to do nothing.
    expect(Object.keys(output.paths ?? {})).toEqual(['/keep']);
    expect(opTags(output, '/keep')).toEqual(['public', 'internal']);
  });

  it('tags webhook operations too', () => {
    const output = expectSuccess(
      merge([
        {
          oas: doc31({ paths: {}, webhooks: { ping: { post: { operationId: 'ping', responses: ok } } } }),
          tag: { name: 'billing' },
        },
      ]),
    );

    expect(output.webhooks?.ping?.post?.tags).toEqual(['billing']);
  });

  it('does not mutate the input document', () => {
    const input = { oas: doc30({ paths: { '/a': { get: op('a') } } }), tag: { name: 'billing' } };
    merge([input]);

    expect(input.oas.paths?.['/a']?.get?.tags).toBeUndefined();
  });
});
