---
title: Playground
---

<script setup>
import Playground from './.vitepress/theme/components/Playground.vue'
</script>

# Playground

Paste two or more OpenAPI documents (JSON or YAML, either is fine) and see what `merge()` produces, live, with no
installation. This runs the same [`openapi-merge`](/library/) library the CLI calls -- not a re-implementation --
compiled for the browser.

For anything beyond the default merge behaviour shown here -- `dispute`, `pathModification`, `operationSelection`,
`duplicatePathHandling`, and the rest -- see the [library reference](/library/) or the
[CLI configuration reference](/cli/configuration); this page intentionally keeps to what a merge does with no
per-input configuration, so it stays quick to read.

<ClientOnly>
  <Playground />
</ClientOnly>
