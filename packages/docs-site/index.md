---
layout: home

hero:
  name: openapi-merge
  text: Merge OpenAPI documents, deterministically
  tagline: Combine multiple OpenAPI 3.0, 3.1 or 3.2 files into one — from the command line or from TypeScript — for the common case of exposing several microservices behind a single API gateway.
  actions:
    - theme: brand
      text: Which package do I want?
      link: /guide/which-package
    - theme: alt
      text: CLI reference
      link: /cli/
    - theme: alt
      text: Library reference
      link: /library/
    - theme: alt
      text: View on GitHub
      link: https://github.com/robertmassaioli/openapi-merge

features:
  - icon: 🧩
    title: Deterministic merging
    details: The first input always takes precedence for element-level conflicts (info, servers, security schemes), while paths, components and tags are merged so nothing is silently dropped.
  - icon: 🛠️
    title: CLI or library
    details: Merge from a YAML/JSON config file with openapi-merge-cli, or call merge() directly from TypeScript/JavaScript with openapi-merge — the CLI is a thin wrapper around the library.
  - icon: 🧬
    title: OpenAPI 3.0, 3.1 and 3.2
    details: Merges webhooks, components.pathItems, additionalOperations custom verbs, and the other constructs newer OpenAPI versions introduce — not just the 3.0 subset.
  - icon: 🔒
    title: Safe by default for untrusted input
    details: inputRoot / outputRoot (and their CLI flags) bound where the CLI will read from and write to, for the case where the configuration or inputs aren't fully trusted.
---
