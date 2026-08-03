import path from 'path';
import { dump as dumpYaml } from 'js-yaml';
import { Configuration } from './data';
import { STANDARD_CONFIG_FILE_CANDIDATES } from './config-file-names';

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
 * The inputs that will actually be written, given what the scan found.
 *
 * With no candidates this still returns one placeholder input rather than an
 * empty list. `inputs` is `@minItems 1` in the schema, so an empty array would
 * produce a file that fails validation on the very next run -- a generator
 * whose output its own tool rejects.
 *
 * Shared between {@link buildConfiguration} and {@link renderInitYaml} so
 * the "what counts as chosen" decision is made in exactly one place.
 */
export function chosenInputs(inputs: ReadonlyArray<string>): string[] {
  return inputs.length > 0 ? [...inputs] : [PLACEHOLDER_INPUT];
}

/** Builds the configuration to write. */
export function buildConfiguration(inputs: ReadonlyArray<string>): Configuration {
  const chosen = chosenInputs(inputs);

  return {
    inputs: chosen.map(inputFile => ({ inputFile })),
    output: suggestedOutput(chosen),
  };
}

/**
 * A single optional field (or optional group of fields) shown commented-out
 * in the file `init` writes.
 *
 * `yaml` is written as if it were top-level, valid YAML on its own -- it is
 * what you get by taking the leading `# ` off every line `render` produces
 * for this block. That is the property the per-field tests rely on: each
 * block, uncommented in isolation and merged into a minimal base document,
 * must pass the real configuration schema. In particular every *required*
 * sub-field of an optional object (`description.append`, `tag.name`,
 * `dispute.prefix`, `formatting.indent.style`+`width`) is present, not just
 * the optional leaves -- a block that only shows the optional parts of a
 * required shape would fail validation the moment it is uncommented, which
 * defeats the point of generating it.
 */
export type OptionalFieldBlock = {
  /** Identifies the field for tests; not shown to the user. */
  name: string;
  /** One-line (or one-line-per-sub-field) explanation, condensed from the TSDoc in data.ts. */
  explanation: string;
  /** The field's default/primary example, uncommented, at zero indentation. */
  yaml: string;
  /**
   * Other mutually-exclusive values for this same field (an enum, or a
   * discriminated union like `dispute`'s prefix/suffix), each shown as its
   * own additional commented example line right after `yaml` -- so every
   * choice is visible without checking the README, and picking one means
   * uncommenting the line you want rather than editing a value by hand.
   * Each entry, alone, must be exactly as valid a standalone replacement
   * for `yaml` as `yaml` itself -- covered by the same per-block validity
   * test `yaml` gets (`init-command.test.ts`).
   */
  alternatives?: ReadonlyArray<string>;
};

/**
 * `Configuration`'s optional fields (data.ts), in the order they appear
 * there. Deliberately excludes the deprecated `disputePrefix` -- only the
 * current `dispute` shape (`DisputeV2`) is worth showing to a new user.
 */
export const TOP_LEVEL_OPTIONAL_BLOCKS = [
  {
    name: 'outputRoot',
    explanation: 'Defence in depth: refuse to write the merged output anywhere outside this directory.',
    yaml: 'outputRoot: .',
  },
  {
    name: 'formatting',
    explanation: 'How the merged output file is indented. Defaults to 2 spaces.',
    yaml: [
      'formatting:',
      '  indent:',
      '    style: spaces # (default) width below sets how many spaces per level',
      '    width: 2',
    ].join('\n'),
    alternatives: [
      [
        'formatting:',
        '  indent:',
        '    style: tabs # JSON output only -- YAML forbids tab indentation',
      ].join('\n'),
    ],
  },
  {
    name: 'serversStrategy',
    explanation: "How to combine the top-level 'servers' array across inputs.",
    yaml: "serversStrategy: first  # (default) keep only the first input's servers, discard the rest",
    alternatives: [
      'serversStrategy: concat # keep every input\'s servers, deduplicated by URL',
    ],
  },
  {
    name: 'securitySchemesStrategy',
    explanation: 'How to combine components.securitySchemes across inputs.',
    yaml: 'securitySchemesStrategy: merge # (default) combine, renaming clashing definitions',
    alternatives: [
      "securitySchemesStrategy: first # take the first input's schemes, drop the rest",
      'securitySchemesStrategy: error # fail if two inputs define the same scheme name differently',
    ],
  },
  {
    name: 'pruneUnusedComponents',
    explanation: 'Drop components that nothing in the merged output references. Off by default -- pruning is destructive.',
    yaml: 'pruneUnusedComponents: false',
  },
  {
    name: 'info',
    explanation: "Override fields of the merged 'info' object instead of taking it from the first input.",
    yaml: [
      'info:',
      '  title: My Merged API',
      '  version: 1.0.0',
      '  description: A description for the merged document.',
    ].join('\n'),
  },
  {
    name: 'extensionMergeStrategies',
    explanation: [
      "How to combine an 'x-' extension's value across inputs, keyed by name.",
      "Unlisted extensions keep the default: first input to declare it wins.",
      "Below: x-tagGroups (issue #60) combines groups sharing a 'name', with",
      "each group's 'tags' concatenated and deduplicated.",
    ].join('\n'),
    yaml: [
      'extensionMergeStrategies:',
      '  x-tagGroups:',
      '    kind: array',
      '    strategy: union-by-key',
      '    key: name',
      '    item:',
      '      kind: object',
      '      strategy: merge',
      '      fields:',
      '        tags:',
      '          kind: array',
      '          strategy: concat-unique',
    ].join('\n'),
    alternatives: [
      [
        'extensionMergeStrategies:',
        '  x-owner: { kind: scalar, strategy: error } # fail the merge if inputs disagree',
      ].join('\n'),
    ],
  },
] as const satisfies ReadonlyArray<OptionalFieldBlock>;

/**
 * Top-level `Configuration` fields written ACTIVE (uncommented) rather than
 * as a suggestion (proposal 39), because for these two specifically, on is
 * what a first-time user scanning a directory of specs almost always wants,
 * and it costs nothing for the config `init` itself just generated: every
 * input `init` found came from scanning `.` only (no recursion -- see
 * `isScannable`), so `inputRoot: .` can never reject anything `init` itself
 * produced. They are paired deliberately, not two independent defaults:
 * turning `resolveExternalReferences` on alone would widen the local-file
 * read surface with nothing bounding it, exactly the gap proposal 38's
 * `inputRoot` exists to close.
 *
 * Rendered via {@link renderActiveBlock}, not {@link renderCommentedBlock} --
 * same shape as {@link OptionalFieldBlock}, but `yaml` is written out as-is,
 * not commented, with `explanation` still commented above it as a `# ` block.
 */
export const ACTIVE_TOP_LEVEL_DEFAULTS = [
  {
    name: 'resolveExternalReferences',
    explanation: [
      "Follows $refs into files these inputs don't declare, and files those pull",
      "in, however many deep -- so a $ref like '../common/Errors.yml#/...' just",
      "works without listing every file it touches in 'inputs'. Paired below",
      'with inputRoot, which bounds every local file this can reach to \'.\' --',
      "note that bound is local files only, so a $ref inside a remote (URL) input",
      "isn't restricted the same way. Set to false to turn this off.",
    ].join('\n'),
    yaml: 'resolveExternalReferences: true',
  },
  {
    name: 'inputRoot',
    explanation: [
      'Defence in depth for the setting above: refuses to read any local file --',
      'declared or discovered -- from outside this directory. Already covers',
      "everything init found here; only needs widening if you add an inputFile,",
      "or a discovered $ref, that reaches outside '.'.",
    ].join('\n'),
    yaml: 'inputRoot: .',
  },
] as const satisfies ReadonlyArray<OptionalFieldBlock>;

/**
 * Compile-time guard (proposal 39 §2.2): if `Configuration` gains a new
 * optional top-level field that nobody adds to either
 * {@link TOP_LEVEL_OPTIONAL_BLOCKS} or {@link ACTIVE_TOP_LEVEL_DEFAULTS}
 * above, this fails to typecheck instead of `init`'s output silently falling
 * behind `Configuration` again the way it did for `resolveExternalReferences`
 * and `inputRoot` themselves before this guard existed. `'inputs'` and
 * `'output'` are excluded: they are required, not optional, and are always
 * rendered directly rather than through either block list.
 */
type TopLevelOptionalConfigurationKey = Exclude<keyof Configuration, 'inputs' | 'output'>;
type DeclaredTopLevelBlockName =
  | (typeof TOP_LEVEL_OPTIONAL_BLOCKS)[number]['name']
  | (typeof ACTIVE_TOP_LEVEL_DEFAULTS)[number]['name'];
type _MissingTopLevelInitBlocks = Exclude<TopLevelOptionalConfigurationKey, DeclaredTopLevelBlockName>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- exists for its type error, not its value
const _assertNoMissingTopLevelInitBlocks: _MissingTopLevelInitBlocks extends never
  ? true
  : ['Add a TOP_LEVEL_OPTIONAL_BLOCKS or ACTIVE_TOP_LEVEL_DEFAULTS entry in init-command.ts for:', _MissingTopLevelInitBlocks] = true;

/**
 * `ConfigurationInputBase` and `DisputeV2`'s optional fields (data.ts), in
 * the order they appear there. Shown once, under the first input -- see
 * {@link renderInitYaml}.
 */
export const PER_INPUT_OPTIONAL_BLOCKS: ReadonlyArray<OptionalFieldBlock> = [
  {
    name: 'pathModification',
    explanation: "Rewrite this input's paths before merging: strip a prefix, then prepend one.",
    yaml: [
      'pathModification:',
      '  stripStart: /v1',
      '  prepend: /service-a',
    ].join('\n'),
  },
  {
    name: 'operationSelection',
    explanation: 'Only keep operations with these tags or paths, or drop operations with these tags or paths (exclusion wins on conflict; * wildcards a path).',
    yaml: [
      'operationSelection:',
      '  includeTags: [public]',
      '  excludeTags: [internal]',
      '  includePaths: [{ path: /public/* }]',
      '  excludePaths: [{ path: /admin/*, method: get }]',
    ].join('\n'),
  },
  {
    name: 'description',
    explanation: "Fold this input's info.description into the merged document's description.",
    yaml: [
      'description:',
      '  append: true',
      '  title:',
      "    value: A title for this input's section",
      '    headingLevel: 2',
    ].join('\n'),
  },
  {
    name: 'duplicatePathHandling',
    explanation: 'What to do when this input declares a path another input already contributed.',
    yaml: 'duplicatePathHandling: error            # (default) fail the merge',
    alternatives: [
      'duplicatePathHandling: skip-later       # keep the definition already present, drop this one',
      'duplicatePathHandling: prefer-later     # replace the definition already present with this one',
      "duplicatePathHandling: merge-operations # combine when methods don't overlap and path-level fields agree",
    ],
  },
  {
    name: 'tag',
    explanation: "Add a tag to every operation from this input, so the merged document shows which service it came from.",
    yaml: [
      'tag:',
      '  name: service-a',
      '  description: Endpoints from this input',
    ].join('\n'),
  },
  {
    name: 'dispute',
    explanation: "If a component name clashes with another input's, disambiguate with this prefix (or use a suffix instead).",
    yaml: [
      'dispute:',
      '  prefix: serviceA_',
      '  alwaysApply: false',
    ].join('\n'),
    alternatives: [
      [
        'dispute:',
        '  suffix: _serviceA',
        '  alwaysApply: false',
      ].join('\n'),
    ],
  },
];

/**
 * Renders one {@link OptionalFieldBlock} as commented-out lines at the given
 * indent: the explanation, `yaml` (the default), then every entry in
 * `alternatives` -- each an equally valid, equally commented choice, so
 * picking one is "uncomment this line instead of that one," never "edit
 * this value by hand."
 */
function renderCommentedBlock(block: OptionalFieldBlock, indent: string): string {
  const lines = [
    ...block.explanation.split('\n').map(line => `${indent}# ${line}`),
    ...block.yaml.split('\n').map(line => `${indent}# ${line}`),
    ...(block.alternatives ?? []).flatMap(alt => alt.split('\n').map(line => `${indent}# ${line}`)),
  ];
  return lines.join('\n');
}

/**
 * Renders one {@link ACTIVE_TOP_LEVEL_DEFAULTS} entry as an ACTIVE
 * (uncommented) top-level setting -- `explanation` is still commented above
 * it, `yaml` is not. Always top-level: unlike {@link renderCommentedBlock},
 * takes no indent, since nothing currently in {@link ACTIVE_TOP_LEVEL_DEFAULTS}
 * is per-input.
 */
function renderActiveBlock(block: OptionalFieldBlock): string {
  const explanationLines = block.explanation.split('\n').map(line => `# ${line}`);
  return [...explanationLines, block.yaml].join('\n');
}

/** Indent of a second-or-later key inside an `inputs` list item, matching js-yaml's own 2-space nesting. */
const PER_INPUT_BLOCK_INDENT = '    ';

/** A YAML scalar for `value`, quoted exactly as js-yaml would quote it -- so paths with special characters stay valid. */
function yamlScalar(value: string): string {
  return dumpYaml(value).trimEnd();
}

/**
 * Renders the full file `init` writes: real `inputs`/`output`, computed
 * exactly as {@link buildConfiguration} does, {@link ACTIVE_TOP_LEVEL_DEFAULTS}
 * turned on (proposal 39), and every other optional field from
 * `Configuration` and `ConfigurationInputBase` commented out.
 *
 * Not built by serialising a `Configuration` object -- js-yaml's `dump()`
 * has no notion of a comment attached to a key, so comments cannot survive
 * an object round-trip through it. This assembles the file as a template
 * instead: real lines for the values `init` actually found, hand-written
 * commented lines for everything it did not.
 *
 * The per-input block ({@link PER_INPUT_OPTIONAL_BLOCKS}) is shown in full
 * only under the *first* input, with every later input pointing back to it.
 * The fields are identical regardless of which input they are attached to,
 * so repeating the block under every input would only add noise -- most
 * directories this scans have more than one file.
 */
export function renderInitYaml(chosenInputs: ReadonlyArray<string>, output: string): string {
  const inputLines = chosenInputs.flatMap((inputFile, index) => {
    const line = `  - inputFile: ${yamlScalar(inputFile)}`;
    if (index === 0) {
      const blocks = PER_INPUT_OPTIONAL_BLOCKS.map(block => renderCommentedBlock(block, PER_INPUT_BLOCK_INDENT));
      return [line, `${PER_INPUT_BLOCK_INDENT}# Per-input options (all optional, all commented out below).`, ...blocks];
    }
    return [line, `${PER_INPUT_BLOCK_INDENT}# Per-input options: see the commented block under the first input above -- the same fields apply here.`];
  });

  const activeLines = ACTIVE_TOP_LEVEL_DEFAULTS.flatMap(block => ['', renderActiveBlock(block)]);
  const topLevelLines = TOP_LEVEL_OPTIONAL_BLOCKS.flatMap(block => ['', renderCommentedBlock(block, '')]);

  return [
    '# openapi-merge-cli configuration.',
    '#',
    "# Everything from here down to 'output:' is required. A couple of settings",
    '# right after it are turned on by default -- see their own comments below --',
    '# and everything after that is optional and commented out. Uncomment a block',
    '# to turn it on.',
    '# Full documentation: https://github.com/robertmassaioli/openapi-merge/wiki/README',
    '',
    'inputs:',
    ...inputLines,
    `output: ${yamlScalar(output)}`,
    ...activeLines,
    ...topLevelLines,
    '',
  ].join('\n');
}

/** Extensions worth opening. Everything else cannot be a specification. */
const SCANNABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.json', '.yaml', '.yml']);

/**
 * Whether a directory entry is worth reading.
 *
 * The scan is the current directory only -- not recursive. Descending would
 * mean deciding what to skip (`node_modules`, `dist`, `.git`, build output),
 * and every such list is wrong for somebody. A predictable shallow scan the
 * user can correct by hand beats a clever deep one that quietly pulls in a
 * vendored copy of somebody else's API.
 *
 * Both default config filenames are excluded, not just the one `init`
 * currently writes: a leftover `openapi-merge.json` from before this file
 * existed is not an OpenAPI document either, and scanning it would be a
 * waste even though `classify` would reject it anyway.
 */
export function isScannable(fileName: string): boolean {
  return (
    !(STANDARD_CONFIG_FILE_CANDIDATES as readonly string[]).includes(fileName)
    && SCANNABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase())
  );
}
