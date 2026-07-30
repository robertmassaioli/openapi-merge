import { ErrorMergeResult, MergeInput } from './data';

/**
 * All OpenAPI version handling lives here so that widening support is a
 * one-line change to {@link SUPPORTED_MINOR_VERSIONS} plus whatever merge logic
 * that version actually needs.
 */
export type OpenApiVersion = {
  major: number;
  minor: number;
  patch: number;
  /** Exactly what the document declared, for error messages. */
  raw: string;
};

/**
 * The `major.minor` versions this library knows how to merge.
 *
 * Patch releases within a minor are the same feature set by construction, so
 * only `major.minor` is tracked. 3.0.0 and 3.0.3 are interchangeable; 3.0 and
 * 3.1 are not.
 *
 * Widened by each phase of the OpenAPI support work: phase 2 adds '3.1', phase
 * 3 adds '3.2'. Adding an entry here is a claim that the merge logic handles
 * that version's constructs -- do not add one without the work behind it.
 */
export const SUPPORTED_MINOR_VERSIONS: ReadonlyArray<string> = ['3.0', '3.1', '3.2'];

/** `major.minor`, the granularity at which compatibility is decided. */
export function toMinorVersion(version: OpenApiVersion): string {
  return `${version.major}.${version.minor}`;
}

/**
 * Parse an `openapi` field. Returns undefined for anything that is not a
 * complete `major.minor.patch` version string.
 *
 * Deliberately strict: `"3.0"` and `"v3.0.0"` are rejected rather than
 * guessed at. The specification requires a full semantic version here, and a
 * document that does not provide one is a document we cannot reason about.
 */
export function parseOpenApiVersion(raw: unknown): OpenApiVersion | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (match === null) {
    return undefined;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    raw: raw.trim(),
  };
}

function describeSupported(supported: ReadonlyArray<string>): string {
  return supported.map(v => `${v}.x`).join(', ');
}

/**
 * Check every input's declared OpenAPI version before any merging happens.
 *
 * Returns an error to be surfaced verbatim, or undefined when every input is a
 * supported version and they all agree on `major.minor`.
 *
 * Requiring agreement is a deliberate policy rather than a limitation: merging
 * documents written against different versions of the specification means
 * silently reconciling constructs that changed meaning between them. Refusing
 * is honest, and the remedy -- bring your inputs to one version -- is something
 * the caller can actually do.
 */
export function validateInputVersions(
  inputs: MergeInput,
  /**
   * Which minor versions to accept. Defaults to what this library actually
   * supports; parameterised so the mixed-version rule can be tested
   * independently of how many versions happen to be supported today. In phase 1
   * only '3.0' is supported, which makes the mixed-version branch unreachable
   * through the default -- a second distinct minor is always rejected as
   * unsupported first.
   */
  supported: ReadonlyArray<string> = SUPPORTED_MINOR_VERSIONS,
): ErrorMergeResult | undefined {
  const seen = new Map<string, number[]>();

  for (let index = 0; index < inputs.length; index++) {
    const declared = inputs[index].oas.openapi;
    const version = parseOpenApiVersion(declared);

    if (version === undefined) {
      const found = declared === undefined
        ? 'no "openapi" field'
        : `"openapi": ${JSON.stringify(declared)}`;

      return {
        type: 'unsupported-openapi-version',
        message: `Input ${index} has ${found}. Every input must declare a full OpenAPI version `
          + `such as "3.0.3". Supported versions: ${describeSupported(supported)}.`,
      };
    }

    const minor = toMinorVersion(version);

    if (!supported.includes(minor)) {
      return {
        type: 'unsupported-openapi-version',
        message: `Input ${index} declares OpenAPI ${version.raw}, which this version of `
          + `openapi-merge cannot merge. Supported versions: ${describeSupported(supported)}.`,
      };
    }

    const indexes = seen.get(minor);
    if (indexes === undefined) {
      seen.set(minor, [index]);
    } else {
      indexes.push(index);
    }
  }

  if (seen.size > 1) {
    const summary = Array.from(seen.entries())
      .map(([minor, indexes]) => `${minor}.x (input${indexes.length > 1 ? 's' : ''} ${indexes.join(', ')})`)
      .join(' and ');

    return {
      type: 'mixed-openapi-versions',
      message: `All inputs must declare the same OpenAPI major.minor version, but found ${summary}. `
        + `Convert your inputs to a single version before merging.`,
    };
  }

  return undefined;
}

/**
 * The version the merged document should declare.
 *
 * Every input shares a `major.minor` by the time this runs, so the only
 * question is the patch. The highest one wins: patch releases within a minor
 * are the same feature set, and a document written against 3.0.3 may use
 * clarifications that a 3.0.0 consumer would not expect, so claiming the
 * highest is the safe direction.
 *
 * Returns undefined only when there are no inputs, which `merge` rejects first.
 */
/**
 * Resolves an explicit output-version override against the inputs (issue #76).
 *
 * Returns the version to emit, or an error if the override cannot honestly be
 * emitted for these inputs.
 *
 * The minor must match. 3.1 is not a compatible superset of 3.0 -- `nullable`
 * became a type union, `exclusiveMinimum` changed from boolean to numeric --
 * so relabelling 3.0 documents as 3.1 produces a document that declares
 * conformance to rules its own contents break. Patch is free to differ, because
 * within a minor the patch level carries no feature difference; that is exactly
 * the latitude someone pinning "3.0.3" for a downstream tool needs.
 */
export function resolveOutputVersion(inputs: MergeInput, override: string | undefined): string | undefined | ErrorMergeResult {
  const negotiated = negotiateOutputVersion(inputs);

  if (override === undefined) {
    return negotiated;
  }

  const parsed = parseOpenApiVersion(override);
  if (parsed === undefined || !SUPPORTED_MINOR_VERSIONS.includes(toMinorVersion(parsed))) {
    return {
      type: 'unsupported-openapi-version',
      message:
        `The requested output version '${String(override)}' is not one this library can emit. ` +
        `Supported minor versions: ${SUPPORTED_MINOR_VERSIONS.join(', ')}.`,
    };
  }

  // `negotiated` is undefined only when no input declared a parseable version,
  // and validateInputVersions has already rejected that before we get here.
  const inputsMinor = negotiated === undefined ? undefined : toMinorVersion(parseOpenApiVersion(negotiated) as OpenApiVersion);

  if (inputsMinor !== undefined && toMinorVersion(parsed) !== inputsMinor) {
    return {
      type: 'mixed-openapi-versions',
      message:
        `The requested output version '${override}' does not match the inputs, which are ${inputsMinor}. ` +
        `Emitting a different minor version would declare conformance to a specification the merged document does not follow.`,
    };
  }

  return parsed.raw;
}

export function negotiateOutputVersion(inputs: MergeInput): string | undefined {
  let best: OpenApiVersion | undefined;

  for (const input of inputs) {
    const version = parseOpenApiVersion(input.oas.openapi);
    if (version === undefined) {
      continue;
    }
    if (best === undefined || version.patch > best.patch) {
      best = version;
    }
  }

  return best?.raw;
}
