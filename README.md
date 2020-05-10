# openapi-merge

This library assumes that you have a number of microservices that you wish to expose through one main service or gateway.


With this assumption in mind, it allows you to provide multiple OpenAPI 3.0 files and have them be merged together, in a 
deterministic manner, into a single OpenAPI specification.