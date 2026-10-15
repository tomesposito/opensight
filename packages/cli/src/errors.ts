export class CliError extends Error {
  constructor(readonly errorCode: string, message: string) { super(message); }
}
export function invalid(message: string): never { throw new CliError('CLI_ARGUMENT_INVALID', message); }
export const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
