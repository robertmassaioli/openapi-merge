import { Swagger } from '@atlassian/atlassian-openapi';
import { OpenApiDocument } from './oas31';

import { ServersStrategy } from './servers';
import { SecuritySchemesStrategy } from './security-schemes';
import { PathSelector } from './path-matching';
import { ExtensionMergeNode, ExtensionMergeStrategies } from './extension-merge-strategies';

export type { PathSelector, ExtensionMergeNode, ExtensionMergeStrategies };

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
   * OpenAPI file. `path` supports a `*` wildcard, matched the same way `includeTags`/`excludeTags` are (issue #111).
   * Selectors are matched against this input's own original path, before `pathModification` is applied. If an
   * Operation is matched by both `includePaths` and `includeTags` (or neither), both must pass for it to survive --
   * an include list only ever narrows what an Operation must clear, on top of any other include list configured.
   * If an Operation is matched by both an includePaths and an excludePaths selector, exclusion takes precedence.
   */
  includePaths?: PathSelector[];

  /**
   * Any Operation whose path (and, if given, method) matches one of these selectors will be excluded from the
   * final result, the same way `excludeTags` works. If an Operation is matched by both `includePaths` and
   * `excludePaths`, or by an exclude rule of either kind (path or tag), exclusion takes precedence.
   */
  excludePaths?: PathSelector[];
};

export interface DisputeBase {
  /**
   * If this is set to true, then this prefix will always be applied to every Schema, even if there is no dispute
   * for that particular schema. This may prevent the deduplication of common schemas from different OpenApi files.
   */
  alwaysApply?: boolean;
}

export interface DisputePrefix extends DisputeBase {
  /**
   * The prefix to use when a schema is in dispute.
   */
  prefix: string;
}

export interface DisputeSuffix extends DisputeBase {
  /**
   * The suffix to use when a schema is in dispute.
   */
  suffix: string;
}

export type Dispute = DisputePrefix | DisputeSuffix;

/**
 * What to do when this input declares a path another input already added
 * (issue #71).
 *
 * - `'error'` (default) — fail with `duplicate-paths`, the historical
 *   behaviour. Unchanged for anyone who does not set this.
 * - `'skip-later'` — keep the definition already present and drop this input's.
 * - `'prefer-later'` — replace the definition already present with this one.
 * - `'merge-operations'` — combine them when their method sets are disjoint and
 *   their path-level fields agree, so `GET /thing` from one input and
 *   `POST /thing` from another end up in one path item. Refuses with
 *   `duplicate-paths` in every case where a union would be a guess: overlapping
 *   methods, differing path-level fields, or a `$ref` path item.
 *
 * Per input rather than global, because the thing people actually want to
 * express is "this one input wins and the rest are additive", which a single
 * global setting cannot say.
 */
export type DuplicatePathHandling = 'error' | 'skip-later' | 'prefer-later' | 'merge-operations';

/**
 * A tag applied to every operation coming from one input (issue #112).
 *
 * Lets a merged document distinguish which service each operation came from
 * without anybody editing the upstream specifications -- which is the point,
 * since those are usually owned by another team.
 */
export type TagInjection = {
  /**
   * The tag to add to every operation from this input.
   *
   * @minLength 1
   */
  name: string;

  /**
   * Description for this tag in the output's top-level `tags` array.
   *
   * Ignored if another input already contributed a tag of the same name --
   * first-wins, as everywhere else in this merge.
   */
  description?: string;
};

export interface SingleMergeInputBase {
  oas: OpenApiDocument;

  /**
   * An opaque identity for this input -- typically the resolved absolute path
   * or URL it was loaded from (issue #104).
   *
   * The library never parses or resolves this string; it only compares it for
   * exact equality against the non-fragment portion of a `$ref` elsewhere in
   * the merge (in another input's document, or in {@link MergeOptions.externalDocuments}).
   * A `$ref` shaped `<this input's sourceIdentity>#/components/schemas/X`
   * found anywhere in the merge is treated as if it were the bare, in-document
   * ref `#/components/schemas/X` *as seen from this input* -- rewritten to
   * wherever this input's `X` ended up after deduplication/renaming, exactly
   * like any other reference into this input.
   *
   * Resolving the file-path or URL portion of a cross-document `$ref` against
   * this identity (e.g. deciding that `../common/Errors.yml` in one input
   * refers to the same file as another input's own path) is the caller's job
   * -- normally `openapi-merge-cli`, which is the layer that knows about file
   * paths and can do the async I/O this library deliberately does not do.
   */
  sourceIdentity?: string;

  pathModification?: PathModification;

  /**
   * How to resolve a path this input shares with one already merged.
   *
   * Applies to `webhooks` as well, which collide by event name in exactly the
   * same way.
   *
   * @default 'error'
   */
  duplicatePathHandling?: DuplicatePathHandling;

  /**
   * Any Operation tagged with one of the paths in this definition will be excluded from the merge result. Any tag
   * mentioned in this list will also be excluded from the top level list of tags.
   */
  operationSelection?: OperationSelection;

  /**
   * This configuration setting lets you configure how the info.description from this OpenAPI file will be merged
   * into the final resulting OpenAPI file
   */
  description?: DescriptionMergeBehaviour;

  /**
   * Add a tag to every operation from this input (issue #112).
   *
   * Applied *after* `operationSelection`, so an injected tag cannot influence
   * the include/exclude rules that decided which operations survive. Injecting
   * first would make `includeTags: ['billing']` match operations solely because
   * this input injects `billing`, which reads as a filter doing nothing.
   */
  tag?: TagInjection;
}

/**
 * The original SingelMergeInput, now deprecated. This is included for backwards compatibility, to prevent a breaking
 * change and should be removed in the next major version.
 *
 * @deprecated
 */
export interface SingleMergeInputV1 extends SingleMergeInputBase {
  /**
   * The prefix to use in the event of a dispute.
   *
   * @deprecated
   */
  disputePrefix?: string;
}

/**
 * The current expected format of the SingleMergeInput.
 */
export interface SingleMergeInputV2 extends SingleMergeInputBase {
  /**
   * This dictates how any disputes will be resolved between similar elements across multiple OpenAPI files.
   */
  dispute?: Dispute;
}

export type SingleMergeInput = SingleMergeInputV1 | SingleMergeInputV2;

export type PathModification = {
  stripStart?: string;
  prepend?: string;
};

export type DescriptionMergeBehaviour = {
  /**
   * Wether or not the description for this OpenAPI file will be merged into the description of the final file.
   */
  append: boolean;

  /**
   * You may optionally include a Markdown Title to demarcate this particular section of the merged description files.
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
   */
  headingLevel?: number;
};

export type MergeInput = Array<SingleMergeInput>;

/**
 * Document-level options for a merge.
 *
 * Deliberately a single bag passed as `merge()`'s second argument rather than
 * per-input fields. Everything in here concerns the *output* document, so a
 * per-input value would raise a question with no good answer: which input wins
 * when two of them disagree about a property the output has only one of?
 *
 * Optional in every position, and every default reproduces the behaviour that
 * existed before the option did, so `merge(inputs)` is unchanged.
 */
export interface MergeOptions {
  /**
   * Drop components that nothing in the merged document references (issue #94).
   *
   * Defaults to `false`. Off by default because pruning is destructive and this
   * library has always preserved every component it was given: a document may
   * carry definitions referenced only from outside it, and silently deleting
   * those would be a worse failure than carrying a few unused ones.
   *
   * Turn it on when `operationSelection` is removing operations and you expect
   * the schemas only those operations used to go with them. Reachability is
   * computed from the surviving document, so a component still used by another
   * endpoint is kept.
   */
  pruneUnusedComponents?: boolean;

  /**
   * Override fields of the merged `info` object (issue #102).
   *
   * `info` is otherwise taken from the first input, so a merged document is
   * titled after whichever service happens to be listed first -- misleading for
   * an aggregate API that is none of its inputs.
   *
   * Merged field by field, so overriding only `title` does not require
   * restating the required `version`. Applied after description appending, so
   * an explicit `description` wins over the appended one.
   */
  info?: Partial<Swagger.Info>;

  /**
   * How to combine the top-level `servers` array. Defaults to `'first'`.
   * See {@link ServersStrategy} for why that is the default (issue #4).
   */
  serversStrategy?: ServersStrategy;

  /**
   * How `components.securitySchemes` is combined across inputs (issue #33).
   *
   * Defaults to `'merge'`. Unlike {@link ServersStrategy}, whose default keeps
   * the historical first-wins behaviour, this one changes it: first-wins here
   * produced documents whose operations required a scheme the document did not
   * define, which is a defect rather than a preference.
   *
   * See {@link SecuritySchemesStrategy} for the three values and the case each
   * one serves.
   */
  securitySchemesStrategy?: SecuritySchemesStrategy;

  /**
   * Documents this merge may need to pull individual components out of, keyed
   * by the same opaque identity described on {@link SingleMergeInputBase.sourceIdentity}
   * (issue #10).
   *
   * Unlike an input, a document here never contributes `paths`, `webhooks`,
   * `info`, `security`, `tags` or anything else to the output on its own --
   * only the specific components a `$ref` elsewhere in the merge actually asks
   * for are pulled in (and, transitively, whatever those components' own
   * references need), deduplicated against the rest of the output exactly like
   * any other component. A document listed here that nothing ends up
   * referencing contributes nothing at all.
   *
   * Loading these (from disk, or over the network) is entirely the caller's
   * job -- by the time this reaches `merge()`, every document is already an
   * in-memory `OpenApiDocument` and merging proceeds synchronously, same as
   * always.
   */
  externalDocuments?: Record<string, OpenApiDocument>;

  /**
   * How to combine a document-root `x-*` extension's value across inputs,
   * keyed by extension name and shaped to mirror that value's own JSON
   * structure (proposal 47, generalising issue #60).
   *
   * An extension not mentioned here -- the default -- keeps this library's
   * historical behaviour: the first input that declares it wins, unchanged.
   * Only the document root is covered; `x-*` fields elsewhere (`info`, `tags`,
   * path items, `components`) are not reached by this option, because none of
   * those locations combines two inputs' values by a policy the way the root
   * does -- see {@link ExtensionMergeNode} for the full design.
   */
  extensionMergeStrategies?: ExtensionMergeStrategies;
}

export type SuccessfulMergeResult = {
  output: OpenApiDocument;
};

export type ErrorType =
  | 'no-inputs'
  | 'duplicate-paths'
  | 'component-definition-conflict'
  | 'operation-id-conflict'
  /** An input declared a version this library cannot merge, or none at all. */
  | 'unsupported-openapi-version'
  /** The inputs did not all declare the same OpenAPI major.minor version. */
  | 'mixed-openapi-versions'
  /** Two inputs declared the same webhook name (3.1). */
  | 'duplicate-webhooks'
  /**
   * A component reachable from `externalDocuments` (issue #10) transitively
   * references itself -- A's schema needs B's, which needs A's again. Reported
   * rather than silently broken or stack-overflowing, since there is no
   * sensible finite document to produce for a genuinely circular definition.
   */
  | 'cyclic-external-reference'
  /**
   * A `null` sits in a slot the specification requires to be an object (or,
   * for a discriminator mapping target, a string) -- e.g. `schemas: { Widget:
   * }`, an empty YAML value. Technically invalid OpenAPI, and common enough as
   * an authoring slip that it gets its own type rather than surfacing as an
   * unrelated crash (issue #92, proposal 40). The message names what was
   * expected and, where known, a JSON Pointer to where.
   */
  | 'malformed-document'
  /**
   * Two or more inputs disagree on the value of an `x-*` extension (or a
   * field/element within it) that {@link MergeOptions.extensionMergeStrategies}
   * configured with the `'error'` strategy at that point (proposal 47). The
   * message names the extension key and, for a nested disagreement, the path
   * inside its value where it was found.
   */
  | 'extension-merge-conflict';

export type ErrorMergeResult = {
  type: ErrorType;
  message: string;
};

export function isErrorResult<A>(t: A | ErrorMergeResult): t is ErrorMergeResult {
  return typeof t === 'object' && t !== null && 'type' in t && 'message' in t;
}

export type MergeResult = SuccessfulMergeResult | ErrorMergeResult;