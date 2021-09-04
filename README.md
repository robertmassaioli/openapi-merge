# openapi-merge

This library assumes that you have a number of microservices that you wish to expose through one main service or gateway.

With this assumption in mind, it allows you to provide multiple OpenAPI 3.0 files and have them be merged together, in a 
deterministic manner, into a single OpenAPI specification.

Many of the design decisions of this library have that use case in mind and thus the features will be geared to making that
be a good experience.

If you are looking for a CLI tool based on this library, then please check out: [![npm](https://img.shields.io/npm/v/openapi-merge-cli?label=openapi-merge-cli&logo=npm)](https://bit.ly/3bEVq3f)

## Merging Behaviour

We process the inputs sequentially such that the first input in the list takes preference and subsequent inputs will be 
modified to merge seamlessly into the first.

For some parts of the OpenAPI file, like `paths`, `components` and `tags` we attempt to merge the definitions together 
such that there are no overlaps and no information is dropped.

However, for other elements of the OpenAPI files, the algorithm simply takes the value that is first defined in the list of
OpenAPI files. Examples of elements of the OpenAPI files that follow this pattern are:

 - Info
 - Servers
 - Security Schemes
 - ExternalDocumentation

The intention here is that the first file will define these elements and effectively override them from the other files. This 
matches the "API gateway" use case that we have mentioned previously whereby we probably want these definitions to be specific to
the API gateway and thus override the top level definitions from other inputs.
