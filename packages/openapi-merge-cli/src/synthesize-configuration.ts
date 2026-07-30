import path from 'path';
import { Configuration, ConfigurationInput, PathModification } from './data';

/**
 * The command-line flags that stand in for a configuration file (issue #45).
 */
export type SynthesizeOptions = {
  output?: string;
  disputePrefix?: string;
  stripStart?: string;
  prepend?: string;
};

const URL_PREFIXES = ['http://', 'https://'];

function isUrl(input: string): boolean {
  return URL_PREFIXES.some(prefix => input.startsWith(prefix));
}

/**
 * The extension the default output should take, from the first input.
 *
 * A merge of YAML inputs should not silently produce JSON, so the first
 * input's extension decides. For a URL, the extension comes from the URL's
 * path and not from any query string -- `?format=yaml` is not an extension,
 * and `spec.yaml?v=2` must not become `merged.yaml?v=2`.
 */
function defaultOutputFor(firstInput: string): string {
  const withoutQuery = isUrl(firstInput) ? (firstInput.split('?')[0] ?? firstInput) : firstInput;
  const extension = path.extname(withoutQuery).toLowerCase();
  return ['.yaml', '.yml'].includes(extension) ? `./merged${extension}` : './merged.json';
}

/**
 * Builds a `Configuration` from positional arguments, so that a one-off merge
 * does not require writing a config file first (issue #45).
 *
 * Returns an error string rather than throwing, matching `loadConfiguration`,
 * so `main()` handles both the same way and both exit `ErrorLoadingConfig`.
 *
 * The result is deliberately an ordinary `Configuration`: it is validated by
 * the same schema and fed through the same pipeline as a file-based one, so
 * the two modes cannot drift apart in behaviour.
 */
export function synthesizeConfiguration(positionals: string[], options: SynthesizeOptions): Configuration | string {
  if (positionals.length === 0) {
    return 'No input files or URLs were provided. Pass inputs as arguments, or use --config to point at a configuration file.';
  }

  // Both modes at once is a mistake worth naming rather than resolving by
  // precedence -- silently ignoring the arguments someone typed is worse than
  // telling them the command is ambiguous.
  const pathModification: PathModification | undefined =
    options.stripStart === undefined && options.prepend === undefined
      ? undefined
      : { stripStart: options.stripStart, prepend: options.prepend };

  const inputs: ConfigurationInput[] = positionals.map(argument => {
    const base = {
      ...(pathModification === undefined ? {} : { pathModification }),
      ...(options.disputePrefix === undefined ? {} : { dispute: { prefix: options.disputePrefix } }),
    };

    return isUrl(argument) ? { ...base, inputURL: argument } : { ...base, inputFile: argument };
  });

  return {
    inputs,
    output: options.output ?? defaultOutputFor(positionals[0]),
  };
}
