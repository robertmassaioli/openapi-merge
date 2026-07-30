#!/usr/bin/env bash
# Verifies the PUBLISHED artifacts, under the runtimes consumers actually use.
#
# This is the job described in ai-planning/29-proposal-node-runtime-verification.md,
# reduced to a single runtime-agnostic pass by the bundling in proposal 30.
#
# Why it exists: `bun run test` imports `src/` under Bun. Neither the shipped
# `dist/` nor the tarball that npm would publish was ever executed by anything,
# so `commander@15` (ESM, requiring Node >= 22.12) shipped inside a CommonJS
# build declaring `engines: node >= 18` and broke every invocation on Node 18
# and 20 with ERR_REQUIRE_ESM. Nothing in CI noticed.
#
# So: `npm pack` both packages, install the tarballs with **npm** into a clean
# directory outside the workspace, and drive the installed binary. Installing
# with npm rather than bun matters -- the consumer's resolver is part of what is
# under test.
#
# Usage:
#   ./scripts/verify-node-runtime.sh              # verify with `node` and `bun`
#   RUNTIMES="/path/to/node bun" ./scripts/...    # verify with specific binaries
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

RUNTIMES="${RUNTIMES:-node bun}"

# Results are appended to files rather than kept in shell variables.
#
# They were variables at first, and the scenarios ran inside `( cd ... && ... )`.
# Increments inside a subshell are discarded when it exits, so the summary
# reported "0 failed" on a run where six checks had just printed FAIL -- and the
# `exit` status agreed with the summary. A verification script that cannot fail
# is worse than no verification script.
RESULTS_PASS="$WORK_DIR/results.pass"
RESULTS_FAIL="$WORK_DIR/results.fail"
: > "$RESULTS_PASS"
: > "$RESULTS_FAIL"

pass() { printf '    \033[32mPASS\033[0m  %s\n' "$1"; echo "$1" >> "$RESULTS_PASS"; }
fail() { printf '    \033[31mFAIL\033[0m  %s\n' "$1"; echo "$1" >> "$RESULTS_FAIL"; }

# check <description> <expected-exit> <command...>
#
# Exit status is asserted explicitly rather than with `if cmd; then`, because
# several of these cases are *supposed* to fail and the specific code is the
# documented contract (see src/exit-codes.ts).
check() {
  local description="$1" expected="$2"; shift 2
  local actual=0
  "$@" > "$WORK_DIR/stdout.txt" 2> "$WORK_DIR/stderr.txt" || actual=$?
  if [ "$actual" = "$expected" ]; then
    pass "$description"
  else
    fail "$description (expected exit $expected, got $actual)"
    sed 's/^/          /' "$WORK_DIR/stderr.txt" | head -5
  fi
}

# All of the CLI's diagnostics go to stderr via console.error, so assertions
# about error text must read stderr. Only `--version` and `--help` write to
# stdout. Getting this wrong makes an assertion that can never pass.
check_output_contains() {
  local description="$1" needle="$2" file="$3"
  if grep -q -- "$needle" "$file" 2>/dev/null; then
    pass "$description"
  else
    fail "$description (expected '$needle' in $file)"
  fi
}

echo "==> Building"
(cd "$REPO_ROOT" && bun run build > /dev/null)

echo "==> Packing both packages with npm"
# npm pack, not `bun pm pack`: the tarball npm builds is the one npm publishes,
# and the `files` field has bitten this project before.
(cd "$REPO_ROOT/packages/openapi-merge" && npm pack --pack-destination "$WORK_DIR" --silent > /dev/null)
(cd "$REPO_ROOT/packages/openapi-merge-cli" && npm pack --pack-destination "$WORK_DIR" --silent > /dev/null)

CONSUMER="$WORK_DIR/consumer"
mkdir -p "$CONSUMER"
echo '{ "name": "consumer", "version": "1.0.0", "private": true }' > "$CONSUMER/package.json"

echo "==> Installing the tarballs with npm (not bun)"
(cd "$CONSUMER" && npm install --silent "$WORK_DIR"/openapi-merge-*.tgz > /dev/null 2>&1)

CLI_BIN="$CONSUMER/node_modules/.bin/openapi-merge-cli"
CLI_DIST="$CONSUMER/node_modules/openapi-merge-cli/dist"

echo
echo "==> Tarball contents"
# The bundle step overwrites the tsgo-emitted dist/index.js. Anything that runs
# tsgo afterwards silently restores the unbundled version, which works on a
# modern Node and fails on 18 -- the exact bug this whole exercise exists for.
# These two assertions are the guard against that regression reaching a publish.
if grep -q 'require("commander")' "$CLI_DIST/index.js"; then
  fail "dist/index.js is NOT bundled -- it still require()s commander"
else
  pass "dist/index.js is bundled (no runtime require of commander)"
fi
check_output_contains "dist/index.js contains inlined dependency code" "commander" "$CLI_DIST/index.js"
[ -f "$CLI_DIST/THIRD-PARTY-NOTICES.txt" ] \
  && pass "THIRD-PARTY-NOTICES.txt is in the tarball" \
  || fail "THIRD-PARTY-NOTICES.txt is missing from the tarball"
[ -f "$CLI_DIST/configuration.schema.json" ] \
  && pass "configuration.schema.json is in the tarball" \
  || fail "configuration.schema.json is missing from the tarball"

# ---------------------------------------------------------------------------
# Fixtures. Written once, reused by every runtime.
# ---------------------------------------------------------------------------
FIXTURES="$WORK_DIR/fixtures"
mkdir -p "$FIXTURES"

cat > "$FIXTURES/a.yml" <<'YAML'
openapi: 3.0.3
info:
  title: A
  version: '1'
paths:
  /a:
    get:
      responses:
        '200':
          description: ok
YAML

cat > "$FIXTURES/b.json" <<'JSON'
{
  "openapi": "3.0.3",
  "info": { "title": "B", "version": "1" },
  "paths": { "/b": { "get": { "responses": { "200": { "description": "ok" } } } } }
}
JSON

cat > "$FIXTURES/bad-version.yml" <<'YAML'
openapi: 3.9.9
info:
  title: Future
  version: '1'
paths: {}
YAML

# --- ajv scenarios ---------------------------------------------------------
# The bundle leaves four dynamic require()s from ajv's standalone codegen that
# the bundler could not resolve statically (proposal 30 §4.3). If any of them
# were on a live path, these are the cases that would surface it as
# MODULE_NOT_FOUND -- in a consumer's directory rather than in CI.

# format: "uri" is the one that forces ajv-formats' format machinery to load.
cat > "$FIXTURES/config-url.json" <<'JSON'
{
  "inputs": [{ "inputURL": "https://example.com/openapi.json" }],
  "output": "./out-url.yml"
}
JSON

cat > "$FIXTURES/config-yaml-out.json" <<'JSON'
{
  "inputs": [{ "inputFile": "./a.yml" }, { "inputFile": "./b.json" }],
  "output": "./out.yml"
}
JSON

cat > "$FIXTURES/config-json-out.json" <<'JSON'
{
  "inputs": [{ "inputFile": "./a.yml" }, { "inputFile": "./b.json" }],
  "output": "./out.json",
  "formatting": { "indent": { "style": "spaces", "width": 4 } }
}
JSON

# The config file itself in YAML, not JSON: routes through readYamlOrJSON into
# ajv, so js-yaml and ajv are exercised in a single path.
cat > "$FIXTURES/config.yml" <<'YAML'
inputs:
  - inputFile: ./a.yml
output: ./out-from-yaml.json
YAML

cat > "$FIXTURES/config-missing-required.json" <<'JSON'
{ "inputs": [{ "inputFile": "./a.yml" }] }
JSON

cat > "$FIXTURES/config-wrong-type.json" <<'JSON'
{ "inputs": "not-an-array", "output": "./out.yml" }
JSON

# The generated schema is produced with --noExtraProps.
cat > "$FIXTURES/config-extra-prop.json" <<'JSON'
{ "inputs": [{ "inputFile": "./a.yml" }], "output": "./out.yml", "notARealOption": true }
JSON

cat > "$FIXTURES/config-malformed.json" <<'JSON'
{ "inputs": [ this is not valid json
JSON

# Tabs + .yaml is rejected after ajv, by validateConfigurationSemantics --
# proves post-validation code is reachable from the bundle (issue #114).
cat > "$FIXTURES/config-tabs-yaml.json" <<'JSON'
{
  "inputs": [{ "inputFile": "./a.yml" }],
  "output": "./out-tabs.yaml",
  "formatting": { "indent": { "style": "tabs" } }
}
JSON

cat > "$FIXTURES/config-bad-version.json" <<'JSON'
{ "inputs": [{ "inputFile": "./bad-version.yml" }], "output": "./out-bad.yml" }
JSON

# ---------------------------------------------------------------------------
# The scenarios, run once per runtime.
# ---------------------------------------------------------------------------
run_scenarios() {
  local runtime="$1" version
  version="$("$runtime" --version 2>/dev/null || echo '?')"
  echo
  echo "==> $runtime ($version)"

  # A fresh working directory per runtime so outputs cannot be mistaken for
  # each other, and a missing output is a genuine failure rather than a
  # leftover from the previous pass.
  local dir="$WORK_DIR/run-$(basename "$runtime")-$$-$RANDOM"
  mkdir -p "$dir"
  cp "$FIXTURES"/* "$dir/"

  local run=("$runtime" "$CLI_DIST/cli.js")

  # -- the binary starts at all ---------------------------------------------
  check "--version starts (shebang, inlined package.json, commander)" 0 \
    "${run[@]}" --version
  check_output_contains "--version reports a version" "." "$WORK_DIR/stdout.txt"

  check "--help renders" 0 "${run[@]}" --help

  # -- the whole main() path, both output formats ---------------------------
  check "YAML + JSON in -> YAML out (js-yaml load AND dump)" 0 \
    "${run[@]}" --config "$dir/config-yaml-out.json"
  check_output_contains "merged YAML contains both inputs" "/b:" "$dir/out.yml"

  check "YAML + JSON in -> JSON out" 0 \
    "${run[@]}" --config "$dir/config-json-out.json"
  check_output_contains "merged JSON contains both inputs" '"/b"' "$dir/out.json"

  check "config file supplied as YAML (js-yaml -> ajv in one path)" 0 \
    "${run[@]}" --config "$dir/config.yml"
  check_output_contains "YAML-config run produced output" '"/a"' "$dir/out-from-yaml.json"

  # -- ajv ------------------------------------------------------------------
  # inputURL exercises format:"uri" and then fails at fetch time, not at
  # validation time. Exit 5 (ErrorLoadingInput) therefore means ajv-formats
  # loaded and ACCEPTED the config, which is the assertion that matters here.
  # example.com answers 404, so this exits 6 (ErrorInputUrlClientStatus) rather
  # than 5. That is a stronger assertion than intended: ajv-formats accepted the
  # uri, the fetch happened, and the 4xx-specific exit code survived bundling.
  check "ajv: format:\"uri\" accepted; 404 then maps to exit 6 (4xx)" 6 \
    "${run[@]}" --config "$dir/config-url.json"
  if grep -qi 'must match format\|unknown format' "$WORK_DIR/stderr.txt" "$WORK_DIR/stdout.txt" 2>/dev/null; then
    fail "ajv rejected a valid uri -- ajv-formats did not load"
  else
    pass "ajv: no format error for a valid uri"
  fi

  check "ajv: missing required property rejected" 1 \
    "${run[@]}" --config "$dir/config-missing-required.json"
  check_output_contains "ajv named the missing property" "output" "$WORK_DIR/stderr.txt"

  check "ajv: wrong type rejected" 1 \
    "${run[@]}" --config "$dir/config-wrong-type.json"

  check "ajv: additional property rejected (noExtraProps)" 1 \
    "${run[@]}" --config "$dir/config-extra-prop.json"

  check "malformed config file rejected" 1 \
    "${run[@]}" --config "$dir/config-malformed.json"

  check "missing config file rejected" 1 \
    "${run[@]}" --config "$dir/does-not-exist.json"

  check "post-ajv semantic check reachable (tabs + .yaml, issue #114)" 1 \
    "${run[@]}" --config "$dir/config-tabs-yaml.json"
  check_output_contains "semantic check gave the actionable message" "Tab indentation" "$WORK_DIR/stderr.txt"

  # -- the library, reached through the bundle -------------------------------
  check "unsupported OpenAPI version -> exit 9 (bundled library is live)" 9 \
    "${run[@]}" --config "$dir/config-bad-version.json"

  # -- the library as a direct consumer would use it -------------------------
  # openapi-merge is published separately; someone may require() it from a plain
  # Node project without ever touching the CLI. Nothing else covers that.
  check "require('openapi-merge').merge() works for a plain consumer" 0 \
    "$runtime" -e "
      const m = require('openapi-merge');
      const r = m.merge([{ oas: { openapi: '3.0.3', info: { title: 'A', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } } } }]);
      if (m.isErrorResult(r)) { console.error(r.message); process.exit(1); }
      if (!r.output.paths['/a']) { console.error('missing path'); process.exit(1); }
    "

  # The CLI package declares main: dist/index, so it is importable too.
  check "require('openapi-merge-cli') exposes its declared exports" 0 \
    "$runtime" -e "
      const m = require('openapi-merge-cli');
      for (const name of ['main', 'ExitCode', 'InputUrlStatusError']) {
        if (m[name] === undefined) { console.error('missing export: ' + name); process.exit(1); }
      }
      if (m.ExitCode.ErrorOpenApiVersion !== 9) { console.error('ExitCode wrong'); process.exit(1); }
    "
}

# `cd` into the consumer, once and not in a subshell, so `require('openapi-merge')`
# resolves from its node_modules rather than from the workspace. Every fixture
# path used below is absolute, so this does not affect anything else.
cd "$CONSUMER"

for runtime in $RUNTIMES; do
  if ! command -v "$runtime" > /dev/null 2>&1 && [ ! -x "$runtime" ]; then
    echo
    echo "==> $runtime: NOT FOUND, skipping"
    continue
  fi
  run_scenarios "$runtime"
done

pass_count=$(wc -l < "$RESULTS_PASS" | tr -d ' ')
fail_count=$(wc -l < "$RESULTS_FAIL" | tr -d ' ')

echo
echo "============================================================"
printf '  %s passed, %s failed\n' "$pass_count" "$fail_count"
if [ "$fail_count" -ne 0 ]; then
  echo "  failed:"
  sed 's/^/    - /' "$RESULTS_FAIL"
fi
echo "============================================================"

[ "$fail_count" -eq 0 ]
