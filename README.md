# openapi-merge-cli

This tool is based on the [![npm](https://img.shields.io/npm/v/openapi-merge?label=openapi-merge&logo=npm)](https://bit.ly/2WnIytF) library. Please read that README for more details.

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
      }
    },
    {
      "inputFile": "./confluence.swagger.json",
      "disputePrefix": "Confluence",
      "pathModification": {
        "prepend": "/confluence"
      }
    }
  ], 
  "output": "./output.swagger.json"
}
```

In this configuration you specify your inputs and your output file. For each input you have the following parameters:

 * `inputFile`: the relative path, from the `openapi-merge.json`, to the OpenAPI schema file for that input.
 * `disputePrefix`: if two inputs both define a component with the same name then, in order to prevent incorrect overlaps, we will attempt to use the dispute prefix to come up with a unique name for that component.
 * `pathModification.stripStart`: When copying over the `paths` from your OpenAPI specification for this input, it will strip this string from the start of the path if it is found.
 * `pathModification.prepend`: When copying over the `paths` from your OpenAPI specification for this input, it will prepend this string to the start of the path if it is found. `prepend` will always run after `stripStart` so that it is deterministic.

And then, once you have your Inputs in place and your configuration file you merely run the following in the directory that has your configuration file:

``` bash
npx openapi-merge-cli
```

And the merge should be run and complete! Congratulations and enjoy!

If you experience any issues then please raise them in the bug tracker.