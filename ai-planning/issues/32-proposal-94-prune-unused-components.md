# Implementation Proposal: Issue #94 — Prune Components Nothing References

**Issue:** [#94 — excludeTags working but not removing unwanted schemas](https://github.com/robertmassaioli/openapi-merge/issues/94)

**Status:** ✅ Implemented — written alongside the change; this issue had no
prior proposal.

**Value:** 4 | **Effort:** 3

---

## 1. Issue summary

> If I exclude some tags, I would expect the schemas attached to those tags to
> also be removed (unless it's also used by another endpoint)

`operationSelection` deletes the operations a tag rule excludes. Nothing then
removes the components those operations were the only referrers of, so the
merged document carries schemas for endpoints it no longer contains.

The parenthetical is the whole difficulty: a schema used by *any* surviving
endpoint has to stay.

## 2. Reachability, not bookkeeping

Two ways to do this:

- **Track what each removed operation referenced** and subtract it. Requires
  intersecting against everything else, and gets the shared case wrong the
  moment a component is reachable by a path nobody thought about — through
  another component, through a callback, through a webhook.
- **Walk what the surviving document references, and drop the rest.**

The second is implemented. It makes the issue's caveat true by construction
rather than by remembering to handle it, and it costs one traversal of a
document already in memory.

Roots are the merged `paths` and `webhooks`; the closure follows each reachable
component's own references until nothing new appears.

## 3. Security schemes are not `$ref`s

A Security Requirement names its scheme as an **object key** — `{ apiKey: [] }`
— so the reference walker cannot see it. Pruning without accounting for that
would delete every security scheme in the document, which is the same blind
spot that made renaming them wrong in issue #33.

Handled explicitly: scheme names are collected from the document-level
`security` array and from every operation's, across paths and webhooks.

## 4. Opt-in, and why

`pruneUnusedComponents` defaults to `false`.

Pruning is destructive, and this library has always preserved every component
it was given. A document may legitimately carry definitions referenced only from
outside it — another spec `$ref`ing into this one, a code generator keyed on
component names, a schema published for consumers to reference. Silently
deleting those is a worse failure than carrying a few unused definitions,
because the unused definitions are visible and the deletion is not.

So the default preserves today's behaviour and the issue's expectation is one
flag away. An unrecognised component bucket — a type from a spec version newer
than this code — is passed through untouched for the same reason.

## 5. Where it runs

Last, on the finished document, after operation selection, deduplication,
renaming and reference rewriting have all had their say. Anything earlier would
compute reachability against a document that does not exist yet.

## 6. Verification

11 tests in `prune-components.test.ts`; **6 fail against `origin/main`**,
confirmed in a detached worktree. They cover the default (unchanged), the
issue's exact scenario, the shared-schema caveat, chains of component
references, webhooks as roots, both security-scheme cases plus an unused one
that is correctly dropped, removing `components` entirely when nothing
survives, and a dangling reference not crashing the walk.

3 CLI tests for the wiring, including ajv rejecting a non-boolean.

Gate green: lint, 398 tests, 48 artifact checks.

## 7. Related

Issue #60 §5.4 wanted `x-tagGroups` entries filtered when `excludeTags` removes
a tag. That was deferred for wanting exactly this machinery. It is now
available: a follow-up could drop group entries naming tags no surviving
operation carries.
