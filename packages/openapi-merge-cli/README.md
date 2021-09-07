# openapi-merge-cli

This tool is based on the [![npm](https://img.shields.io/npm/v/openapi-merge?label=openapi-merge&logo=npm)](https://bit.ly/2WnIytF) library. Please read 
that README for more details on how the merging algorithm works.

This library is intended to be used for merging multiple OpenAPI 3.0 files together. The most common reason that developers want to do this is because
they have multiple services that they wish to expose underneath a single API Gateway. Therefore, even though this merging logic is sufficiently generic to be 
used for most use cases, some of the feature decisions are tailored for that specific use case.

## Getting started

In order to use this merging cli tool you need to have one or more OpenAPI 3.0 files that you wish to merge. Then you need to create a configuration file,
called `openapi-merge.json` by default, in your current directory. It should look something like this:

``` json
{
  "inputs": [
    {
      "inputFile": "./gateway.swagger.json"
    },
    {
      "inputFile": "./jira.swagger.json",
      "pathModification": {
        "stripStart": "/rest",
        "prepend": "/jira"
      },
      "operationSelection": {
        "includeTags": ["included"]
      },
      "description": {
        "append": true
      }
    },
    {
      "inputFile": "./confluence.swagger.yaml",
      "dispute": {
        "prefix": "Confluence"
      },
      "pathModification": {
        "prepend": "/confluence"
      },
      "operationSelection": {
        "excludeTags": ["excluded"]
      }
    }
  ], 
  "output": "./output.swagger.json"
}
```

In this configuration you specify your inputs and your output file. For each input you have the following parameters:

 * `inputFile` or `inputURL`: the relative path (or URL), from the `openapi-merge.json`, to the OpenAPI schema file for that input (in JSON or Yaml format).
 * `dispute`: if two inputs both define a component with the same name then, in order to prevent incorrect overlaps, we will attempt to use the dispute prefix or suffix to come up with a unique name for that component. Please [read the documentation for more details on the format](https://github.com/robertmassaioli/openapi-merge/wiki/configuration-definitions-dispute).
 * `pathModification.stripStart`: When copying over the `paths` from your OpenAPI specification for this input, it will strip this string from the start of the path if it is found.
 * `pathModification.prepend`: When copying over the `paths` from your OpenAPI specification for this input, it will prepend this string to the start of the path if it is found. `prepend` will always run after `stripStart` so that it is deterministic.
 * `operationSelection.includeTags`: Only operations that are tagged with the tags configured here will be extracted from the OpenAPI file and merged with the others. This instruction will not remove other tags from the top level tags definition for this input.
 * `operationSelection.excludeTags`: Only operations that are NOT tagged with the tags configured here will be extracted from the OpenAPI file and merged with the others. Also, these tags will also be removed from the top level `tags` element for this file before being merged. If a single REST API operation has an `includeTags` reference and an `excludeTags` reference then the exclusion rule will take precidence.
 * `description.append`: All of the inputs with `append: true` will have their `info.description`s merged together, in order, and placed in the output OpenAPI file in the `info.description` section.
 * `description.title`: An optional field, that lets you spefify a custom heading for this inputs description when it is merged together in the output OpenAPI file.

And then, once you have your Inputs in place and your configuration file you merely run the following in the directory that has your configuration file:

``` bash
npx openapi-merge-cli
```

For more fine grained details on what `Configuration` options are available to you. [Please read the docs](https://bitbucket.org/echo_rm/openapi-merge-cli/wiki/README).

If you wish, you may write your configuration file in YAML format and then run:

``` shell
npx openapi-merge-cli --config path/to/openapi-merge.yaml
```

And the merge should be run and complete! Congratulations and enjoy!

If you experience any issues then please [raise them in the bug tracker][1].

 [1]: https://bitbucket.org/echo_rm/openapi-merge-cli/issues?status=new&status=open