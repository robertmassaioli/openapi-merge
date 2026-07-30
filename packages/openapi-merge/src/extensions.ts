import { OpenApiDocument } from './oas31';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Extensions = { [extensionKey: string]: any };

function extractExtensions(input: OpenApiDocument): Extensions {
  const result: Extensions = {};

  const plainObject: Extensions = input;

  for (const key in plainObject) {
    /* eslint-disable-next-line no-prototype-builtins */
    if (key.startsWith('x-') && plainObject.hasOwnProperty(key)) {
      result[key] = plainObject[key];
    }
  }

  return result;
}

/**
 * A ReDoc tag group: `{ name, tags }`.
 *
 * Not part of the OpenAPI specification, but the structure is fixed and widely
 * relied upon, which is what makes it safe to merge rather than guess at.
 */
type TagGroup = { name: string; tags?: string[] };

const TAG_GROUPS = 'x-tagGroups';

function isTagGroupArray(value: unknown): value is TagGroup[] {
  return Array.isArray(value) && value.every(entry =>
    typeof entry === 'object' && entry !== null && typeof (entry as TagGroup).name === 'string');
}

/**
 * Concatenates `x-tagGroups` across inputs, combining groups that share a name
 * (issue #60).
 *
 * Every other `x-` extension stays first-wins, and deliberately so: their
 * semantics are opaque, so concatenating or deep-merging them could corrupt a
 * vendor's data in ways this library cannot detect. `x-tagGroups` is the
 * exception because its shape is known and concatenation is information
 * preserving.
 *
 * The inconsistency this fixes: tags from later inputs were already merged into
 * the top-level `tags` array, but their groups were dropped, so a ReDoc sidebar
 * lost the structure for tags that were present.
 */
function mergeTagGroups(values: unknown[]): unknown {
  const present = values.filter(isTagGroupArray);

  // If any input declares `x-tagGroups` in an unrecognised shape, do not touch
  // it. First-wins on something we do not understand beats mangling it.
  if (present.length !== values.length) {
    return values[0];
  }

  const byName = new Map<string, string[]>();

  for (const groups of present) {
    for (const group of groups) {
      const existing = byName.get(group.name) ?? [];
      for (const tag of group.tags ?? []) {
        if (!existing.includes(tag)) {
          existing.push(tag);
        }
      }
      byName.set(group.name, existing);
    }
  }

  // Groups are emitted in the order they were first seen, across all inputs.
  // A group that ends up with no tags is dropped -- it would render as an empty
  // heading in the sidebar.
  const merged = [...byName.entries()]
    .filter(([, tags]) => tags.length > 0)
    .map(([name, tags]) => ({ name, tags }));

  return merged.length === 0 ? undefined : merged;
}

function mergeExtensionsHelper(extensions: Extensions[]): Extensions {
  if (extensions.length === 0) {
    return {};
  }

  const result = { ...extensions[0] };

  for (let extensionIndex = 1; extensionIndex < extensions.length; extensionIndex++) {
    const ext = extensions[extensionIndex];

    for (const extensionKey in ext) {
      /* eslint-disable-next-line no-prototype-builtins */
      if (result[extensionKey] === undefined && ext.hasOwnProperty(extensionKey)) {
        result[extensionKey] = ext[extensionKey];
      }
    }
  }

  // Applied after first-wins so it overrides it for this one key. Runs even for
  // a single input, because deduplicating groups that share a name within one
  // document is the same operation.
  const tagGroupValues = extensions.map(ext => ext[TAG_GROUPS]).filter(value => value !== undefined);
  if (tagGroupValues.length > 0) {
    const mergedGroups = mergeTagGroups(tagGroupValues);
    if (mergedGroups === undefined) {
      delete result[TAG_GROUPS];
    } else {
      result[TAG_GROUPS] = mergedGroups;
    }
  }

  return result;
}

export function mergeExtensions(mergeTarget: OpenApiDocument, oass: OpenApiDocument[]): OpenApiDocument {
  return {
    ...mergeTarget,
    ...mergeExtensionsHelper([extractExtensions(mergeTarget), ...oass.map(extractExtensions)])
  };
}