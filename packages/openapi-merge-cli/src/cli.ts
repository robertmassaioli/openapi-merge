#!/usr/bin/env node
import { main } from '.';

main().catch(e => {
  console.error('An uncaught exception was thrown', e);
});