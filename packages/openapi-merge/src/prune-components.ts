import { Components31, OpenApiDocument, getPathItemOperations, getPaths, getWebhooks } from './oas31';
import { walkComponentReferences, walkPathItemMapReferences, walkPathReferences } from './reference-walker';

/**
 * Removes components nothing in the document refers to (issue #94).
 *
 * `operationSelection` deletes the operations a tag rule excludes, but the
 * components those operations were the only referrers of stayed behind, so the
 * output carried schemas for endpoints it no longer contained.
 *
 * Reachability rather than bookkeeping: rather than tracking what each removed
 * operation used, this walks what the *surviving* document references and drops
 * the rest. That gets the "unless it is also used by another endpoint" case in
 * the issue right by construction, including through chains of components that
 * reference each other.
 */

const COMPONENT_TYPES = [
  'schemas', 'responses', 'parameters', 'examples', 'requestBodies',
  'headers', 'links', 'pathItems', 'callbacks', 'securitySchemes',
] as const;

type ComponentType = (typeof COMPONENT_TYPES)[number];

const REFERENCE_PATTERN = /^#\/components\/([^/]+)\/(.+)$/;

function collectReferences(collect: (type: string, name: string) => void): (ref: string) => string {
  return ref => {
    const match = REFERENCE_PATTERN.exec(ref);
    if (match !== null) {
      // A JSON Pointer escapes `/` as `~1` and `~` as `~0`; component names may
      // legitimately contain neither, but decoding costs nothing and a name
      // that did contain one would otherwise never match its own key.
      collect(match[1], match[2].replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    return ref;
  };
}

/**
 * Security schemes are named as object KEYS in a Security Requirement, not as
 * `$ref`s, so the reference walker cannot see them (the same blind spot that
 * made renaming them wrong in issue #33). Pruning without this would delete
 * every security scheme in the document.
 */
function securitySchemesInUse(oas: OpenApiDocument): string[] {
  const names: string[] = [];

  for (const requirement of oas.security ?? []) {
    names.push(...Object.keys(requirement));
  }

  for (const pathItemMap of [getPaths(oas), getWebhooks(oas)]) {
    for (const pathItem of Object.values(pathItemMap)) {
      for (const { operation } of getPathItemOperations(pathItem)) {
        for (const requirement of operation.security ?? []) {
          names.push(...Object.keys(requirement));
        }
      }
    }
  }

  return names;
}

export function pruneUnusedComponents(oas: OpenApiDocument): OpenApiDocument {
  const components = oas.components;
  if (components === undefined) {
    return oas;
  }

  const reachable = new Set<string>();
  const queue: Array<{ type: string; name: string }> = [];

  const enqueue = (type: string, name: string): void => {
    const key = `${type}/${name}`;
    if (!reachable.has(key)) {
      reachable.add(key);
      queue.push({ type, name });
    }
  };

  // Roots: everything the surviving paths and webhooks point at.
  const collectRoot = collectReferences(enqueue);
  walkPathReferences(getPaths(oas), collectRoot);
  walkPathItemMapReferences(getWebhooks(oas), collectRoot);
  for (const schemeName of securitySchemesInUse(oas)) {
    enqueue('securitySchemes', schemeName);
  }

  // Transitive closure: a reachable component's own references are reachable.
  const componentMaps = components as unknown as Record<string, Record<string, unknown> | undefined>;
  while (queue.length > 0) {
    const { type, name } = queue.pop() as { type: string; name: string };
    const definition = componentMaps[type]?.[name];
    if (definition === undefined) {
      continue; // A dangling reference; leave it dangling rather than invent a target.
    }
    // Walked one component at a time so that only what this component points at
    // is followed -- walking the whole map would mark everything reachable.
    walkComponentReferences({ [type]: { [name]: definition } } as unknown as Components31, collectRoot);
  }

  const pruned: Record<string, Record<string, unknown>> = {};
  for (const type of COMPONENT_TYPES) {
    const map = componentMaps[type];
    if (map === undefined) {
      continue;
    }
    const kept = Object.fromEntries(Object.entries(map).filter(([name]) => reachable.has(`${type}/${name}`)));
    if (Object.keys(kept).length > 0) {
      pruned[type] = kept;
    }
  }

  // Any component type this function does not know about is passed through
  // untouched. Dropping an unrecognised bucket would be a silent data loss for
  // a spec version newer than this code.
  for (const type of Object.keys(componentMaps)) {
    if (!(COMPONENT_TYPES as ReadonlyArray<string>).includes(type as ComponentType) && componentMaps[type] !== undefined) {
      pruned[type] = componentMaps[type] as Record<string, unknown>;
    }
  }

  return {
    ...oas,
    components: Object.keys(pruned).length === 0 ? undefined : (pruned as unknown as Components31),
  };
}
