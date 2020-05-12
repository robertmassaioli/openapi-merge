# openapi-merge

This library assumes that you have a number of microservices that you wish to expose through one main service or gateway.

With this assumption in mind, it allows you to provide multiple OpenAPI 3.0 files and have them be merged together, in a 
deterministic manner, into a single OpenAPI specification.

Many of the design decisions of this library have that use case in mind and thus the features will be geared to making that
be a good experience.

## Merging Behaviour

We process the inputs sequentially such that the first input in the list takes preference and subsequent inputs will be 
modified to merge seamlessly.

Some elements are just taken from the first file that matches:

 - Info
 - Servers
 - Security Schemes
 - ExternalDocumentation

The intention here, is that the first file will define these elements and effectively override them from the other files.
