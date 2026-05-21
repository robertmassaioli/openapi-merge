# Implementation Proposal: Issue #61 — Authorization config for inputURL

**Status:** Proposal  
**Value:** 3 | **Effort:** 2 | **ROI:** 4 (Quick Win)

**Issue:** [robertmassaioli/openapi-merge#61](https://github.com/robertmassaioli/openapi-merge/issues/61)

---

## 1. Issue Summary

Users need to load OpenAPI specifications from URLs that require authentication (e.g., bearer tokens, API keys, basic auth, or custom headers). Today the CLI's `fetch` call has no mechanism to supply HTTP headers, making it impossible to access protected endpoints.

**User request:** "I have several input sources that are protected. Would be nice if user/password or api key could be defined in the config file for an inputUrl."

---

## 2. Current Behaviour

In `packages/openapi-merge-cli/src/index.ts`, the `loadOasForInput` function (lines 44–54) handles URL inputs:

```typescript
async function loadOasForInput(basePath: string, input: ConfigurationInput, inputIndex: number, logger: LogWithMillisDiff): Promise<Swagger.SwaggerV3> {
  if (isConfigurationInputFromFile(input)) {
    const fullPath = path.join(basePath, input.inputFile);
    logger.log(`## Loading input ${inputIndex}: ${fullPath}`);
    return (await readYamlOrJSON(await readFileAsString(fullPath))) as Swagger.SwaggerV3;
  } else {
    logger.log(`## Loading input ${inputIndex} from URL: ${input.inputURL}`);
    const inputContents = await fetch(input.inputURL).then(rsp => rsp.text());  // ← No headers
    return (await readYamlOrJSON(inputContents)) as Swagger.SwaggerV3;
  }
}
```

The `fetch` call on line 51 passes no `init` parameter, meaning no custom headers can be supplied. The `ConfigurationInputFromUrl` interface in `data.ts` (lines 162–170) has only `inputURL` and inherited `pathModification`, `operationSelection`, and `description` fields — no provision for headers.

---

## 3. Proposed API

### 3.1 Data Model Extension

Extend `ConfigurationInputFromUrl` in `packages/openapi-merge-cli/src/data.ts`:

```typescript
export interface ConfigurationInputFromUrl extends ConfigurationInputBase {
  /**
   * The input URL to load the OpenAPI specification from.
   *
   * @format uri
   * @pattern ^https?://
   */
  inputURL: string;

  /**
   * Optional HTTP headers to include in the request to inputURL.
   * Values support environment variable interpolation: ${ENV_VAR}.
   * If a referenced env var is missing, configuration loading fails with a clear error.
   *
   * @examples [{ "Authorization": "Bearer ${MY_API_TOKEN}", "X-Custom-Header": "value" }]
   */
  headers?: Record<string, string>;

  /**
   * If true, allows requests to private/loopback/link-local addresses
   * (RFC1918, 127.0.0.0/8, 169.254.0.0/16, ::1, etc.).
   * Default: false (rejects such URLs as SSRF defence-in-depth).
   *
   * @default false
   */
  allowPrivateUrls?: boolean;

  /**
   * If true, requires that inputURL uses HTTPS (rejects http://).
   * Default: false (allows plain HTTP for development/testing).
   *
   * @default false
   */
  requireHttps?: boolean;
}
```

### 3.2 Why a Generic Headers Map?

We deliberately chose a generic `headers: Record<string, string>` over special-casing "bearer" or "basic" auth for three reasons:

1. **Future-proof:** Users may need custom headers (`X-API-Key`, `X-Custom-Auth`, `Idempotency-Key`, etc.) that do not fit standard auth schemes.
2. **Validation simplicity:** A generic map is easier to validate in JSON Schema than multi-variant oneOf patterns.
3. **Consistency:** It mirrors common patterns in tools like `curl` (`-H`) and HTTP client libraries.

### 3.3 Configuration Examples

#### Bearer Token via Env Var
```jsonc
{
  "inputs": [
    {
      "inputURL": "https://api.example.com/specs/service-a.json",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  ],
  "output": "./merged.json"
}
```

Run with: `export API_TOKEN=xyz123 && yarn cli --config openapi-merge.json`

#### Basic Auth
```jsonc
{
  "inputURL": "https://api.example.com/specs/service-b.json",
  "headers": {
    "Authorization": "Basic dXNlcjpwYXNz"  // base64(user:pass)
  }
}
```

#### Custom API Key Header + HTTPS Requirement
```jsonc
{
  "inputURL": "https://api.example.com/specs/service-c.yaml",
  "headers": {
    "X-API-Key": "${SERVICE_C_KEY}"
  },
  "requireHttps": true
}
```

---

## 4. Environment-Variable Interpolation

### 4.1 Mechanism

During configuration loading in `load-configuration.ts`, **header VALUES only** (not keys, not other config fields) undergo `${ENV_VAR}` interpolation:

```typescript
function interpolateHeaderEnvVars(headers: Record<string, string>): Record<string, string> | string {
  const result: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    const interpolated = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        return `Missing required environment variable: ${varName} (referenced in header '${key}')`;
      }
      return envValue;
    });
    
    if (typeof interpolated === 'string' && interpolated.startsWith('Missing')) {
      return interpolated; // Early return error
    }
    
    result[key] = interpolated;
  }
  
  return result;
}
```

### 4.2 Error Handling

If a header value references an undefined env var (e.g., `"${MISSING_TOKEN}"`), config loading fails immediately with a clear message:

```
Error loading configuration: Missing required environment variable: MISSING_TOKEN (referenced in header 'Authorization')
```

Exit code: `ExitCode.ErrorLoadingConfig` (1).

### 4.3 Rationale

- **No hardcoded tokens in config:** Users must supply sensitive values via env vars.
- **Lazy validation:** The interpolation step discovers missing vars at load time, not at fetch time.
- **Minimal regex:** Simple `${VAR_NAME}` syntax, no complex templating.

---

## 5. Security Considerations

### 5.1 Header Leakage in Logs

**Risk:** Authorization headers logged to console or error messages could expose tokens.

**Mitigation:** Introduce a `redactedHeaders(headers)` helper that masks all header values for logging:

```typescript
function redactedHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const redacted: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    redacted[key] = '[redacted]';
  }
  return redacted;
}
```

Use this helper in:
- `LogWithMillisDiff` whenever headers are logged (line 50 in index.ts).
- Error messages in `convertInputs` that report fetch failures.
- Any debug output that might reference the config.

### 5.2 Server-Side Request Forgery (SSRF)

**Risk:** A malicious configuration could direct the CLI to fetch from internal endpoints:
- `http://localhost:8080` — local development services
- `http://169.254.169.254/` — AWS metadata endpoint
- `http://127.0.0.1:25` — local SMTP
- `file://` or other non-HTTP schemes (if fetch implementation allows)

**Mitigation:** Add an optional `allowPrivateUrls?: boolean` field (default `false`). When false, at config-load time, validate that the URL does not target:
- Loopback addresses: `127.0.0.0/8`, `::1`
- Private (RFC1918) ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local: `169.254.0.0/16`, `fe80::/10`
- Multicast: `224.0.0.0/4`, `ff00::/8`

Use a simple IP parsing library (e.g., `ipaddr.js`) or Node's `net.isIP()` + custom logic.

**Error example:**
```
Error loading configuration: inputURL "http://127.0.0.1:8080" targets a loopback address. Set "allowPrivateUrls": true to permit (security risk).
```

Exit code: `ExitCode.ErrorLoadingConfig` (1).

### 5.3 HTTPS-Only Opt-In

**Risk:** Plain-HTTP endpoints leak the Authorization header to network sniffers.

**Mitigation:** Add an optional `requireHttps?: boolean` field (default `false`). When true, reject any `http://` URL with a clear message:

```
Error loading configuration: inputURL "http://api.example.com/..." uses plain HTTP. Use "https://" or set "requireHttps": false.
```

Exit code: `ExitCode.ErrorLoadingConfig` (1).

### 5.4 Threat Model

This proposal assumes **the configuration file is trusted**, the same way a `Makefile`, `package.json`, or GitHub Actions workflow is trusted. Refer to the security model established in proposal #93:

> The CLI assumes that the configuration file (and environment variables it references) come from a trusted source. Do not run the CLI against a configuration file from an untrusted source without restricting the URLs or applying other defences.

In a hostile-config scenario (e.g., a pull request contributor submitting a malicious config), the attacker could:
1. Point `inputURL` at an attacker-controlled server to exfiltrate the bearer token.
2. Trigger a request to an internal endpoint if `allowPrivateUrls: true`.

These are mitigated by:
- Default `allowPrivateUrls: false` (rejects private IPs).
- Maintainers reviewing config changes in PRs.
- CI systems sandboxing the CLI execution.

**Update `packages/openapi-merge-cli/README.md`** with a new "Security" subsection:

> **Security.** `openapi-merge-cli` can load OpenAPI specs from URLs provided in your configuration. The tool assumes that the configuration file (`openapi-merge.json`) and environment variables referenced in header values are trusted. Do not run the CLI against a configuration file from an untrusted source without:
> - Reviewing the `inputURL` targets.
> - Setting `allowPrivateUrls: false` (the default) to block requests to internal networks.
> - Ensuring bearer tokens and API keys are passed via environment variables, never hardcoded in the config.

---

## 6. Implementation Steps

### 6.1 `packages/openapi-merge-cli/src/data.ts`

1. Extend `ConfigurationInputFromUrl` interface with `headers?: Record<string, string>`, `allowPrivateUrls?: boolean`, `requireHttps?: boolean`.
2. Add JSDoc comments (with `@examples` for headers, `@default` for optional flags).

### 6.2 `packages/openapi-merge-cli/src/load-configuration.ts`

1. After validation passes (line 19), iterate over each input in the config.
2. For each `ConfigurationInputFromUrl` with `headers` defined:
   - Call `interpolateHeaderEnvVars(headers)` to substitute env vars.
   - If any env var is missing, return an error string with clear guidance.
3. For each `inputURL`:
   - Parse the URL with `new URL(inputURL)` to extract the host.
   - If `requireHttps` is true and protocol is not `https:`, reject with a clear error.
   - If `allowPrivateUrls` is false (default), check if the host is in a private/loopback range; reject if so.
4. Store the interpolated headers on the validated config object.

Add helper functions (can be internal, not exported):
- `interpolateHeaderEnvVars(headers: Record<string, string>): Record<string, string> | string`
- `isPrivateOrLoopbackHost(hostname: string): boolean` (use `ipaddr.js` or custom IP parsing)

### 6.3 `packages/openapi-merge-cli/src/index.ts`

1. Update `loadOasForInput` to accept the interpolated headers (pass them via the `input` parameter or a separate headers dict).
2. Pass headers to `fetch` via the second argument (RequestInit):
   ```typescript
   const inputContents = await fetch(input.inputURL, { headers: input.headers || {} })
     .then(rsp => rsp.text());
   ```
3. In the logging call (line 50), use `redactedHeaders(input.headers)` instead of the raw headers.
4. Add `redactedHeaders()` helper function.

### 6.4 Schema Regeneration

Run from the repo root:
```bash
yarn bolt w openapi-merge-cli run gen-schema
```

This regenerates `packages/openapi-merge-cli/src/configuration.schema.json` from the updated `data.ts` types. Commit the schema.

### 6.5 Dependencies

- **New optional dependency:** `ipaddr.js` (pure JS, no native bindings, ~10KB). Alternatively, use Node's built-in `net.isIP()` + custom logic (preferred to avoid a new dependency).

---

## 7. Tests

Add Jest test suite in a new file: `packages/openapi-merge-cli/src/__tests__/load-configuration-auth.test.ts`

**Test cases:**

1. **Env-var interpolation succeeds**
   - Config with `headers: { "Authorization": "Bearer ${MY_TOKEN}" }`
   - Set `process.env.MY_TOKEN = "secret123"`
   - Assert: headers are interpolated to `{ "Authorization": "Bearer secret123" }`

2. **Missing env var rejects**
   - Config with `headers: { "Authorization": "Bearer ${MISSING_VAR}" }`
   - `process.env.MISSING_VAR` is unset
   - Assert: `loadConfiguration` returns an error string containing "MISSING_VAR"

3. **SSRF check: loopback address blocked by default**
   - Config with `inputURL: "http://127.0.0.1:8080/spec.json"`
   - `allowPrivateUrls` is false (default)
   - Assert: `loadConfiguration` returns an error string mentioning loopback/private

4. **SSRF check: private IP blocked by default**
   - Config with `inputURL: "http://192.168.1.1/spec.json"`
   - Assert: error returned

5. **SSRF check: private URL allowed when opt-in**
   - Config with `inputURL: "http://localhost:8080/spec.json"` and `allowPrivateUrls: true`
   - Assert: config loads successfully (no error)

6. **HTTPS requirement enforced**
   - Config with `inputURL: "http://api.example.com/spec.json"` and `requireHttps: true`
   - Assert: error mentioning "plain HTTP"

7. **HTTPS requirement not enforced by default**
   - Config with `inputURL: "http://api.example.com/spec.json"` (no `requireHttps` or `false`)
   - Assert: config loads successfully

8. **Header redaction in logs**
   - Mock `console.log` or create a fake logger
   - Call `loadOasForInput` with headers
   - Assert: `redactedHeaders()` output shows `[redacted]` instead of actual token values

9. **Multiple headers, selective env-var interpolation**
   - Config with `headers: { "Authorization": "Bearer ${TOKEN}", "X-Custom": "literal-value" }`
   - Assert: Authorization is interpolated, X-Custom remains unchanged

10. **Empty headers object**
    - Config with `headers: {}`
    - Assert: no errors, config loads

---

## 8. CLI Flag Fallback

For one-off usage without a config file, users can rely on shell-level env-var substitution:

```bash
export API_TOKEN=xyz
openapi-merge-cli --config <(cat openapi-merge.json | sed "s/\${API_TOKEN}/$API_TOKEN/g")
```

A dedicated `--header` CLI flag (e.g., `-H "Authorization: Bearer ..."`) is deferred to proposal #45 (no-config mode) and should be designed as part of that broader ergonomics overhaul.

---

## 9. Backwards Compatibility

**Fully additive.** No breaking changes:
- `headers`, `allowPrivateUrls`, and `requireHttps` are all optional fields.
- Existing configs without these fields continue to work identically.
- The `fetch` call without headers remains the fallback path.
- Default `allowPrivateUrls: false` and `requireHttps: false` match today's behaviour for configs that do not specify them.

**Version bump:** Minor version for `packages/openapi-merge-cli/package.json` (e.g., `1.2.0 → 1.3.0`).

---

## 10. Effort Estimate

- **Data model changes** (`data.ts`): ~10 mins (new fields + JSDoc)
- **Config validation** (`load-configuration.ts`): ~30 mins (env-var interpolation, IP checks, URL parsing)
- **Fetch integration** (`index.ts`): ~10 mins (pass headers, redact in logs)
- **Schema regeneration**: ~2 mins (automated)
- **Tests**: ~45 mins (10 test cases, mocking/assertions)
- **Documentation** (README security section, JSDoc): ~10 mins

**Total: ~2–2.5 hours** → **Effort: 2** (matches triage estimate).

---

## 11. Acceptance Criteria

- [ ] `ConfigurationInputFromUrl` extended with `headers?: Record<string, string>`, `allowPrivateUrls?: boolean`, `requireHttps?: boolean`.
- [ ] Environment-variable interpolation in `load-configuration.ts` substitutes `${VAR_NAME}` in header values; missing vars trigger a clear error and exit code 1.
- [ ] SSRF check rejects private/loopback IPs by default; can be overridden with `allowPrivateUrls: true`.
- [ ] HTTPS check rejects plain-HTTP URLs when `requireHttps: true`.
- [ ] `redactedHeaders()` helper masks all header values for logging (used in `LogWithMillisDiff` and error paths).
- [ ] Headers are passed to `fetch` via the RequestInit second argument.
- [ ] Configuration schema (`configuration.schema.json`) regenerated and committed.
- [ ] All 10 test cases in `load-configuration-auth.test.ts` pass.
- [ ] Existing configurations (without `headers` or auth fields) continue to work unchanged.
- [ ] `packages/openapi-merge-cli/README.md` includes a new "Security" subsection documenting the trust assumption.
- [ ] Manual test: `export MY_TOKEN=abc && yarn cli --config test-config-with-env-var.json` successfully loads a protected URL.
- [ ] Minor version bumped in `packages/openapi-merge-cli/package.json`.
- [ ] All lint checks pass (`yarn lint`).

---

## 12. References

- **Node `fetch` API (isomorphic-fetch):** https://github.com/matthew-andrews/isomorphic-fetch
- **URL parsing:** https://nodejs.org/api/url.html#url_the_whatwg_url_api
- **Related proposal #93:** `ai-planning/proposal-93-absolute-paths.md` (security model, threat analysis)
- **Related proposal #45:** No-config mode (deferred CLI flag work)
- **Issue #61:** https://github.com/robertmassaioli/openapi-merge/issues/61
