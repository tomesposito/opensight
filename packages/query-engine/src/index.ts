/** Synthetic/provisional local query slice. No AWS, archive or source-compatibility claim. */
export { planVisual } from './planner.js';
export { executeLocal } from './executor.js';
export { executePostgres } from './postgres-executor.js';
export { QueryEngineError } from './validation.js';
export type { ErrorCode } from './validation.js';
export type * from './types.js';

export { interactiveRequest } from './interactive.js';
export type { InteractiveQuery } from './interactive.js';
