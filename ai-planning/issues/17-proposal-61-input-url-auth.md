# Implementation Proposal: Issue #61 — Authorization config for inputURL

**Status:** Proposal (revised 2026-08-02 — the original draft here was written
against a pre-Bun, `isomorphic-fetch`-era version of the CLI; see §0)

**Issue:** [robertmassaioli/openapi-merge#61](https://github.com/robertmassaioli/openapi-merge/issues/61)

---

## 0. Revision note

The previous draft cited `loadOasForInput` at stale line numbers, referenced
`yarn bolt w openapi-merge-cli run gen-schema` (the repo has since moved to
Bun — see `ai-planning/29-proposal-node-runtime-verification.md` and
`30-proposal-bundle-the-cli.md`), and pointed at `isomorphic-fetch`, which was
dropped from the dependency tree entirely (native `fetch` is used now). It
also proposed SSRF/private-IP defences and an `allowPrivateUrls`/`requireHttps`
pair that go beyond what #61 actually asked for. §1–§4 are rewritten against
the current code; §5 keeps one genuinely new finding the SSRF discussion
missed — credential leakage to a *different* host via `$ref` discovery — and
drops the rest as scope creep (see §7).

## 1. Issue Summary

**User request** (verbatim): "I have several input sources that are
protected. Would be nice if user/password or api key could be defined in the
config file for an inputURL."

## 2. Current Behaviour, Verified Against `main`

Confirmed still true today, in `packages/openapi-merge-cli/src/index.ts`,
`loadOasForInput()`:

```typescript
const response = await fetch(input.inputURL);
if (!response.ok) {
  throw new InputUrlStatusError(input.inputURL, response.status, response.statusText);
}
```

No `init` (headers) argument is ever passed to `fetch`. `ConfigurationInputFromUrl`
in `data.ts` has exactly one field — `inputURL: string` — and nothing else;
there is no way, today, to attach an `Authorization` header or any other
custom header to this request. The problem is exactly as real now as when
#61 was filed.

There is a **second** fetch call site that matters for this proposal's
design and did not exist when the original draft was written:
`external-reference-discovery.ts`'s `loadDocument()`, added for
`resolveExternalReferences` (proposal 37/issue #10). It fetches any URL
discovered via a cross-document `$ref`, which — unlike a declared `inputURL`
— is not necessarily on the same host, and is not something the config
author necessarily controls (it may be discovered transitively, several
`$ref` hops deep, inside a document someone else authored).

## 3. Proposed API (unchanged shape, narrower scope than the original draft)

```typescript
export interface ConfigurationInputFromUrl extends ConfigurationInputBase {
  /** @format uri @pattern ^https?:// */
  inputURL: string;

  /**
   * Optional HTTP headers sent with the request to `inputURL`.
   * Values support `${ENV_VAR}` interpolation; a referenced variable that
   * is not set fails configuration loading with a clear error rather than
   * sending a literal `${...}` string or an empty header.
   */
  headers?: Record<string, string>;
}
```

A generic header map (not special-cased `username`/`password`/`apiKey`
fields) for the same reasons the original draft gave: it covers bearer
tokens, basic auth, and arbitrary API-key headers with one mechanism, and it
is what `curl -H` and every HTTP client library already do.

## 4. Environment-variable interpolation

Same mechanism as the original draft, relocated to the correct hook:
`validateConfigurationSemantics()` in `load-configuration.ts` is the existing
place cross-field checks that the JSON Schema cannot express already live
(today: the tabs+YAML check). Interpolating `${VAR}` inside header values and
failing loudly on a missing variable belongs there, run once at config-load
time, so a typo'd env var name is caught before any network request rather
than surfacing as a confusing 401 from the remote server.

```
Error loading configuration: header 'Authorization' on input 2 references
undefined environment variable 'API_TOKEN'.
```

Exit code: `ExitCode.ErrorLoadingConfig` (1) — unchanged from today's config
error behaviour.

## 5. The design decision the original draft missed: headers must not follow `$ref` discovery

`headers` on a `ConfigurationInputFromUrl` must be threaded **only** into the
`fetch()` call for that specific `inputURL`, in `loadOasForInput()`. It must
**not** be forwarded into `external-reference-discovery.ts`'s `loadDocument()`
for URLs discovered via `resolveExternalReferences`.

Reasoning: a discovered `$ref` can point at any host, arbitrarily many
indirection hops from the original input, and — per the existing
`resolveExternalReferences` design — is treated as *less* trusted than a
declared input (that's the entire reason `inputRoot` exists for the
file-system read side, proposal 38). Forwarding an `Authorization: Bearer
<token>` header to every host a `$ref` chain happens to mention would leak
that credential to a completely unrelated party. Nothing currently prevents
this because no headers exist yet to leak — but it is exactly the kind of
gap this codebase's existing containment work (proposal 38, the
`OutputOutsideRootError`/`InputOutsideRootError` pair) is built to avoid
elsewhere, so it should be closed by construction here rather than left as
an easy-to-miss detail: `headers` is a per-`inputURL` property, consumed only
where that specific URL is fetched, and `loadDocument()`'s signature should
not gain a headers parameter at all.

## 6. Logging: redact header values

`loadOasForInput()`'s existing log line (`## Loading input N from URL:
...`) does not currently log headers, so there's no existing leak — but any
new logging or error message touching `input.headers` must redact values,
not just avoid printing them today. A `redactedHeaders()` helper (mask every
value, keep keys) belongs anywhere headers might later show up in output,
including `InputUrlStatusError`'s message if that's ever extended to include
request details.

## 7. What I'd cut from the original draft, and why

The previous version of this document added `allowPrivateUrls` and
`requireHttps` flags — SSRF and plaintext-credential defences. Verified
against current code: **the CLI has zero SSRF protection today**, for either
declared `inputURL`s or discovered `$ref` targets — any URL, including
`http://169.254.169.254/` or `http://localhost:...`, is fetched without
restriction, and this is not new or specific to adding headers. That's an
existing, accepted risk under this project's stated threat model (the config
file is trusted, the same posture documented for `outputRoot`/`inputRoot` in
proposal #93's Security Considerations section) — not something #61 asked
for, and not something that gets meaningfully worse by adding `headers`
specifically (a config author who can already point `inputURL` at an
internal host can already reach it; they just couldn't attach a header to
the request before). Bundling SSRF hardening into this proposal was scope
creep in the original draft: it's a separate, larger feature (URL
allowlisting/denylisting) that deserves its own issue and its own value/effort
assessment, not a rider on "let me add an Authorization header."

## 8. Effort

| Task | Effort |
| --- | --- |
| `ConfigurationInputFromUrl.headers` + schema regen | 15 min |
| Env-var interpolation in `validateConfigurationSemantics` (or a sibling function called alongside it) | 30 min |
| Thread `headers` into `loadOasForInput`'s `fetch` call only | 10 min |
| Tests: interpolation success/failure, headers reach the right fetch call and not the other one, redaction | 45 min |
| README | 10 min |
| **Total** | **~2 hours** |

## 9. Opinion: is this worth building?

**Yes — this is a real, still-unaddressed gap with a small, well-contained
fix**, once scoped to what #61 actually asked for rather than the SSRF
hardening the earlier draft bundled in. The `$ref`-discovery credential-leak
consideration in §5 is the one thing worth being careful about in
implementation — it needs a design decision made *before* writing code, not
discovered by an incident later — but doesn't materially change the effort
estimate, since it's satisfied by simply not threading `headers` into
`loadDocument()` at all rather than by adding new logic.

**Recommendation: implement, scoped to §3–§6 only.** Treat SSRF/URL
allowlisting (§7) as a separate, later issue if anyone asks for it — it has
a different cost/benefit profile and applies to every URL fetch this tool
already makes, not just authenticated ones.

## 10. Non-goals

- SSRF defences, private-IP blocking, HTTPS-only enforcement (§7) — separate
  issue if wanted.
- A dedicated CLI flag for one-off headers without a config file — the
  original draft deferred this to #45 (no-config mode); given
  `13-proposal-45-no-config.md`'s current recommendation is to *not* build
  that mode as originally scoped, this stays deferred indefinitely rather
  than to a specific future proposal.
- Forwarding `headers` to `resolveExternalReferences`-discovered documents —
  explicitly rejected in §5, not merely deferred.
