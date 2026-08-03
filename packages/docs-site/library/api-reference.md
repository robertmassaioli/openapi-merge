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

<a :href="withBase('/api/index.html')" class="api-reference-link">Open the generated API reference →</a>

::: tip
That link only resolves once the API reference has actually been generated into `public/api/` — it isn't there on a
fresh checkout, and neither `vitepress dev` nor `vitepress preview` generates it for you. Run
`bun run --cwd packages/docs-site build:api` (or the full `build`, which includes it) at least once; under `dev` you
don't even need to restart the server afterwards, it picks up the new files immediately.

The link points at `/api/index.html`, not `/api/` — `vitepress dev`'s own client-side routing intercepts a bare
directory path before it reaches the static file, serving a blank page instead of a 404 or the real content. The
explicit filename works the same way in `dev`, `preview`, and the real GitHub Pages deploy, so it's used everywhere.
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
