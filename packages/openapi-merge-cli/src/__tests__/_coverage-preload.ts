// Loaded via `preload` in bunfig.toml so that every CLI source module appears in
// the coverage report, including modules no test imports yet. Bun's coverage is
// runtime-instrumented: a module that is never imported contributes nothing to
// the report -- not even a 0% row -- so without this file the reported
// percentage is computed over an accidental subset of the source and can be
// *improved* by deleting a test.
//
// Add a line here whenever a new source file is added to src/.
//
// Deliberately NOT imported -- both execute real work at module scope:
//   - cli.ts        -- calls main() at module scope; importing it runs the CLI
//                      inside the test process and installs process handlers.
//   - fix-schema.ts -- a build script with no exports; its module body reads,
//                      mutates and WRITES src/configuration.schema.json.
//
// Those two are unmeasurable by a runtime-instrumented profiler, not
// intrinsically unmeasurable. See ai-planning/21-proposal-code-coverage.md §3.2.
import '../index';
import '../exit-codes';
import '../examples-for-schema';
import '../file-loading';
import '../data';
