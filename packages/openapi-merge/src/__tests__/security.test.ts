import { merge } from '..';
import { SingleMergeInputV2 } from '../data';
import { toOAS } from './oas-generation';
import { expectMergeResult, toMergeInputs } from './test-utils';

describe('OAS Security', () => {
  it('should merge security definitions where one definition is null', () => {
    const first = toOAS({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (first as any)['securitySchemes'] = null;

    const second = toOAS(
      {},
      {
        securitySchemes: {
          secondScheme: {
            type: 'apiKey',
            name: 'second scheme',
            in: 'query'
          }
        }
      }
    );

    const output = toOAS(
      {},
      {
        securitySchemes: {
          secondScheme: {
            type: 'apiKey',
            name: 'second scheme',
            in: 'query'
          }
        }
      }
    );

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('should merge security from two files that do not overlap', () => {
    const first = toOAS(
      {},
      {
        securitySchemes: {
          firstScheme: {
            type: 'apiKey',
            name: 'first scheme',
            in: 'query'
          }
        }
      }
    );

    const second = toOAS(
      {},
      {
        securitySchemes: {
          secondScheme: {
            type: 'apiKey',
            name: 'second scheme',
            in: 'query'
          }
        }
      }
    );

    const output = toOAS(
      {},
      {
        securitySchemes: {
          firstScheme: {
            type: 'apiKey',
            name: 'first scheme',
            in: 'query'
          },
          secondScheme: {
            type: 'apiKey',
            name: 'second scheme',
            in: 'query'
          }
        }
      }
    );

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });

  it('shoud merge security for identically named schemes when dispute is flagged to mergeSecurity', () => {
    const first = toOAS(
      {},
      {
        securitySchemes: {
          provider: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: '',
                tokenUrl: '',
                scopes: {
                  'first-scope-1': '',
                  'first-scope-2': ''
                }
              }
            }
          }
        }
      }
    );

    first.servers = [{ url: 'first-server-url' }];
    first.externalDocs = { url: 'first-server-url' };
    first.security = [{ provider: [] }];

    const second = toOAS(
      {},
      {
        securitySchemes: {
          provider: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: '',
                tokenUrl: '',
                scopes: {
                  'second-scope-1': '',
                  'second-scope-2': ''
                }
              }
            }
          }
        }
      }
    );

    second.servers = [{ url: 'second-server-url' }];
    second.externalDocs = { url: 'second-server-url' };
    second.security = [{ provider: [] }];

    const mergeInputs: SingleMergeInputV2[] = toMergeInputs([first, second]);

    const output = toOAS(
      {},
      {
        securitySchemes: {
          provider: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: '',
                tokenUrl: '',
                scopes: {
                  'first-scope-1': '',
                  'first-scope-2': '',
                  'second-scope-1': '',
                  'second-scope-2': ''
                }
              }
            }
          }
        }
      }
    );

    output.servers = [{ url: 'first-server-url' }];
    output.externalDocs = { url: 'first-server-url' };
    output.security = [{ provider: [] }];
    output.tags = undefined;

    expectMergeResult(merge(mergeInputs), {
      output
    });
  });

  it('should have no security definitions if none are defined', () => {
    const first = toOAS({});
    const second = toOAS({});
    const output = toOAS({});

    expectMergeResult(merge(toMergeInputs([first, second])), {
      output
    });
  });
});
