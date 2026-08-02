# Which package do I want?

This repository publishes two npm packages, and almost everything you read in this site's **CLI reference** and
**Library reference** sections applies to both — the CLI is a thin wrapper around the library, so the merge semantics
(what "first input wins" means, how `paths` and `components` get combined, what `dispute` does) are identical either
way.

## Use the CLI: [`openapi-merge-cli`](https://www.npmjs.com/package/openapi-merge-cli)

Use this if you have one or more OpenAPI files on disk (or reachable by URL) and want a merged file produced by a
configuration file and a command — no code to write.

```bash
npx openapi-merge-cli init   # writes a starting openapi-merge.yaml
npx openapi-merge-cli        # merges according to that configuration
```

Start at [CLI reference → Getting started](/cli/).

## Use the library: [`openapi-merge`](https://www.npmjs.com/package/openapi-merge)

Use this if you're merging specs programmatically — as part of a larger build step, a gateway-generation tool, or
anywhere you'd rather call a function than shell out to a CLI and read a config file back off disk.

```ts
import { merge, isErrorResult } from 'openapi-merge';

const result = merge([{ oas: serviceA }, { oas: serviceB }]);
if (!isErrorResult(result)) {
  console.log(result.output);
}
```

Start at [Library reference → Getting started](/library/).

## The intended use case

Both packages are built around one motivating scenario: **you have several microservices, each with its own OpenAPI
spec, and you want to expose them through a single API gateway with one combined spec.** That shapes several default
decisions you'll run into in the reference sections — for example, `info`, `servers` and `externalDocs` default to
"the first input wins" rather than "merge them somehow," because in the gateway scenario the first input is usually
the gateway's own spec and the rest are backends whose own top-level metadata shouldn't leak into the published
document.

The merging logic is generic enough to use outside that scenario, but if a default ever seems surprising, this is
usually why it's the default.
