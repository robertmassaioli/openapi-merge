export type OperationSelection = {
  /**
   * Only Operatinos that have these tags will be taken from this OpenAPI file. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  includeTags?: string[];

  /**
   * Any Operation that has any one of these tags will be excluded from the final result. If a single Operation contains
   * an includeTag and an excludeTag then it will be excluded; exclusion takes precedence.
   */
  excludeTags?: string[];

  /**
   * Only Operations whose path (and, if given, method) matches one of these selectors will be taken from this
   * OpenAPI file. `path` supports a `*` wildcard, matched the same way `includeTags`/`excludeTags` are. Selectors
   * are matched against this input's own original path, before `pathModification` is applied. If an Operation is
   * matched by both `includePaths` and `includeTags` (or neither), both must pass for it to survive.
   *
   * @examples require("./examples-for-schema.ts").PathSelectorListExamples
   */
  includePaths?: PathSelector[];

  /**
   * Any Operation whose path (and, if given, method) matches one of these selectors will be excluded from the
   * final result. If an Operation is matched by both an includePaths and an excludePaths selector, or by an
   * exclude rule of either kind (path or tag), exclusion takes precedence.
   *
   * @examples require("./examples-for-schema.ts").PathSelectorListExamples
   */
  excludePaths?: PathSelector[];
}

export type PathSelector = {
  /**
   * The path (or, for a webhook, the event name) to match, exactly as it appears in this input's own OpenAPI
   * document -- before `pathModification` is applied. Supports a `*` wildcard: `/admin/*` matches every path
   * starting with `/admin/`.
   *
   * @minLength 1
   */
  path: string;

  /**
   * Restrict this selector to one or more specific methods (a standard HTTP method, `query`, or a 3.2
   * `additionalOperations` custom verb, matched case-sensitively). Omit to match every method on this path.
   */
  method?: string | string[];
}

/**
 * How to combine one document-root `x-*` extension's value across inputs
 * (proposal 48, generalising issue #60). Mirrors the extension value's own
 * JSON shape: `kind` says what shape is expected at this point, `strategy`
 * says how to combine it.
 *
 * `kind` only changes behaviour for `concat`, `concat-unique`, `union-by-key`
 * and `merge`, which inspect the value's internal structure and fall back to
 * taking the first input's value wholesale if it does not match. `first`,
 * `last` and `error` work on a value of any shape -- `kind` on those three is
 * declarative only, and in particular `error` still reports a disagreement
 * even if the value is not the shape `kind` names, because silently doing
 * nothing is the one behaviour that strategy must never have.
 */
export type ExtensionMergeNode =
  /** A leaf value: string, number, boolean, or null. */
  | { kind: 'scalar'; strategy: 'first' | 'last' | 'error' }
  /** A JSON array, combined wholesale -- one input's whole array wins. */
  | { kind: 'array'; strategy: 'first' | 'last' | 'error' }
  /**
   * A JSON array, combined element-by-element: every input's array
   * concatenated in input order (`concat`), optionally deduplicated by deep
   * equality (`concat-unique`). `sortBy` (optional) sorts the result
   * afterwards by a named field, for arrays of objects; omitted, the result
   * keeps concatenation order.
   */
  | { kind: 'array'; strategy: 'concat' | 'concat-unique'; sortBy?: string }
  /**
   * A JSON array of objects, where elements sharing the same value at `key`
   * -- across, and within, inputs -- are the same logical entry and are
   * combined using `item`. Elements whose key value appears only once pass
   * through unchanged. Output order is first-seen order across all inputs.
   *
   * This is how `x-tagGroups` (issue #60) is expressed as configuration:
   * `{ kind: 'array', strategy: 'union-by-key', key: 'name', item: { kind:
   * 'object', strategy: 'merge', fields: { tags: { kind: 'array', strategy:
   * 'concat-unique' } } } }` combines groups sharing a name and deduplicates
   * their tags.
   */
  | { kind: 'array'; strategy: 'union-by-key'; key: string; item: ExtensionMergeNode }
  /** A JSON object, combined wholesale -- one input's whole object wins. */
  | { kind: 'object'; strategy: 'first' | 'last' | 'error' }
  /**
   * A JSON object, combined field by field. A field not listed in `fields`
   * defaults to `first`, applied wholesale regardless of its own shape -- an
   * unconfigured field is never guessed at.
   */
  | { kind: 'object'; strategy: 'merge'; fields?: { [fieldName: string]: ExtensionMergeNode } };

export type PathModification = {
  /**
     * If a path starts with these characters, then stip them from the beginning of the path. Will run before prepend.
     *
     * @minLength 1
     */
  stripStart?: string;

  /**
   * Append these characters to the start of the paths for this input. Will run after stripStart.
   *
   * @minLength 1
   */
  prepend?: string;
}

export type DescriptionMergeBehaviour = {
  /**
   * Wether or not the description for this OpenAPI file will be merged into the description of the final file.
   *
   * @default false
   */
  append: boolean;

  /**
   * You may optionally include a Markdown Title to demarcate this particular section of the merged description files.
   *
   * @examples require("./examples-for-schema.ts").DescriptionTitleExamples
   */
  title?: DescriptionTitle;
};

export type DescriptionTitle = {
  /**
   * The value of the included title.
   *
   * @minLength 1
   */
  value: string;

  /**
   * What heading level this heading will be at: from h1 through to h6. The default value is 1 and will create h1 elements
   * in Markdown format.
   *
   * @minimum 1
   * @maximum 6
   * @default 1
   */
  headingLevel?: number;
};

export type DisputeV1 = {
  /**
   * The prefix that will be used in the event of a conflict of two definition names.
   *
   * @deprecated
   * @minLength 1
   */
  disputePrefix?: string;
};

export interface DisputeBase {
  /**
   * If this is set to true, then this prefix will always be applied to every Schema, even if there is no dispute
   * for that particular schema. This may prevent the deduplication of common schemas from different OpenApi files.
   *
   * @default false
   */
  alwaysApply?: boolean;
}

/**
 * A dispute with a configurable prefix.
 */
export interface DisputePrefix extends DisputeBase {
  /**
   * The prefix to use when a schema is in dispute.
   *
   * @minLength 1
   */
  prefix: string;
}

/**
 * A dispute with a configurable suffix.
 */
export interface DisputeSuffix extends DisputeBase {
  /**
   * The suffix to use when a schema is in dispute.
   *
   * @minLength 1
   */
  suffix: string;
}

export type Dispute = DisputePrefix | DisputeSuffix;

export type DisputeV2 = {
  /**
   * The dispute algorithm that should be used for this input.
   *
   * @examples require("./examples-for-schema.ts").DisputeExamples
   */
  dispute?: Dispute;
};

/**
 * The common configuration properties of an Input.
 */
export interface ConfigurationInputBase {
  /**
   * For this input, you can perform these modifications to its paths elements.
   *
   * @examples @examples require("./examples-for-schema.ts").PathModificationExamples
   */
  pathModification?: PathModification;

  /**
   * Choose which OpenAPI Operations should be included from this input.
   *
   * @examples require("./examples-for-schema.ts").OperationSelectionExamples
   */
  operationSelection?: OperationSelection;

  /**
   * This configuration setting lets you configure how the info.description from this OpenAPI file will be merged
   * into the final resulting OpenAPI file
   *
   * @examples require('./examples-for-schema.ts').DescriptionMergeBehaviourExamples
   */
  description?: DescriptionMergeBehaviour;

  /**
   * What to do when this input declares a path (or webhook) that an earlier
   * input already contributed (issue #71).
   *
   * - `error` (default) — fail the merge, as it always has.
   * - `skip-later` — keep the definition already present, drop this one.
   * - `prefer-later` — replace the definition already present with this one.
   * - `merge-operations` — combine them when their methods do not overlap and
   *   their path-level fields agree, so `GET /thing` from one input and
   *   `POST /thing` from another end up in one path item. Refuses rather than
   *   guessing when the methods overlap, the path-level fields differ, or
   *   either side is a `$ref`.
   *
   * Per input rather than global, so a configuration can say "this gateway
   * input wins and the rest are additive".
   */
  duplicatePathHandling?: 'error' | 'skip-later' | 'prefer-later' | 'merge-operations';

  /**
   * Add a tag to every operation from this input (issue #112).
   *
   * Lets the merged document say which service an operation came from without
   * editing the upstream specification. Applied after `operationSelection`, so
   * the injected tag cannot influence which operations survive.
   *
   * @examples require('./examples-for-schema.ts').TagInjectionExamples
   */
  tag?: TagInjectionConfig;
}

/**
 * A tag applied to every operation from one input.
 */
export type TagInjectionConfig = {
  /**
   * The tag name to add.
   *
   * @minLength 1
   */
  name: string;

  /**
   * Description for the tag in the merged document's top-level `tags` array.
   * First-wins if another input injects the same name.
   */
  description?: string;
};

/**
 * A single Configuration input from a File.
 */
export interface ConfigurationInputFromFile extends ConfigurationInputBase {
  /**
   * The path to the input OpenAPI Schema that will be merged.
   *
   * @minLength 1
   */
  inputFile: string;
}

/**
 * A single Configuration input from a URL
 */
export interface ConfigurationInputFromUrl extends ConfigurationInputBase {
  /**
   * The input url that we should load our configuration file from.
   *
   * @format uri
   * @pattern ^https?://
   */
  inputURL: string;
}

/**
 * This only exists to support the original form of `disputePrefix`.
 *
 * @deprecated
 */
export type ConfigurationInputV1 = (ConfigurationInputFromFile | ConfigurationInputFromUrl) & DisputeV1;

/**
 * When a new major version is released this will become the default way of doing things and the types can simplify
 * dramatically.
 */
export type ConfigurationInputV2 = (ConfigurationInputFromFile | ConfigurationInputFromUrl) & DisputeV2;

/**
 * The multiple types of configuration inputs that are supported.
 */
export type ConfigurationInput = ConfigurationInputV1 | ConfigurationInputV2;

export function isConfigurationInputFromFile(input: ConfigurationInput): input is ConfigurationInputFromFile {
  return 'inputFile' in input;
}

/**
 * The Configuration file for the OpenAPI Merge CLI Tool.
 */
export type Configuration = {
  /**
   * The input items for the merge algorithm. You must provide at least one.
   *
   * @minItems 1
   * @examples require('./examples-for-schema.ts').ConfigurationInputExamples
   */
  inputs: ConfigurationInput[];

  /**
   * The output file to put the results in. If you use the .yml or .yaml extension then the schema will be output
   * in YAML format, otherwise, it will be output in JSON format.
   *
   * Any missing directories in this path are created automatically.
   *
   * @minLength 1
   */
  output: string;

  /**
   * Optional defence-in-depth restriction (see issue #93 Security Considerations):
   * when set, the CLI will refuse to write the merged spec anywhere outside this
   * directory and will exit with `ExitCode.ErrorUnsafePath` (5). The check
   * compares the realpath of the resolved output's nearest existing ancestor
   * against the realpath of this root, so symlinks cannot be used to escape.
   *
   * Leave unset to keep the historical permissive default; this option is
   * intended for embedded / multi-tenant uses of the CLI where the
   * configuration file may not be fully trusted.
   *
   * @minLength 1
   */
  outputRoot?: string;

  /**
   * Optional defence-in-depth restriction, the read-side counterpart to
   * `outputRoot` (proposal 38): when set, the CLI will refuse to read a
   * local file -- whether a declared `inputFile` or a file discovered via
   * `resolveExternalReferences` -- from anywhere outside this directory.
   *
   * Any local file load that would reach outside `inputRoot` is a hard
   * error: the merge does not proceed and no output is written, whether the
   * offending path came from a declared `inputFile` or was reached
   * transitively by following a `$ref` out of some other document. Every
   * violation found is reported together, not just the first. The check
   * compares the realpath of the resolved input's nearest existing ancestor
   * against the realpath of this root, so symlinks cannot be used to escape.
   *
   * Applies to local files only. `inputURL` and URLs discovered via
   * `resolveExternalReferences` are a different trust boundary (network
   * egress, not filesystem containment) and are not affected by this option.
   *
   * Leave unset to keep the historical permissive default; this option is
   * intended for embedded / multi-tenant uses of the CLI, or for configs
   * whose `resolveExternalReferences` inputs are not fully trusted.
   *
   * @minLength 1
   */
  inputRoot?: string;

  /**
   * Optional output-formatting controls (issue #114). When omitted, the
   * output is formatted with 2 spaces of indentation (the historical
   * default).
   */
  formatting?: OutputFormatting;

  /**
   * How to combine the top-level `servers` array across inputs (issue #4).
   *
   * - `first` (default) -- take the first input that declares `servers` and
   *   discard the rest. Correct for the API-gateway case this tool targets,
   *   where the gateway's URLs are canonical and a backend's own URLs are an
   *   implementation detail.
   * - `concat` -- keep every input's servers, in input order, deduplicated by
   *   URL. For documenting several microservices in one file.
   */
  serversStrategy?: 'first' | 'concat';

  /**
   * How `components.securitySchemes` are combined across inputs (issue #33).
   *
   * - `merge` (default) -- combine them, exactly as every other component type
   *   is combined: identical definitions collapse, differing ones are renamed
   *   using the input's dispute prefix or a numeric suffix, and every security
   *   requirement naming a renamed scheme is rewritten to match.
   * - `first` -- take the schemes from the first input that declares any and
   *   drop the rest. The behaviour before this option existed. Right for an API
   *   gateway, which owns authentication and does not want a backend's own
   *   scheme definitions in the published document -- but note that a later
   *   input's operations may then require a scheme the output does not define.
   * - `error` -- combine them, but fail if two inputs define the same scheme
   *   name differently, rather than renaming around it. Identical definitions
   *   still collapse.
   */
  securitySchemesStrategy?: 'merge' | 'first' | 'error';

  /**
   * Drop components that nothing in the merged output references (issue #94).
   *
   * Defaults to false. Useful with `operationSelection`, where excluding tags
   * removes operations but would otherwise leave the schemas only those
   * operations used behind. A component still referenced by another surviving
   * endpoint is kept.
   *
   * Off by default because pruning is destructive: a document may carry
   * definitions referenced only from outside it.
   */
  pruneUnusedComponents?: boolean;

  /**
   * Override fields of the merged `info` object (issue #102).
   *
   * Without this, `info` comes from the first input, so a merged document is
   * titled after whichever service happens to be listed first. Merged field by
   * field, so setting only `title` does not require restating `version`.
   */
  info?: ConfigurationInfoOverride;

  /**
   * How to combine a document-root `x-*` extension's value across inputs,
   * keyed by extension name (issue #60, generalised as proposal 48).
   *
   * An extension not mentioned here keeps the historical default: the first
   * input that declares it wins, unchanged. Only the document root is
   * covered -- `x-*` fields elsewhere (`info`, `tags`, path items,
   * `components`) are not reached by this option. See {@link ExtensionMergeNode}.
   *
   * @examples require('./examples-for-schema.ts').ExtensionMergeStrategiesExamples
   */
  extensionMergeStrategies?: { [extensionKey: string]: ExtensionMergeNode };

  /**
   * Follow `$ref`s that point outside the declared inputs -- to a file or URL
   * this configuration never named -- and pull in just the specific
   * components they ask for (issue #10).
   *
   * Defaults to `false`. A `$ref` into one of the *declared* `inputs` is
   * always resolved correctly regardless of this setting (issue #104) --
   * that fix is unconditional, since it only ever affects a `$ref` that is
   * already broken today. This setting is what additionally lets a `$ref`
   * discover and load documents nobody listed in `inputs`.
   *
   * Off by default because it changes what this tool reads: with it on, the
   * files and URLs actually loaded are no longer limited to what `inputs`
   * names, transitively following wherever a `$ref` in *any* loaded document
   * points. Turn it on deliberately, for configurations whose inputs are
   * trusted to the same degree the config file itself is.
   *
   * A `$ref` this discovers but cannot load (missing file, failed fetch,
   * unparseable content) is left exactly as written and logged as a warning
   * -- not a hard failure, matching how a `$ref` into a declared input that
   * cannot be resolved is also left untouched rather than erroring.
   */
  resolveExternalReferences?: boolean;
};

/**
 * The subset of `info` worth overriding from a configuration file.
 *
 * Deliberately not the full Info object: `version` and `title` are the ones
 * people ask for, and description rounds it out. Kept narrow so the generated
 * schema stays readable and `--noExtraProps` still catches typos.
 */
export type ConfigurationInfoOverride = {
  /** @minLength 1 */
  title?: string;
  /** @minLength 1 */
  version?: string;
  description?: string;
};

/**
 * Width of one indent step when using spaces. Range chosen to cover every
 * realistic style (2, 4, 8); larger values are almost certainly a config
 * error and are rejected at validation time.
 *
 * @minimum 1
 * @maximum 8
 * @TJS-type integer
 */
export type SpaceIndentWidth = number;

/**
 * Use space characters for indentation, repeated `width` times per level.
 */
export interface SpaceIndent {
  style: 'spaces';
  width: SpaceIndentWidth;
}

/**
 * Use tab characters for indentation. JSON only — YAML 1.1 disallows tabs
 * as indentation, so combining this with a `.yaml` / `.yml` output is
 * rejected at configuration-load time with a clear error message.
 */
export interface TabIndent {
  style: 'tabs';
}

/**
 * Discriminated union of indentation strategies. The `style` tag is the
 * single source of truth and is exhaustively dispatched on in
 * `indentToJsonStringifyArg`.
 */
export type Indent = SpaceIndent | TabIndent;

/**
 * Output formatting controls for the merged document.
 */
export interface OutputFormatting {
  /**
   * Indentation style for the emitted output. Defaults to
   * `{ style: 'spaces', width: 2 }`, which preserves the historical
   * behaviour.
   */
  indent?: Indent;
}

/**
 * The historical default that anyone running today's CLI is already
 * getting; exported so call sites and tests can refer to it by name
 * instead of duplicating the literal.
 */
export const DEFAULT_INDENT: Indent = { style: 'spaces', width: 2 };