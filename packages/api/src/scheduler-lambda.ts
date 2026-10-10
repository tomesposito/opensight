import { createPrivateRuntime } from './runtime-private.js';
export const handler = createPrivateRuntime().scheduler;
