# Release Notes — v2.0.3

**Covers:** changes merged to `main` since `v2.0.2` (`openapi-merge@2.0.2` / `openapi-merge-cli@2.0.2`), through commit `621403f`.

Both packages are version-locked and release together: `openapi-merge` and
`openapi-merge-cli` both go to `2.0.3`.

## Fixes

- **Component equality now handles references to non-schema OpenAPI components**
  (issue [#172](https://github.com/robertmassaioli/openapi-merge/issues/172),
  fixed by [#173](https://github.com/robertmassaioli/openapi-merge/pull/173)).
  Previously, comparing duplicate components that referred to a Header,
  Response, or another non-schema component could throw because equality tried
  to resolve every `$ref` as a Schema Object. Equality now compares resolved
  targets while preserving schema title behavior and component-kind checks.

## Dependency updates

- The CLI's `js-yaml` dependency was updated to `^5.4.1`.
- Development dependencies were refreshed: `typescript-eslint`, `globals`,
  `eslint`, and `@types/node`.
