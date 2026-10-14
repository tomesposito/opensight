import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface Operation {
  name: string;
  method: string;
  path: string;
  parameters: { input: string; name: string; location: 'path' | 'header' }[];
  bodyInput?: string;
  emptyBody: boolean;
  tool: Tool;
}
export interface Credentials {
  /** An access token for this process's fixed user and tenant, never tool input. */
  accessToken(): Promise<string>;
  /** Reject reflected credentials before returning API data to the MCP client. */
  containsSecret(value: string): boolean;
  invalidate(): void;
}
