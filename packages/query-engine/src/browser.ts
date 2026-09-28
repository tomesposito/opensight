/** Pure planner/evaluator: no database drivers, files, network, or dynamic code execution. */
export { planVisual } from './planner.js';
export { interactiveRequest } from './interactive.js';
export type { InteractiveQuery } from './interactive.js';
export { evaluatePlan } from './evaluate.js';

export { parseExpression, expressionSql, unsupportedFunctions } from './expressions.js';
export { evaluateExpression } from './evaluate-expression.js';
export { functionCatalog } from './catalog.js';

export { ROLES, isRole, hasCapability } from './roles.js';
export type { Role, Capability } from './roles.js';
