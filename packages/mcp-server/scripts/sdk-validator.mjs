// Select the official SDK's supported MIT provider for its default import too.
// This prevents unused Ajv/fast-uri code entering a stdio-only distributable.
export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
