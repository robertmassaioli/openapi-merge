# Proposal 39: Which `init` defaults should be turned *on*, not just shown

**Status:** Proposal (not yet implemented)

**Not tied to a filed GitHub issue.** Robert's ask directly: turn on some
`Configuration` fields by default in the file `openapi-merge-cli init`
writes, `resolveExternalReferences` given as the example, "for maximum
convenience." Written on a fresh branch off `main` (which already has both
[proposal 34/35](34-proposal-init-yaml-commented-options.md) — every
optional field shown commented out — and #104/#10's `resolveExternalReferences`
merged; [proposal 38](38-proposal-input-root-containment.md)'s `inputRoot` is
in review as [PR #144](https://github.com/robertmassaioli/openapi-merge/pull/144)
but not yet merged).

## 1. This ask runs directly against a design invariant that was just shipped

[Proposal 34](34-proposal-init-yaml-commented-options.md) §2 states a design
goal in so many words: *"The active (uncommented) part of the file is still
just `inputs` and `output` — nothing behavioural changes for someone who
ignores the comments and runs the tool as before."* That was the right call
at the time (§1 of that document: `pruneUnusedComponents`,
`securitySchemesStrategy` and friends were all newly discoverable, none of
them obviously wanted by everyone), and it is still correct for most of
`Configuration`'s optional fields — see §3 below.

But it is not a law of nature, and Robert is the one person who gets to
revise it. The honest framing for this proposal is: **for the small number
of fields where turning a feature on is genuinely what most first-time users
would want, and where doing so costs nothing for users who don't need it,
deliberately break that invariant for those fields specifically** — not
silently, and not for everything, but as a named, scoped exception.

This only matters going forward. `init` already refuses to overwrite an
existing config without `--force` (proposal 33 §4), so nothing about an
already-generated file changes; this only affects configs generated *after*
whatever change lands here.

## 2. A gap this proposal has to fix regardless of what it recommends

While reading `init-command.ts` to answer the actual question, two fields
that already exist on `Configuration` turned out to be completely absent
from `TOP_LEVEL_OPTIONAL_BLOCKS` — not commented out, not shown at all:

- `resolveExternalReferences` (issue #10, merged to `main` before proposal
  34/35's branch was cut, so its author didn't know about it yet).
- `inputRoot` (proposal 38, PR #144, not merged as of this writing — will
  make the gap worse the moment it lands, for the same reason).

This is a real, present-tense defect independent of anything this proposal
recommends: proposal 34's own stated promise (§2, "every optional field on
`Configuration`... appears somewhere in the file") is **not currently true**
on `main`. It slipped past `init-command.test.ts`'s
`'every optional top-level Configuration field is represented'` test because
that test compares `TOP_LEVEL_OPTIONAL_BLOCKS` against a **hand-copied
`expected` array in the test file itself** (`init-command.test.ts:270-272`),
not against `Configuration`'s actual keys — so the test enforces "the two
hand-maintained lists agree with each other," and both were written (or, for
`inputRoot`, will be written) without knowing about the new field. It cannot
catch this class of drift by construction.

Two things worth doing regardless of §3's outcome:

1. Add `resolveExternalReferences` (now) and `inputRoot` (once #144 lands)
   to `TOP_LEVEL_OPTIONAL_BLOCKS`, whether shown on or off (§4 decides
   which).
2. Make the coverage test resistant to this happening again: derive
   `expected` from `Configuration`'s actual keys via a `keyof` /
   `Object.keys` check at the type level, or at minimum add a code comment
   at the *top of `Configuration` in `data.ts`* pointing back at
   `TOP_LEVEL_OPTIONAL_BLOCKS`, so adding a field there prompts a look at
   `init-command.ts` rather than relying on someone remembering. A `keyof`
   comparison is stronger and worth attempting first — TypeScript's
   `Record<keyof Configuration, unknown>` shape means a genuinely missing
   key is a compile error, not just an untested one, which is a much better
   guarantee than a runtime test that can drift silently.

## 3. Field-by-field: what actually belongs on this list

Every optional field on `Configuration`, assessed against the bar "would
turning this on by default, for a config nobody has customised yet, help
more than it surprises":

| Field | Recommend on by default? | Why |
| --- | --- | --- |
| `resolveExternalReferences` | **Yes** | See §5 — this is the field Robert named, and it is the one place `init`'s own reason for existing (a directory of specs that plausibly `$ref` each other) directly benefits from the feature working without the user ever finding the flag. |
| `inputRoot` | **Yes, paired with the above** | Not a "convenience" field on its own — it only ever *restricts*. Recommended because turning `resolveExternalReferences` on by default without it would widen the read surface with no compensating containment, which is exactly the gap proposal 38 exists to close. See §5. |
| `outputRoot` | **No, but flagged as a free option worth a separate decision** | Same shape as `inputRoot` — a pure restriction, zero convenience — but nothing this proposal turns on newly threatens the *write* side the way `resolveExternalReferences` threatens the *read* side, so there's no forcing reason to bundle it in here. It costs nothing to also default it to `.` (init's own suggested `output` is always inside the scanned directory, so it can never reject what `init` itself produces), but that is an independent defense-in-depth call, not a consequence of this proposal's reasoning. Worth a one-line decision from Robert (§8), not a default recommendation from this proposal. |
| `pruneUnusedComponents` | **No** | Its own doc comment (`data.ts`) calls it destructive by nature: *"a document may carry definitions referenced only from outside it."* It also does nothing without `operationSelection`, which `init` never sets — defaulting it on would be a silent, occasionally-destructive behaviour change with zero compensating benefit for the common case (no filtering configured at all). |
| `securitySchemesStrategy` | **No** | `merge` is already the library default when the field is omitted. Writing it explicitly changes nothing behaviourally — it would only add a line that looks like a decision was made when none was. |
| `serversStrategy` | **No** | Same reasoning: `first` is already the default. No behavioural difference between omitting it and writing it. |
| `formatting` | **No** | 2-space indentation is already the default. Same reasoning again. |
| `info` | **No** | Has no sensible universal default — it needs an actual title/version the generator cannot invent. Stays commented, as a template to fill in. |
| Per-input fields (`pathModification`, `operationSelection`, `description`, `duplicatePathHandling`, `tag`, `dispute`) | **No** | None of these have a value that is correct for an arbitrary directory of specs — they encode decisions specific to the inputs found (which prefix to strip, which tags to keep, what a clashing schema should be renamed to). There is nothing to "turn on"; the value itself has to come from the user. |

The pattern across every "no": either the field already matches the
library's own default (writing it is inert), or the field's correct value
is inherently input-specific and the generator has no basis for guessing
it, or turning it on is actively destructive with no offsetting benefit for
the common case. `resolveExternalReferences` is the one field that is none
of those three things — it has a real default-off reason (§4 of `data.ts`'s
own doc comment: "it changes what this tool reads"), but that reason is a
*trust* argument, not a *behavioural-inertness* argument, and for a config
`init` just generated from files it just read off local disk, the trust
question has already been answered by the act of running `init` in that
directory in the first place.

## 4. How "on by default" should look in the generated file

Everything in `TOP_LEVEL_OPTIONAL_BLOCKS` today renders the same way: a
commented explanation line, then the field commented out. `resolveExternalReferences`
(and `inputRoot`, per §5) need a visually distinct third rendering — active,
not commented, but still explained, so a user does not mistake "we turned
this on for you" for "this is just another suggestion like everything
below it." Sketch:

```yaml
inputs:
  - inputFile: ./users.yaml
  - inputFile: ./orders.yaml
output: ./openapi.json

# Follows $refs into files these inputs don't declare, and files those pull
# in, however many deep -- so a $ref like '../common/Errors.yml#/...' just
# works without listing every file it touches in 'inputs'. Enabled here
# because everything discovered has to live inside inputRoot, below, which
# is set to the same directory init just scanned. Set to false to turn this
# off, or see the README for what it means to widen inputRoot.
resolveExternalReferences: true

# Defence in depth, paired with the setting above: refuses to read any local
# file -- declared or discovered -- from outside this directory. Already
# covers everything init found here; only needs widening if you add an
# inputFile, or a discovered $ref, that reaches outside '.'.
inputRoot: .

# Defence in depth: refuse to write the merged output anywhere outside this directory.
# outputRoot: .
```

This needs a new `OptionalFieldBlock`-like shape (or a boolean flag added to
the existing one, `active: boolean`) distinguishing "commented suggestion"
from "active default, explained" — `renderCommentedBlock` stays as-is for
the commented case; a new `renderActiveBlock` (or a branch inside a shared
renderer) handles the other case. Keep both fields adjacent in the file (as
sketched above), since they are one decision, not two independent ones —
seeing them apart would make the pairing in §5 much harder to notice by
reading the generated file alone.

## 5. Why `resolveExternalReferences` and `inputRoot` are a package, not two separate calls

Turning `resolveExternalReferences` on by default without also bounding it
would reintroduce exactly the risk proposal 37 §9.3 and proposal 38 exist to
close: an unbounded, transitive local-file read surface, now opt-*out*
instead of opt-*in* for anyone who runs `init` and does not read the
generated comments. That is a strictly worse security posture than today's
status quo (field commented out, off), and defaulting it on without
`inputRoot` would not be "convenience" so much as "convenience purchased
with a containment gap this repository just spent two proposals closing."

The fix is available for free, though, precisely because of what `init`
already knows: every input it found came from scanning **the current
directory only** (proposal 33 §3, Option E — recursion was deliberately
rejected). So `inputRoot: .` costs nothing for the case `init` generated —
every declared input and every plausible same-directory discovered file is
already inside `.` — while closing the gap that would otherwise open. This
is the concrete reason §3 recommends `inputRoot` as a default despite it
being a pure restriction with no convenience value on its own: it is not an
independent default decision, it is the specific mitigation this specific
convenience default requires.

**Residual gap this pairing does not close.** `inputRoot` only bounds local
files (proposal 38 §2.1: *"Applies to local files only... a different trust
boundary"*). If a user later adds an `inputURL` entry to a config that
still has `resolveExternalReferences: true`, any `$ref` that document
contains gets followed across the network with no equivalent restriction —
`inputRoot` does not, and per proposal 38's own explicit non-goal (§3), was
never meant to. This is not new risk introduced by defaulting the flag on
(a hand-written config with `resolveExternalReferences: true` and an
`inputURL` input has exactly the same exposure today), but defaulting the
flag on does mean more configs will carry it un-examined. Worth a sentence
in the generated comment (see the §4 sketch — "if you add `inputURL`
entries" is deliberately called out) rather than a technical fix; an actual
network-side containment mechanism is out of scope here the same way it was
out of scope for proposal 38 (§3: *"Worth its own proposal"*).

## 6. What this proposal explicitly does not do

- Does not add interactive prompts asking which defaults to enable —
  proposal 33 §3 Option D already rejected interactivity for `init`, and
  nothing here changes that reasoning (no prompt dependency, still needs to
  work unattended).
- Does not add a flag (`--convenient`, `--minimal`, etc.) to choose between
  default sets. One behaviour, chosen well, beats a second mode nobody
  remembers exists. If usage shows people frequently want the other
  behaviour, that is a proposal of its own.
- Does not change `resolveExternalReferences`'s or `inputRoot`'s default
  *when the field is omitted from a config* — that stays `false` /
  `undefined` at the schema and library level, exactly as issue #10 and
  proposal 38 specified. Only what `init` chooses to *write explicitly*
  changes. This is the distinction that keeps this proposal from being a
  breaking change to anything: no existing config's behaviour moves, because
  no existing config goes through `init` again.
- Does not touch `outputRoot` (§3's table entry) — flagged for a separate
  yes/no from Robert, not decided here.

## 7. Testing plan

- Update `init-command.test.ts`'s two `'field coverage matches data.ts'`
  tests (§2) to include `resolveExternalReferences` and `inputRoot`, and
  attempt the stronger `keyof Configuration`-based check described in §2.2
  so this class of drift cannot recur silently.
- New tests for the "active, not commented" rendering: `resolveExternalReferences: true`
  and `inputRoot: .` both appear uncommented in freshly generated output;
  every other currently-commented field stays commented (regression guard
  against accidentally widening the "on" set).
- Extend the existing init-then-merge round-trip test (proposal 33 §6.2) to
  cover the new defaults specifically: scan a directory containing two specs
  where one `$ref`s into the other via a relative path outside both
  declared `inputs` (the exact shape issue #10 targets), run `init`, then
  run the merge against `init`'s own output with zero edits, and confirm the
  `$ref` actually resolves — proving the default is not just present in the
  file but functionally does something useful out of the box.
- A CLI test confirming `inputRoot: .` from a freshly-generated config does
  not reject any file `init` itself would have scanned (the "costs nothing"
  claim in §5, made concrete rather than asserted).

## 8. Open questions for Robert

1. `outputRoot: .` as a third default (§3, §6) — bundle it into this
   proposal's scope, or leave it as a separate ask?
2. Is the `keyof Configuration`-based exhaustiveness check (§2.2) worth the
   type-level complexity, or is a code comment pointing at
   `TOP_LEVEL_OPTIONAL_BLOCKS` from `data.ts` enough given how rarely
   `Configuration` gains a field?
3. Should the generated comment's residual-gap note (§5) actually name
   `inputURL` specifically, or keep it more general ("if any input is
   remote...") so it doesn't need updating if URL discovery containment
   (proposal 38 §3's stated non-goal) is ever built?
