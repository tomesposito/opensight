/** The JSON Schema vocabulary used by the frozen v1 inputs. */
export interface Schema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  [annotation: string]: unknown;
}
export interface Argument {
  name: string;
  location: 'path' | 'header' | 'body';
  wireName: string;
  required: boolean;
  positional: boolean;
  schema: Schema;
}
export interface Operation {
  operationId: string;
  noun: string;
  command: string;
  method: string;
  path: string;
  arguments: Argument[];
  body?: { input: string; required: boolean; schema: Schema };
}
export type Format = 'json' | 'yaml' | 'table';
