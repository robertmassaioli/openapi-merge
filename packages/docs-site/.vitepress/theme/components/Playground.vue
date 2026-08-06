<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
// Imported from the pre-bundled copy (`bun run build:merge-bundle`), not
// `from 'openapi-merge'` directly: the published `dist/` is CJS spread
// across many files that `require()` each other, and Rollup's commonjs
// handling doesn't convert that chain cleanly for either the client or SSR
// bundle -- it leaves raw `exports`/`require` references in the output,
// which then throw `ReferenceError: exports is not defined` in the browser.
// `bun build` (used here, same tool the CLI's own build already relies on)
// produces one self-contained ESM file with no such references, which Vite
// can then bundle like any other first-party module. Types still come from
// the real package -- only the value import is redirected.
import openapiMergeBundle from '../../generated/openapi-merge.mjs';
import type { OpenApiDocument } from 'openapi-merge';

const { merge, isErrorResult, MalformedDocumentError } = openapiMergeBundle as {
  merge: typeof import('openapi-merge').merge;
  isErrorResult: typeof import('openapi-merge').isErrorResult;
  MalformedDocumentError: typeof import('openapi-merge').MalformedDocumentError;
};

/**
 * Everything here runs in the browser. Nothing typed or pasted into this
 * page is sent anywhere -- the merge happens with the same `openapi-merge`
 * library the CLI calls, imported and run client-side.
 */

const USERS_EXAMPLE = `openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK
`;

const ORDERS_EXAMPLE = `openapi: 3.0.3
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        '200':
          description: OK
`;

type DocEditor = {
  id: number;
  label: string;
  content: string;
};

let nextId = 3;
const docs = reactive<DocEditor[]>([
  { id: 1, label: 'Document 1', content: USERS_EXAMPLE },
  { id: 2, label: 'Document 2', content: ORDERS_EXAMPLE },
]);

function addDocument(): void {
  docs.push({ id: nextId++, label: `Document ${docs.length + 1}`, content: '' });
}

function removeDocument(id: number): void {
  const index = docs.findIndex(doc => doc.id === id);
  if (index !== -1) {
    docs.splice(index, 1);
  }
}

// Debounced snapshot of `docs`, so a merge doesn't re-run on every keystroke --
// only ~300ms after typing/pasting settles. The textareas themselves stay
// bound directly to `docs` for instant visual feedback.
const debouncedDocs = ref<DocEditor[]>(docs.map(doc => ({ ...doc })));
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => docs.map(doc => ({ id: doc.id, label: doc.label, content: doc.content })),
  next => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedDocs.value = next;
    }, 300);
  },
  { deep: true, immediate: true },
);

/** Mirrors `openapi-merge-cli`'s `readYamlOrJSON`: JSON first, YAML as a fallback. */
function parseYamlOrJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let jsonError: Error;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    jsonError = e instanceof Error ? e : new Error(String(e));
  }

  try {
    return { ok: true, value: loadYaml(text) };
  } catch (e) {
    const yamlError = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      error: `Failed to parse as either JSON or YAML.\n\nJSON error: ${jsonError.message}\n\nYAML error: ${yamlError.message}`,
    };
  }
}

type MergeOutcome =
  | { kind: 'empty' }
  | { kind: 'parse-error'; label: string; message: string }
  | { kind: 'merge-error'; type: string; message: string }
  | { kind: 'success'; output: OpenApiDocument };

const outcome = computed<MergeOutcome>(() => {
  if (debouncedDocs.value.length === 0) {
    return { kind: 'empty' };
  }

  const parsedOas: OpenApiDocument[] = [];
  for (const doc of debouncedDocs.value) {
    if (doc.content.trim() === '') {
      return { kind: 'parse-error', label: doc.label, message: 'This document is empty.' };
    }
    const parsed = parseYamlOrJson(doc.content);
    if (!parsed.ok) {
      return { kind: 'parse-error', label: doc.label, message: parsed.error };
    }
    parsedOas.push(parsed.value as OpenApiDocument);
  }

  try {
    const result = merge(parsedOas.map(oas => ({ oas })));
    if (isErrorResult(result)) {
      return { kind: 'merge-error', type: result.type, message: result.message };
    }
    return { kind: 'success', output: result.output };
  } catch (e) {
    if (e instanceof MalformedDocumentError) {
      return { kind: 'merge-error', type: 'malformed-document', message: e.message };
    }
    throw e;
  }
});

const outputFormat = ref<'json' | 'yaml'>('json');

const formattedOutput = computed<string>(() => {
  if (outcome.value.kind !== 'success') {
    return '';
  }
  // JSON stringify+parse strips `undefined` values before handing off to
  // js-yaml -- same trick, and same reason, as the CLI's own `dumpAsYaml`.
  return outputFormat.value === 'yaml'
    ? dumpYaml(JSON.parse(JSON.stringify(outcome.value.output)), { indent: 2 })
    : JSON.stringify(outcome.value.output, null, 2);
});
</script>

<template>
  <div class="playground">
    <p class="privacy-note">
      Everything below runs in your browser. Nothing you paste here is sent anywhere.
    </p>

    <div class="documents">
      <div v-for="doc in docs" :key="doc.id" class="document">
        <div class="document-header">
          <input v-model="doc.label" class="label-input" />
          <button
            type="button"
            class="remove-button"
            :disabled="docs.length <= 1"
            title="Remove this document"
            @click="removeDocument(doc.id)"
          >
            &times;
          </button>
        </div>
        <textarea
          v-model="doc.content"
          class="editor"
          spellcheck="false"
          placeholder="Paste an OpenAPI document here, as JSON or YAML"
        ></textarea>
      </div>
    </div>

    <button type="button" class="add-button" @click="addDocument">+ Add document</button>

    <div class="output-section">
      <div class="output-header">
        <h3>Merged result</h3>
        <div class="format-toggle">
          <button
            type="button"
            :class="{ active: outputFormat === 'json' }"
            @click="outputFormat = 'json'"
          >
            JSON
          </button>
          <button
            type="button"
            :class="{ active: outputFormat === 'yaml' }"
            @click="outputFormat = 'yaml'"
          >
            YAML
          </button>
        </div>
      </div>

      <p v-if="outcome.kind === 'empty'" class="hint">Add at least one document to see a merged result.</p>

      <div v-else-if="outcome.kind === 'parse-error'" class="error">
        <strong>Could not parse "{{ outcome.label }}":</strong>
        <pre>{{ outcome.message }}</pre>
      </div>

      <div v-else-if="outcome.kind === 'merge-error'" class="error">
        <strong>Merge failed ({{ outcome.type }}):</strong>
        <pre>{{ outcome.message }}</pre>
      </div>

      <pre v-else class="output">{{ formattedOutput }}</pre>
    </div>
  </div>
</template>

<style scoped>
.playground {
  margin-top: 1.5rem;
}

.privacy-note {
  font-size: 0.9em;
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}

.documents {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.document {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.document-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-border);
}

.label-input {
  flex: 1;
  border: none;
  background: transparent;
  font-weight: 600;
  color: var(--vp-c-text-1);
  padding: 0.15rem 0.3rem;
}

.label-input:focus {
  outline: 1px solid var(--vp-c-brand-1);
  border-radius: 4px;
}

.remove-button {
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
  padding: 0.2rem 0.5rem;
}

.remove-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.editor {
  flex: 1;
  min-height: 220px;
  border: none;
  resize: vertical;
  padding: 0.6rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85em;
  background: var(--vp-code-block-bg);
  color: var(--vp-c-text-1);
}

.editor:focus {
  outline: none;
}

.add-button {
  margin-top: 0.75rem;
  border: 1px dashed var(--vp-c-border);
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-2);
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}

.add-button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.output-section {
  margin-top: 2rem;
}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.output-header h3 {
  margin: 0;
  border: none;
  padding: 0;
}

.format-toggle button {
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  padding: 0.25rem 0.7rem;
  cursor: pointer;
}

.format-toggle button:first-child {
  border-radius: 6px 0 0 6px;
}

.format-toggle button:last-child {
  border-radius: 0 6px 6px 0;
  border-left: none;
}

.format-toggle button.active {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: white;
}

.hint {
  color: var(--vp-c-text-2);
}

.error {
  border: 1px solid var(--vp-c-danger-1);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.error pre {
  white-space: pre-wrap;
  color: var(--vp-c-danger-1);
  margin: 0.5rem 0 0;
}

.output {
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--vp-code-block-bg);
  overflow-x: auto;
  font-size: 0.85em;
}
</style>
