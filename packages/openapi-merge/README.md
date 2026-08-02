# openapi-merge

This library assumes that you have a number of microservices that you wish to expose through one main service or gateway.

With this assumption in mind, it allows you to provide multiple OpenAPI 3.0, 3.1 or 3.2 files (all inputs must agree on the
same major.minor version) and have them be merged together, in a deterministic manner, into a single OpenAPI specification.

Many of the design decisions of this library have that use case in mind and thus the features will be geared to making that
be a good experience.

If you are looking for a CLI tool based on this library, then please check out: [![npm](https://img.shields.io/npm/v/openapi-merge-cli?label=openapi-merge-cli&logo=npm)](https://bit.ly/3bEVq3f)

## How to use this library

This library is intended to be used in a JavaScript or Typescript project. Here is a Typescript example that will work 100%:

``` typescript
import { merge, isErrorResult } from 'openapi-merge';
import { Swagger } from '@atlassian/atlassian-openapi';

// Does not have to use the 'SwaggerV3' type, the merge function will accept 'any' so long as the underlying object is valid
const oas1: Swagger.SwaggerV3 = {
  openapi: "3.0.2",
  info: {
    title: "First Input",
    description: "Merge conflicts often use the first element",
    version: "1.0"
  },
  paths: {
    "/cats": {
      get: {
        summary: 'Get the cats',
        responses: {
          200: {
            description: "All of the cats"
          }
        }
      }
    }
  }
};

const oas2: Swagger.SwaggerV3 = {
  openapi: "3.0.2",
  info: {
    title: "Second Input",
    version: "1.0"
  },
  paths: {
    "/dogs": {
      get: {
        summary: 'Get the dogs',
        responses: {
          200: {
            description: "All of the dogs"
          }
        }
      }
    }
  }
};

function main() {
  const mergeResult = merge([{
    oas: oas1,
    pathModification: {
      prepend: '/one'
    }
  }, {
    oas: oas2,
    pathModification: {
      prepend: '/two'
    }
  }]);

  if (isErrorResult(mergeResult)) {
    // Oops, something went wrong
    console.error(`${mergeResult.message} (${mergeResult.type})`);
  } else {
    console.log(`Merge successful!`);
    console.log(JSON.stringify(mergeResult.output, null, 2));
  }
}

main();
```

## Merge options

`merge()` takes an optional second argument, `MergeOptions`, for settings that apply to the merge as a whole rather than
to a single input:

* `pruneUnusedComponents` (default `false`): drop components nothing in the merged document references. Off by default
  because pruning is destructive; turn it on if you're using `operationSelection` to remove operations and expect their
  schemas to go with them ([issue #94](https://github.com/robertmassaioli/openapi-merge/issues/94)).
* `info`: override fields of the merged `info` object, merged field by field so overriding just `title` doesn't require
  restating `version` ([issue #102](https://github.com/robertmassaioli/openapi-merge/issues/102)).
* `serversStrategy` (default `'first'`): `'first'` keeps only the first input's `servers`; `'concat'` keeps every input's
  `servers`, deduplicated by URL ([issue #4](https://github.com/robertmassaioli/openapi-merge/issues/4)).
* `securitySchemesStrategy` (default `'merge'`): how `components.securitySchemes` is combined across inputs. Unlike
  `serversStrategy`, the default here is *not* first-wins — first-wins previously produced documents whose operations
  required a scheme the document didn't define ([issue #33](https://github.com/robertmassaioli/openapi-merge/issues/33)).
* `externalDocuments`: documents this merge may need to pull individual components out of via a cross-document `$ref`,
  keyed by the same opaque identity as each input's `sourceIdentity`. Nothing here is included in the output unless a
  `$ref` elsewhere in the merge actually asks for it ([issue #10](https://github.com/robertmassaioli/openapi-merge/issues/10)).

Each `SingleMergeInput` also has its own per-input options beyond `pathModification` — `dispute`, `operationSelection`,
`description`, `duplicatePathHandling` and `tag` — documented alongside the full type shapes in the
[generated API reference](#api-reference) below.

## Merging Behaviour

We process the inputs sequentially such that the first input in the list takes preference and subsequent inputs will be 
modified to merge seamlessly into the first.

For some parts of the OpenAPI file, like `paths`, `components` and `tags` we attempt to merge the definitions together 
such that there are no overlaps and no information is dropped.

For other elements, the algorithm's default behaviour is to take the value that is first defined in the list of OpenAPI
files — the first file effectively overrides the others, matching the "API gateway" use case mentioned above, where these
definitions are usually meant to be specific to the gateway rather than inherited from a backend. This is the behaviour for:

 - Info (further overridable per field via `MergeOptions.info`, above)
 - Servers (the `MergeOptions.serversStrategy` default; `'concat'` is available to keep every input's servers instead)
 - ExternalDocumentation

**Security Schemes are the one exception**: unlike everything above, `securitySchemesStrategy` defaults to `'merge'`, not
first-wins — see `MergeOptions.securitySchemesStrategy` above for why.

## API reference

The full type shapes for `MergeInput`, `MergeOptions`, `MergeResult` and every option mentioned above are generated
directly from the TypeScript source, so they can't drift from what the code actually accepts. Generate a local copy with:

``` shell
bun run docs
```

This writes a browsable HTML API reference to `docs-api/` (gitignored — regenerate it whenever you need it).
