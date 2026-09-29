/** Synthetic/provisional local query slice. No AWS, archive or source-compatibility claim. */
export { planVisual } from './planner.js';
export { executeLocal, refreshLocal } from './executor.js';
export { executePostgres } from './postgres-executor.js';
export { QueryEngineError } from './validation.js';
export type { ErrorCode } from './validation.js';
export type * from './types.js';

export { interactiveRequest } from './interactive.js';
export type { InteractiveQuery } from './interactive.js';

export { parseExpression, expressionSql, unsupportedFunctions } from './expressions.js';
export { evaluateExpression } from './evaluate-expression.js';
export { functionCatalog } from './catalog.js';

export { validateRowRule, validateColumnGrant, validatePolicy } from './security.js';
export type * from './security.js';
export { bindMetadata } from './metadata.js';

export { ROLES, isRole, hasCapability } from './roles.js';
export type { Role, Capability } from './roles.js';

export { resolveSecurity } from './security.js';
export { ExpressionBinder } from './expressions.js';

export { connectors, connectorDefinition, validateConnectorConfig, connectorState, connectConnector, connectorDialect, ConnectorError } from './connectors.js';
export type { ConnectorDefinition, ConnectorConfig, ConnectorField, ConnectorState } from './connectors.js';
export { parseUpload, UploadStaging, UploadError } from './upload.js';
export type { UploadColumn, UploadRequest, UploadSummary, UploadType } from './upload.js';
export { executeMySql, executeConnector } from './mysql-executor.js';
export type { MySqlExecuteOptions } from './mysql-executor.js';

export { compilePrep, prepSource, prepColumns } from './prep.js';
export type { PrepSource, PrepPlan } from './prep.js';

export { previewPrepDuckDb, previewPrepPostgres, prepPreviewResult } from './prep-executor.js';
export type { PrepPreview, PrepPreviewOptions } from './prep-executor.js';
