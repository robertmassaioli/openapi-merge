import path from 'path';
import { Configuration } from './data';

/**
 * Building a starter configuration from the files already in a directory.
 *
 * `openapi-merge-cli` cannot do anything without a configuration file, and
 * writing the first one means reading the docs to learn a shape you will then
 * mostly copy. `init` writes it for you, and fills in the inputs it can find.
 *
 * The scanning decisions live here as pure functions so they can be tested
 * without a temp directory per case; `index.ts` does the file reading and
 * writing around them.
 */

/** A file the scanner looked at, already read. */
export type CandidateFile = {
  /** Path relative to the directory being scanned, e.g. `./api.yaml`. */
  relativePath: string;
  /** Parsed contents, or `undefined` if it could not be parsed. */
  parsed: unknown;
};

export type Classification =
  | { kind: 'openapi'; version: string }
  /** A Swagger 2.0 document: recognisably an API spec this tool cannot merge. */
  | { kind: 'swagger2' }
  | { kind: 'not-a-spec' };

const SUPPORTED_MAJOR = '3';

/**
 * Decides whether a parsed file is an OpenAPI document this tool can merge.
 *
 * Content, not extension. A `.json` file in a project directory is far more
 * likely to be `package.json` or `tsconfig.json` than a specification, and a
 * `.yaml` is more likely to be CI configuration. Checking for a top-level
 * `openapi` string excludes all of those without maintaining a denylist that
 * would go stale the moment a new tool invents a config file.
 *
 * Swagger 2.0 is called out separately rather than lumped in with "not a spec".
 * People do try to merge 2.0 documents with this tool (issue #110), and being
 * told "found, but not supported" is far more useful than silence.
 */
export function classify(parsed: unknown): Classification {
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'not-a-spec' };
  }

  const doc = parsed as Record<string, unknown>;

  if (typeof doc.openapi === 'string' && doc.openapi.startsWith(`${SUPPORTED_MAJOR}.`)) {
    return { kind: 'openapi', version: doc.openapi };
  }

  if (typeof doc.swagger === 'string') {
    return { kind: 'swagger2' };
  }

  return { kind: 'not-a-spec' };
}

export type ScanResult = {
  /** Inputs to write into the configuration, in the order they will appear. */
  inputs: string[];
  /** Swagger 2.0 files found, reported so the user is not left wondering. */
  swagger2: string[];
  /**
   * The distinct major.minor versions among the chosen inputs, sorted.
   *
   * More than one means the generated configuration will be refused by the very
   * merge it was written for: inputs must share a major.minor. Worth saying at
   * generation time, when the user still has the file open, rather than leaving
   * them to hit `mixed-openapi-versions` on the next command.
   */
  minorVersions: string[];
};

/** `3.0.3` -> `3.0`. The granularity at which the merge requires agreement. */
function toMinorVersion(version: string): string {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

/**
 * Chooses which of the scanned files become inputs.
 *
 * Sorted by path so that two runs in the same directory produce the same file:
 * a generator whose output depends on directory iteration order makes for
 * confusing diffs and unreproducible bug reports.
 */
export function selectInputs(files: ReadonlyArray<CandidateFile>): ScanResult {
  const inputs: string[] = [];
  const swagger2: string[] = [];
  const minors = new Set<string>();

  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const classification = classify(file.parsed);
    if (classification.kind === 'openapi') {
      inputs.push(file.relativePath);
      minors.add(toMinorVersion(classification.version));
    } else if (classification.kind === 'swagger2') {
      swagger2.push(file.relativePath);
    }
  }

  return { inputs, swagger2, minorVersions: [...minors].sort() };
}

/**
 * The output filename to suggest.
 *
 * Follows the inputs' extension, because a merge of YAML inputs producing JSON
 * is a surprise. With no inputs, or a mix, JSON is the safer default: it is
 * what the tool writes for any extension it does not recognise as YAML.
 */
export function suggestedOutput(inputs: ReadonlyArray<string>): string {
  const extensions = new Set(inputs.map(input => path.extname(input).toLowerCase()));
  const yamlOnly = extensions.size === 1 && (extensions.has('.yaml') || extensions.has('.yml'));
  return yamlOnly ? `./openapi.${[...extensions][0].slice(1)}` : './openapi.json';
}

/** The input written when nothing was found, so the file is still a valid starting point. */
export const PLACEHOLDER_INPUT = './replace-me.openapi.yaml';

/**
 * Builds the configuration to write.
 *
 * With no candidates this still emits one placeholder input rather than an
 * empty list. `inputs` is `@minItems 1` in the schema, so an empty array would
 * produce a file that fails validation on the very next run -- a generator
 * whose output its own tool rejects.
 */
export function buildConfiguration(inputs: ReadonlyArray<string>): Configuration {
  const chosen = inputs.length > 0 ? [...inputs] : [PLACEHOLDER_INPUT];

  return {
    inputs: chosen.map(inputFile => ({ inputFile })),
    output: suggestedOutput(chosen),
  };
}

/** Extensions worth opening. Everything else cannot be a specification. */
const SCANNABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.json', '.yaml', '.yml']);

export const STANDARD_CONFIG_FILE = 'openapi-merge.json';

/**
 * Whether a directory entry is worth reading.
 *
 * The scan is the current directory only -- not recursive. Descending would
 * mean deciding what to skip (`node_modules`, `dist`, `.git`, build output),
 * and every such list is wrong for somebody. A predictable shallow scan the
 * user can correct by hand beats a clever deep one that quietly pulls in a
 * vendored copy of somebody else's API.
 */
export function isScannable(fileName: string): boolean {
  return fileName !== STANDARD_CONFIG_FILE && SCANNABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}
