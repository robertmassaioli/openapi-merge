#!/usr/bin/env node
import { main } from '.';
import { ExitCode } from './exit-codes';

main().catch(e => {
  console.error('An uncaught exception was thrown', e);
  process.exit(ExitCode.ErrorUncaught);
});

// Defensive global handlers: anything that escapes the async `.catch` above
// (for example synchronous throws inside top-level code paths) still produces
// a non-zero exit so CI pipelines correctly surface the failure.
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  process.exit(ExitCode.ErrorUncaught);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(ExitCode.ErrorUncaught);
});