# Implementation Proposal: Issue #45 — Allow CLI Use Without a Config File

**Status:** Proposal  
**Value:** 3 / **Effort:** 2 / **ROI:** 4.0 (Quick Win)

**Issue:** [robertmassaioli/openapi-merge#45](https://github.com/robertmassaioli/openapi-merge/issues/45)

---

## 1. Issue Summary

Today, the `openapi-merge-cli` always requires a JSON or YAML configuration file (defaulting to `./openapi-merge.json` if no `--config` is provided). For one-off merges or quick prototyping, writing a config file is heavyweight friction.

**User request:** Allow passing OpenAPI input files as positional arguments directly on the command line, with sensible defaults for output location. Example:

```bash
openapi-merge-cli a.yaml b.yaml -o merged.yaml
openapi-merge-cli spec1.json spec2.json   # output to ./merged.json
openapi-merge-cli https://api.example.com/spec.yaml ./local.yaml
```

---

## 2. Current Behaviour

The CLI today unconditionally requires a configuration file:

**`packages/openapi-merge-cli/src/index.ts` (lines 21–22, 130):**
```typescript
program
  .option('-c, --config <config_file>', 'The path to the configuration file for the merge tool.');

// ...

const config = await loadConfiguration(program.config);  // Must load a config file
```

**`packages/openapi-merge-cli/src/load-configuration.ts` (lines 25–36):**
```typescript
const STANDARD_CONFIG_FILE = 'openapi-merge.json';

export async function loadConfiguration(configLocation?: string): Promise<Configuration | string> {
  const configFile = configLocation === undefined ? STANDARD_CONFIG_FILE : configLocation;

  try {
    const rawData = await readFileAsString(configFile);
    return await validateConfiguration(rawData);
  } catch (e) {
    return `Could not find or read '${configFile}' in the current directory: ${process.cwd()}`;
  }
}
```

If neither a config file exists nor `--config` is supplied, the tool fails with an error. There is no way to bypass the config file requirement.

---

## 3. Proposed CLI Shape

Extend the CLI to accept **positional file/URL arguments** while keeping the existing `--config` option as a first-class path:

```
openapi-merge-cli [options] [<inputFile|inputURL>...]

Options:
  -c, --config <file>              Path to configuration file (takes precedence if both given)
  -o, --output <path>              Output file path (default: ./merged.<ext> based on first input)
  --dispute-prefix <prefix>        Prefix for disputing component names (applied to all inputs)
  --strip-start <path>             Path modification: stripStart (applied to all inputs)
  --prepend <path>                 Path modification: prepend (applied to all inputs)
  -v, --version                    Show version
  -h, --help                        Show help
```

### Exclusive modes:
- **Mode A (config-file mode):** `--config <file>` supplied → load and use the config file; ignore any positional args.
- **Mode B (positional args mode):** One or more positional args supplied, no `--config` → synthesize a `Configuration` internally and proceed.
- **Error:** Both `--config` and positional args supplied → error with a clear message (e.g., "Cannot supply both `--config` and positional arguments. Use one mode or the other.").

### Output default:
If `-o` / `--output` is not provided in positional mode:
- Take the extension of the first input file (`.yaml`, `.yml`, or `.json`).
- Default output to `./merged.<ext>` in the current working directory.
- Log this to the user so they know where the file is written.

---

## 4. Design Decisions

### 4a. Mixed Files and URLs
**Decision:** Yes, allow mixing local files and URLs in the positional arguments.

**Rationale:** Users may want to merge a local spec with a remote one (e.g., a published service API). Detecting URLs by `startsWith('http://')` or `'https://'` is simple and intuitive.

**Implementation:** In the synthesization helper, check each argument; if it is a URL, create a `ConfigurationInputFromUrl`; otherwise, treat it as a file path and create a `ConfigurationInputFromFile`.

### 4b. Unified Code Path
**Decision:** Synthesize a virtual `Configuration` object internally and feed it through the same `loadConfiguration` / `convertInputs` pipeline.

**Rationale:** 
- Minimizes code duplication and risk of divergence.
- The validation logic, file loading, and merge logic remain identical for both modes.
- Jest tests can exercise the synthesization helper in isolation.
- Easier to maintain and extend in the future.

**Alternative considered:** Branch the code (one path for config files, one for positional args). Rejected because it creates two divergent code paths that need independent testing and may diverge over time.

### 4c. Uniform Path Modification
**Decision:** The `--dispute-prefix`, `--strip-start`, and `--prepend` flags apply uniformly to all positional inputs.

**Rationale:** Simple and predictable. For more fine-grained per-input control, users fall back to a config file.

### 4d. Cross-Link with Proposal #93
**Decision:** Positional arguments (file paths) should be resolved using the same `path.resolve()` helper introduced in proposal #93 (absolute paths).

**Rationale:** A user may pass an absolute path like `openapi-merge-cli /tmp/specs/a.yaml /tmp/specs/b.yaml -o /tmp/merged.yaml`. This should work consistently with the fix in #93.

---

## 5. Implementation Steps

### Step 1: Extract `synthesizeConfiguration(positionals, options)` Helper
**File:** `packages/openapi-merge-cli/src/index.ts` (new, or inline initially)

Create a function that takes:
- An array of positional argument strings (file paths or URLs).
- Parsed `commander` options (`{ output?, disputePrefix?, stripStart?, prepend? }`).

Returns:
- A `Configuration` object (ready to validate and use).
- Or an error string if validation fails (e.g., no positional args given, invalid URL format).

**Pseudocode:**
```typescript
function synthesizeConfiguration(
  positionals: string[],
  options: { output?: string; disputePrefix?: string; stripStart?: string; prepend?: string }
): Configuration | string {
  if (positionals.length === 0) {
    return 'Error: No input files or URLs provided.';
  }

  const inputs: ConfigurationInput[] = positionals.map((arg) => {
    const isUrl = arg.startsWith('http://') || arg.startsWith('https://');
    const base: ConfigurationInputBase = {
      pathModification: {
        stripStart: options.stripStart,
        prepend: options.prepend,
      },
    };

    if (isUrl) {
      return { inputURL: arg, ...base };
    } else {
      return { inputFile: arg, ...base };
    }
  });

  // Add dispute prefix if provided
  if (options.disputePrefix) {
    inputs.forEach(inp => {
      inp.dispute = { prefix: options.disputePrefix };
    });
  }

  // Infer output extension from first input
  const firstInput = positionals[0];
  const isYaml = ['.yaml', '.yml'].some(ext => firstInput.endsWith(ext));
  const ext = isYaml ? '.yaml' : '.json';
  const defaultOutput = `./merged${ext}`;

  return {
    inputs,
    output: options.output || defaultOutput,
  };
}
```

### Step 2: Update `src/index.ts` — Extend Commander Setup
Add positional arguments and new options to the `commander` program:

```typescript
program.version(pjson.version);

program
  .option('-c, --config <config_file>', 'The path to the configuration file for the merge tool.')
  .option('-o, --output <path>', 'Output file path (defaults to ./merged.<ext>).')
  .option('--dispute-prefix <prefix>', 'Prefix for disputing component names.')
  .option('--strip-start <path>', 'Path modification: strip this from start of paths.')
  .option('--prepend <path>', 'Path modification: prepend this to paths.')
  .arguments('[inputFiles...]')
  .action((inputFiles) => {
    program.inputFiles = inputFiles;
  });

program.parse(process.argv);
```

### Step 3: Update `main()` — Detect Mode and Load Configuration
In the `main()` function, add logic to detect which mode is active:

```typescript
export async function main(): Promise<void> {
  const logger = new LogWithMillisDiff();
  program.parse(process.argv);

  // Detect mode: config file or positional args
  const hasConfig = !!program.config;
  const hasPositionals = program.inputFiles && program.inputFiles.length > 0;

  if (hasConfig && hasPositionals) {
    console.error('Error: Cannot supply both --config and positional arguments. Use one mode or the other.');
    process.exit(ExitCode.ErrorLoadingConfig);
    return;
  }

  let config: Configuration | string;

  if (hasConfig || (!hasConfig && !hasPositionals)) {
    // Mode A: Config file (existing behaviour)
    config = await loadConfiguration(program.config);
  } else {
    // Mode B: Positional arguments (new behaviour)
    const synthesized = synthesizeConfiguration(program.inputFiles, {
      output: program.output,
      disputePrefix: program.disputePrefix,
      stripStart: program.stripStart,
      prepend: program.prepend,
    });

    if (typeof synthesized === 'string') {
      console.error(synthesized);
      process.exit(ExitCode.ErrorLoadingConfig);
      return;
    }

    config = synthesized;
  }

  // ... rest of main() proceeds identically
}
```

### Step 4: Add Jest Tests
**File:** `packages/openapi-merge-cli/src/__tests__/synthesizeConfiguration.test.ts` (new)

Add tests covering:
- Single local file input with no options → default output inferred.
- Multiple file inputs → correct synthesis.
- URL input mixed with file input.
- Custom output path provided.
- Dispute prefix applied to all inputs.
- Path modifications (stripStart, prepend) applied uniformly.
- Error case: no positional args.

---

## 6. Backwards Compatibility

**Fully backward-compatible.** Existing workflows are unaffected:

- Users currently running `openapi-merge-cli` (with `openapi-merge.json` in the cwd) see no change.
- Users running `openapi-merge-cli --config custom.json` see no change.
- The config file mode continues to take full precedence if both config and positionals are given (we error early to prevent confusion).

**Version bump:** Minor version in `packages/openapi-merge-cli/package.json` (e.g., `1.6.0 → 1.7.0`). No changes to the library package.

---

## 7. Cross-Links

### Proposal #93 (Absolute Paths)
This proposal benefits from the path-resolution helper being extracted in #93. Once #93 merges, positional file arguments should also be resolved via `path.resolve()` (or a dedicated `resolvePath()` helper) so that absolute paths like `/tmp/spec.yaml` work correctly. The `basePath` logic in `main()` may also need refinement for positional mode (use `process.cwd()` as base, not the config file's directory).

### Related issues
- #61 (Auth headers) — may influence how URLs are fetched in positional mode; no direct dependency.
- #60 (x-tagGroups) — orthogonal; affects merge behaviour, not CLI interface.
- #102 (Global title/description) — also CLI-focused; can be bundled in the same minor release.

---

## 8. Effort Estimate

| Phase | Estimate |
| --- | --- |
| Extract & test `synthesizeConfiguration()` helper | ~30 min |
| Update `commander` setup in `src/index.ts` | ~20 min |
| Update `main()` logic to detect mode | ~15 min |
| Jest tests for the helper | ~20 min |
| Manual testing (config mode, positional mode, mixed error) | ~10 min |
| Documentation update to `README.md` | ~15 min |
| **Total** | **~110 min (~2 hours)** |

This aligns with the triage estimate of **Effort 2**.

---

## 9. Acceptance Criteria

- [ ] `synthesizeConfiguration()` helper created, exported, and unit-tested with Jest.
- [ ] Helper correctly builds a `Configuration` object from positional arguments and CLI options.
- [ ] Helper infers output extension (`.yaml` or `.json`) from the first input.
- [ ] Helper rejects the case where no positional args are given (returns an error string).
- [ ] Commander setup extended to accept `[inputFiles...]` positional arguments and new options (`-o`, `--dispute-prefix`, `--strip-start`, `--prepend`).
- [ ] `main()` detects exclusive mode: config OR positionals, not both.
- [ ] Error message is clear and actionable if both `--config` and positionals are supplied.
- [ ] Existing `--config` mode continues to work identically (regression test included).
- [ ] Positional mode works: `openapi-merge-cli a.yaml b.yaml` outputs to `./merged.yaml`.
- [ ] Positional mode with custom output: `openapi-merge-cli a.json b.json -o out.json` works.
- [ ] Mixed file + URL inputs work (e.g., `openapi-merge-cli ./local.yaml https://api.example.com/spec.yaml`).
- [ ] `--dispute-prefix`, `--strip-start`, `--prepend` apply uniformly to all positional inputs.
- [ ] `packages/openapi-merge-cli/README.md` updated with new usage section and examples.
- [ ] Minor version bumped in `packages/openapi-merge-cli/package.json`.
- [ ] All CI tests pass (lint, existing Jest suites).
- [ ] Manual smoke test: `openapi-merge-cli` (no args, with `openapi-merge.json`) still works.
- [ ] Manual smoke test: `openapi-merge-cli confluence.swagger.yaml jira.swagger.json -o merged.yaml` creates merged output in cwd.

---

## 10. Documentation Plan

### Update `packages/openapi-merge-cli/README.md`

Add a new section after the existing config-file section:

> #### Quick Merge Mode (No Config File)
>
> For simple one-off merges, you can pass OpenAPI files directly as arguments without creating a configuration file:
>
> ```bash
> # Merge two local files, output to ./merged.yaml
> openapi-merge-cli a.yaml b.yaml
>
> # Merge with a custom output path
> openapi-merge-cli a.yaml b.yaml -o custom-merged.yaml
>
> # Mix local files and remote URLs
> openapi-merge-cli ./local.yaml https://api.example.com/openapi.json
>
> # Apply a dispute prefix to all inputs
> openapi-merge-cli a.yaml b.yaml --dispute-prefix MyAPI
>
> # Apply path modifications
> openapi-merge-cli a.yaml b.yaml --strip-start /api --prepend /v1
> ```
>
> **Note:** This mode does not support all features of the config-file mode (e.g., per-input `operationSelection`, `description` merging). For advanced merges, use a configuration file instead.

---

## 11. Future Enhancements (Out of Scope)

- Per-input `operationSelection` in positional mode (would require a more complex CLI flag syntax; defer to config-file mode for now).
- Per-input `description` merging in positional mode (same reasoning).
- Reading sensitive URL credentials from environment variables (#61 — separate proposal).

---

## 12. References

- **Commander.js documentation:** https://github.com/tj/commander.js
- **Proposal #93 (Absolute paths):** See `ai-planning/proposal-93-absolute-paths.md`
- **Issue #45:** https://github.com/robertmassaioli/openapi-merge/issues/45
