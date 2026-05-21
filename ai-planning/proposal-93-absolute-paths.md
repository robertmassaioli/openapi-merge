# Implementation Proposal: Issue #93 — Leading '/' Stripped from Output Path

**Issue:** [robertmassaioli/openapi-merge#93](https://github.com/robertmassaioli/openapi-merge/issues/93)  
**Title:** Leading '/' is stripped from output path  
**Priority:** Patch release (Quick Win)  
**Value:** 4 / **Effort:** 1 / **ROI:** 4.0

---

## 1. Issue Summary

When a user specifies an absolute path in the configuration (e.g., `"output": "/tmp/merged.yaml"` or `"output": "/home/user/specs/out.json"`), the CLI incorrectly treats it as relative to the config file's directory. The leading `/` is silently stripped, and the file is written to a relative path instead (e.g., `tmp/merged.yaml`), causing `ENOENT` errors or silent data loss.

The same bug affects `inputFile` paths within the inputs array.

---

## 2. Root Cause Analysis

### The Problem

**File:** `packages/openapi-merge-cli/src/index.ts`

Two call sites use `path.join(basePath, userPath)` without checking if `userPath` is absolute:

1. **Line 161** (output path):
   ```typescript
   const outputFullPath = path.join(basePath, config.output);
   ```

2. **Line 47** (input file path in `loadOasForInput`):
   ```typescript
   const fullPath = path.join(basePath, input.inputFile);
   ```

### Why `path.join()` Fails

Node's `path.join()` has documented semantics: **any absolute path segment in the arguments discards all previous segments**. Examples:

```javascript
path.join('/base', 'relative')     // → '/base/relative' ✓
path.join('/base', '/absolute')    // → '/absolute' (✓ correct!)
path.join('./', '/absolute')       // → '/absolute' (✓ correct!)

// But in our case:
path.join('config-dir', '/tmp/foo') // → 'tmp/foo' (✗ WRONG!)
```

When `basePath = 'config-dir'` (a relative path), `path.join()` treats it as relative to the current working directory and collapses the leading `/` of the second argument. This is because `path.join()` normalises the segments; the leading `/` is lost in the normalization.

### Affected Code Paths

- **Input loading:** `loadOasForInput()` (line 45–55) → `path.join(basePath, input.inputFile)` (line 47)
- **Output writing:** `main()` (line 126+) → `path.join(basePath, config.output)` (line 161)
- **Logging:** Lines 48 and 162 log the mangled paths, misleading users about where files are being read/written.

---

## 3. Proposed Fix

### Solution: Use `path.resolve()` Instead

Replace both `path.join(basePath, ...)` calls with `path.resolve(basePath, ...)`.

#### Why `path.resolve()`?

`path.resolve()` correctly handles absolute paths:

```javascript
path.resolve('/base', '/tmp/foo')    // → '/tmp/foo' ✓
path.resolve('/base', 'relative')    // → '/base/relative' ✓
path.resolve('.', '/tmp/foo')        // → '/tmp/foo' ✓
path.resolve('.', 'relative')        // → '/absolute/path/to/relative' ✓
```

It also **normalises relative paths** (e.g., `./` and `../`) and is the Node.js standard for converting user-provided paths to absolute filesystem paths.

### Code Changes

**In `loadOasForInput()` (line 45–55):**

```typescript
async function loadOasForInput(basePath: string, input: ConfigurationInput, inputIndex: number, logger: LogWithMillisDiff): Promise<Swagger.SwaggerV3> {
  if (isConfigurationInputFromFile(input)) {
    const fullPath = path.resolve(basePath, input.inputFile);  // ← Change here
    logger.log(`## Loading input ${inputIndex}: ${fullPath}`);
    return (await readYamlOrJSON(await readFileAsString(fullPath))) as Swagger.SwaggerV3;
  } else {
    // ... rest unchanged
  }
}
```

**In `main()` (line 161–162):**

```typescript
const outputFullPath = path.resolve(basePath, config.output);  // ← Change here
logger.log(`## Inputs merged, writing the results out to '${outputFullPath}'`);
```

### Logging Improvement

The proposed fix automatically improves logging: `path.resolve()` always returns an absolute path, so users will see the correct target path in the logs (e.g., `/tmp/merged.yaml` instead of `tmp/merged.yaml`). No additional logging changes needed.

---

## 4. Cross-Platform Considerations

`path.resolve()` and `path.isAbsolute()` are cross-platform safe:

- **POSIX** (Linux, macOS): Absolute paths start with `/`
- **Windows**: Absolute paths are `C:\foo` or network paths `\\server\share`

Node's `path` module automatically detects the platform. The fix works correctly on all platforms without additional branching logic.

---

## 5. Testing Strategy

### Current State

The CLI package (`packages/openapi-merge-cli/`) has **no Jest tests** today. Functional coverage is in the library package (`packages/openapi-merge/src/__tests__/`).

### Recommended Approach: Extract a Testable Helper

Create a simple helper function in `src/index.ts` (or a new `src/path-resolution.ts` module):

```typescript
export function resolveConfigPath(basePath: string, userPath: string): string {
  return path.resolve(basePath, userPath);
}
```

Then add a Jest suite at `src/__tests__/path-resolution.test.ts`:

```typescript
import { resolveConfigPath } from '../path-resolution';
import path from 'path';

describe('resolveConfigPath', () => {
  it('leaves absolute paths unchanged', () => {
    expect(resolveConfigPath('/config/dir', '/tmp/output.json')).toBe('/tmp/output.json');
  });

  it('joins relative paths correctly', () => {
    const basePath = path.dirname(__filename);
    const result = resolveConfigPath(basePath, 'output.json');
    expect(result).toBe(path.join(basePath, 'output.json'));
  });

  it('handles ./ and ../ correctly', () => {
    const result = resolveConfigPath('/base', './relative.json');
    expect(result).toBe('/base/relative.json');
  });

  it('works on Windows paths', () => {
    // Mock test (or use WSL for real Windows paths)
    // path.isAbsolute('C:\\foo') → true on Windows
    expect(path.isAbsolute('C:\\Users\\test\\file.json')).toBe(process.platform === 'win32');
  });
});
```

### Alternative: Smoke Test in CI

If Jest setup is unwanted, add a shell-based smoke test invoked in CI:

```bash
# test-absolute-paths.sh
cd /tmp
echo '{"inputs": [{"inputURL": "https://example.com"}], "output": "/tmp/test-output.json"}' > config.json
yarn cli --config /tmp/config.json
[[ -f /tmp/test-output.json ]] && echo "✓ Absolute output path works" || exit 1
```

**Recommendation:** Extract the helper and add Jest tests for future maintainability.

---

## 6. Backwards Compatibility

**No breaking changes.** Current users cannot be relying on the broken behaviour:

- **Relative paths** continue to work identically (e.g., `"output": "output.json"`).
- **Absolute paths** currently fail with `ENOENT` → after the fix, they succeed.
- **No API changes** — the config format and CLI interface remain unchanged.

**Version bump:** Patch version (`1.X.Y → 1.X.(Y+1)`).

---

## 6a. Security Considerations

### Question raised

> "Is letting the script put a file anywhere a security issue?"

The short answer is **no for the developer-CLI use case that the tool
exists for today, but yes in some less common embeddings.** Allowing
absolute paths does not grant a new capability; it just makes an
existing one less awkward to use. The CLI process can already write
anywhere it has filesystem permission to today (relative paths with
`..` traversal work fine). This section documents the threat model so
the maintainer and downstream consumers can make an informed call.

### Threat model

| Scenario | New risk from allowing absolute paths? |
| --- | --- |
| Developer manually edits `openapi-merge.json` and runs `npx openapi-merge-cli` locally | **No.** They could already `cp` anything they wanted. |
| CI pipeline reads a config committed to the same repo by trusted maintainers | **No.** Whoever can commit the config can already commit a malicious build step. |
| CI pipeline runs against a PR from an outside contributor with maintainer-level secrets (`pull_request_target`, etc.) | **Slightly elevated.** Same risk class as any "untrusted PR runs build scripts". Typically mitigated at the CI layer, not in this tool. |
| Hosted SaaS / web service that lets end-users upload configs and runs the CLI server-side | **Real.** The CLI was never designed for this and should not be used this way without sandboxing. Allowing absolute paths makes the attack one character shorter, but the underlying capability was always there. |

In the hostile-config case, an attacker who controls
`openapi-merge.json` could direct the output to overwrite
`~/.ssh/authorized_keys`, drop a file into `/etc/cron.d/`, or replace
`node_modules/somepkg/index.js`. The same risks exist today via
`./../../etc/...`-style relative paths; the fix simply removes one
character of friction. Symlink-following by `fs.writeFileSync` is also
an existing concern.

### Decisions for this proposal

1. **Document the trust assumption.** This CLI assumes the
   configuration file is trusted, the same way a `Makefile`, `package.json`,
   or `webpack.config.js` is trusted. Add a short "Security" subsection
   to the CLI's `README.md` calling this out explicitly so downstream
   consumers are not surprised.
2. **Apply the path-resolution fix to both `inputFile` and `output`.**
   The bug already affects `inputFile`; leaving it half-fixed would be
   inconsistent. Reading absolute paths is lower-impact than writing to
   them (the contents only leak if the attacker also controls the
   output sink), but consistency matters and the fix is identical.
3. **Add an opt-in defence-in-depth knob.** Introduce an optional
   top-level `outputRoot` (and optionally `inputRoot`) config field
   plus a matching CLI flag (`--restrict-output-to <dir>`). When set,
   any resolved output path that does not lie under the configured
   root is rejected at config-validation time with a clear error
   message and the new `ExitCode.ErrorLoadingConfig` (or a new
   `ExitCode.ErrorUnsafePath` if we want to distinguish it — defer
   that decision until implementation). When unset (the default), the
   behaviour matches today's permissive model so we do not regress
   developer ergonomics.
4. **Symlink awareness for the safety knob.** If `outputRoot` is set,
   the containment check must compare against `fs.realpathSync` of the
   parent directory of the resolved output path, not just the
   lexical path string. Otherwise a symlink inside the allowed root
   can point anywhere on disk.
5. **Do NOT gate absolute paths behind a flag in the default case.**
   That would treat users as the threat. Anyone running the CLI on
   their own machine is the threat actor we cannot defend against, so
   adding friction there only hurts legitimate users.

### Out of scope

- A full sandboxing/seccomp/jail story. The right place for that is
  the platform running the CLI (Docker, CI runner, etc.), not inside
  the merge tool.
- Reading inputs from arbitrary URLs via `inputURL`. That is its own
  SSRF discussion (issue #61's auth-headers proposal touches it); not
  addressed here.

### Suggested README excerpt

> **Security.** `openapi-merge-cli` reads, merges, and writes files
> using the paths specified in your `openapi-merge.json` (or via
> `--config`). The tool assumes that this configuration file is
> trusted, the same way you trust a `Makefile` or `package.json` in
> your repository. Do not run the CLI against a configuration file
> from an untrusted source without restricting the output location
> via the `outputRoot` config option (see the configuration
> reference).

---

## 7. Effort Estimate

- **Code change:** ~5 minutes (two `path.join()` → `path.resolve()` replacements).
- **Helper extraction:** ~10 minutes.
- **Test suite:** ~15 minutes (3–4 simple test cases).
- **Verification:** ~10 minutes (manual smoke test + CI).

**Total:** ~40 minutes of developer time.

**Confirms:** Value 4 / Effort 1 ✓

---

## 8. Acceptance Criteria

### Core fix (required)

- [ ] Both call sites in `src/index.ts` (lines 47 and 161) use `path.resolve()` instead of `path.join()`.
- [ ] Absolute input paths (e.g., `"inputFile": "/home/user/specs.yaml"`) are correctly resolved.
- [ ] Absolute output paths (e.g., `"output": "/tmp/merged.json"`) are correctly written to their intended location.
- [ ] Logs display the resolved absolute paths, aiding user debugging.
- [ ] All existing relative path configurations continue to work unchanged.
- [ ] A `resolveConfigPath()` helper is extracted and tested with Jest (or smoke-tested in CI).
- [ ] Manual test: running with `--config /tmp/openapi-merge.json` and `"output": "/tmp/result.yaml"` writes to `/tmp/result.yaml`, not `tmp/result.yaml`.
- [ ] CI passes on Linux, macOS, and Windows.
- [ ] Patch version bumped in `packages/openapi-merge-cli/package.json`.

### Security (required)

- [ ] `packages/openapi-merge-cli/README.md` has a new "Security" subsection stating that the configuration file is treated as trusted, in line with `Makefile` / `package.json`.

### Defence-in-depth opt-in (recommended, can ship in a follow-up patch)

- [ ] Optional `outputRoot` (and matching `--restrict-output-to <dir>` CLI flag) added to the CLI configuration schema.
- [ ] When set, any resolved output path outside the canonical root rejects at config-load time with a clear error message and a non-zero exit code (`ExitCode.ErrorLoadingConfig` or a dedicated `ExitCode.ErrorUnsafePath`, decided at implementation time).
- [ ] Containment check uses `fs.realpathSync` on the parent directory of the resolved output to defeat symlink-out-of-jail tricks.
- [ ] When unset, behaviour matches the permissive default (no regression for existing users).
- [ ] Jest tests cover: in-root path accepted, out-of-root path rejected, symlink-out-of-root rejected.

---

## 9. References

- **Node `path` documentation:** https://nodejs.org/api/path.html
  - `path.join()` — joins segments; absolute segments reset the path
  - `path.resolve()` — resolves to an absolute path, handling relative segments
  - `path.isAbsolute()` — platform-aware absolute path detection
- **Current code:** `packages/openapi-merge-cli/src/index.ts` lines 47, 161
- **Triage:** Patch release, Value 4 / Effort 1 (Quick Win quadrant)
