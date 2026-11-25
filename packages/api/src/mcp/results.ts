export const mcpResultBytes = 1024 * 1024;
export const mcpResultSizeError = {
  errorCode: 'MCP_RESULT_TOO_LARGE',
  message: 'MCP supports inline results up to 1 MiB (1048576 bytes). Narrow the query or reduce its result size; chunk retrieval is not supported.'
} as const;

/** Hosted result operations contain chunk metadata, never usable tool data. */
export function isResultDescriptor(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('operation' in value)) return false;
  const operation = value.operation;
  return !!operation && typeof operation === 'object' && 'kind' in operation && operation.kind === 'result';
}
