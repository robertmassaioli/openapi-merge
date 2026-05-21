import { DEFAULT_INDENT, Indent } from './data';

/**
 * Helper for compile-time exhaustiveness checks on discriminated unions.
 * If a new variant is added to {@link Indent} without updating the
 * dispatch site, the TypeScript compiler will refuse to assign the
 * unhandled variant to `never` and produce a build-time error.
 */
function assertNever(x: never): never {
  throw new Error(`Unhandled indent style: ${JSON.stringify(x)}`);
}

/**
 * Convert an {@link Indent} into the argument expected by
 * `JSON.stringify(value, replacer, indent)`:
 *
 *   - A number for spaces (the number of spaces per level).
 *   - The literal string '\t' for tabs.
 *
 * This is the only place in the codebase that switches on
 * `Indent.style`, so the `assertNever` guard above is sufficient to
 * keep the dispatch exhaustive across future variants.
 */
export function indentToJsonStringifyArg(indent: Indent = DEFAULT_INDENT): number | string {
  switch (indent.style) {
    case 'spaces':
      return indent.width;
    case 'tabs':
      return '\t';
    default:
      return assertNever(indent);
  }
}

/**
 * Resolve an {@link Indent} into the numeric width expected by
 * `yaml.safeDump({ indent: ... })`. YAML 1.1 does not permit tab
 * indentation, so this helper assumes the validator has already rejected
 * a `'tabs'` indent paired with a YAML output. In production, a
 * `'tabs'` value reaching this function indicates a bug elsewhere; we
 * fall back to `DEFAULT_INDENT.width` defensively rather than throwing.
 */
export function indentToYamlArg(indent: Indent = DEFAULT_INDENT): number {
  if (indent.style === 'spaces') {
    return indent.width;
  }
  // Defensive fallback; should be unreachable if load-configuration.ts is
  // doing its job (see validateConfigurationSemantics). We need to narrow
  // DEFAULT_INDENT to the 'spaces' branch before we can read `.width`.
  if (DEFAULT_INDENT.style === 'spaces') {
    return DEFAULT_INDENT.width;
  }
  // The DEFAULT_INDENT constant is statically a SpaceIndent, so this is
  // unreachable. The conditional above is purely to convince the compiler.
  return 2;
}
