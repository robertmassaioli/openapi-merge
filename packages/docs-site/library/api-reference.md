---
next: false
---

<script setup>
import { withBase } from 'vitepress';
</script>

# Generated API reference

The pages in this section describe *what each option means and when to use it*. For the exact TypeScript shape of
every type — every field, its optionality, and its JSDoc — the generated API reference is produced directly from
the library's source (`packages/openapi-merge/src/index.ts` and everything it exports), via
[TypeDoc](https://typedoc.org/), so it cannot drift from what the code actually accepts the way hand-written prose
can.

<a :href="withBase('/api/')" class="api-reference-link">Open the generated API reference →</a>

::: tip
That link only resolves after a full production build (`bun run --cwd packages/docs-site build`), since the API
reference is generated straight into `public/api/` as part of that build — it 404s under `vitepress dev`, which
doesn't run the generation step. Use `bun run --cwd packages/docs-site build && bun run --cwd packages/docs-site preview`
to see it locally.
:::

Useful starting points once you're there:

- `MergeInput` / `SingleMergeInput` — the first argument to `merge()`.
- `MergeOptions` — the second argument, documented in prose at [Merge options](/library/merge-options).
- `MergeResult`, `SuccessfulMergeResult`, `ErrorMergeResult`, `ErrorType` — what `merge()` returns; see
  [Merging behaviour](/library/merging-behaviour) for the prose version of every error type.

<style>
.api-reference-link {
  display: inline-block;
  margin: 1em 0;
  padding: 0.5em 1em;
  border-radius: 6px;
  background-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  text-decoration: none;
  font-weight: 600;
}
.api-reference-link:hover {
  background-color: var(--vp-c-brand-2);
}
</style>
