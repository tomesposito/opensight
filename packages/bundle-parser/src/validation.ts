export type ObjectValue = Record<string, unknown>;
export type Validator = (value: unknown, path: string) => void;

export class ValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
  }
}

export function fail(path: string, message: string): never {
  throw new ValidationError(path, message);
}

export function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as ObjectValue;
}

export const string: Validator = (value, path) => {
  if (typeof value !== 'string') fail(path, 'expected a string');
};
export const nonempty: Validator = (value, path) => {
  string(value, path);
  if (value === '') fail(path, 'expected a nonempty string');
};
export const enumeration = (...allowed: string[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(path, `expected one of ${allowed.join(', ')}`);
  }
};
export const array = (item: Validator): Validator => (value, path) => {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  for (let index = 0; index < value.length; index++) item(value[index], `${path}[${index}]`);
};
export function optional(value: ObjectValue, key: string, path: string, validate: Validator): void {
  if (Object.hasOwn(value, key)) validate(value[key], `${path}.${key}`);
}
export function required(value: ObjectValue, key: string, path: string, validate: Validator): void {
  validate(value[key], `${path}.${key}`);
}

/** Used both during validation and resolution; no unchecked key/body indexing. */
export function singleVariant(value: unknown, path: string): [string, ObjectValue] {
  const entries = Object.entries(object(value, path));
  const entry = entries[0];
  if (entries.length !== 1 || !entry) fail(path, 'expected exactly one variant');
  const [kind, body] = entry;
  return [kind, object(body, `${path}.${kind}`)];
}
