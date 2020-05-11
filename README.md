# openapi-merge

This library assumes that you have a number of microservices that you wish to expose through one main service or gateway.


With this assumption in mind, it allows you to provide multiple OpenAPI 3.0 files and have them be merged together, in a 
deterministic manner, into a single OpenAPI specification.

## Missing Features

 * Ensure that the top-level 'x-' parameters are copied over from the first file that they are found from.
 * Ensure that the security fields come with us. Ensure that they are migrated correctly.
