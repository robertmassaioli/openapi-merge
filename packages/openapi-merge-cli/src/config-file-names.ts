/**
 * The default configuration filenames, in lookup/preference order.
 *
 * `init` writes {@link STANDARD_CONFIG_FILE_YAML}; `openapi-merge.json` is
 * kept as a fallback so a config written before this file existed keeps
 * loading without `-c`. Defined once here rather than in both
 * `init-command.ts` (which writes the file) and `load-configuration.ts`
 * (which reads it), so the two cannot drift apart.
 */
export const STANDARD_CONFIG_FILE_YAML = 'openapi-merge.yaml';

/** @deprecated in favour of {@link STANDARD_CONFIG_FILE_YAML}; still read for backwards compatibility. */
export const STANDARD_CONFIG_FILE_JSON = 'openapi-merge.json';

/** Every default filename `init` and the no-`-c` lookup know about, preference order first. */
export const STANDARD_CONFIG_FILE_CANDIDATES = [STANDARD_CONFIG_FILE_YAML, STANDARD_CONFIG_FILE_JSON] as const;
