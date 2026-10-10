import { createRuntime } from './runtime.js';
export { authorizeIngress as authorizer } from './runtime-ingress.js';
/** Importing this module constructs no sockets, pools, workers or timers. */
export const handler = createRuntime().lambda;
