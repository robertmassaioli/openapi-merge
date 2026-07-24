## The openapi-merge repository

Welcome to the openapi-merge repository. This library is intended to be used for merging multiple OpenAPI 3.0 files together. The most common reason that developers want to do this is because they have multiple services that they wish to expose underneath a single API Gateway. Therefore, even though this merging logic is sufficiently generic to be used for most use cases, some of the feature decisions are tailored for that specific use case.

### Screenshots

![Imgur](https://i.imgur.com/GjnSXCS.png)
(An example of creating an openapi-merge.json configuration file for the CLI tool)

### About this repository

This is a multi-package repository that contains:

* The openapi-merge library: [![npm](https://img.shields.io/npm/v/openapi-merge?label=openapi-merge&logo=npm)](https://bit.ly/2WnIytF)
* The openapi-merge CLI tool: [![npm](https://img.shields.io/npm/v/openapi-merge-cli?label=openapi-merge-cli&logo=npm)](https://bit.ly/3bEVq3f)

Depending on your use-case, you may wish to use the CLI tool or the library in your project. Please see the readme file of the specific package for more details.

### Developing on openapi-merge

This project is a multi-package repository and uses [Bun][1] workspaces to manage these packages in one development
experience. Packages are compiled with [`tsgo`][2], the Go-based native preview of the TypeScript compiler.

After checking out this repository, you can run the following command to install the required dependencies:

``` shell
bun install
```

You can then test running the CLI tool by running:

``` shell
bun run cli
```

If you wish to ensure that you can develop on the `openapi-merge` library in parallel to the `openapi-merge-cli` tool
then you must run the Typescript build for `openapi-merge` in watch mode. You can do this by:

``` shell
cd packages/openapi-merge && bun run build -- --watch
```

This will ensure that the Typescript is compiled into JavaScript so that it can be used by the `openapi-merge-cli` tool.

For the other operations that you wish to perform, please see the package.json of the other packages in this repository.

 [1]: https://bun.sh/
 [2]: https://github.com/microsoft/typescript-go