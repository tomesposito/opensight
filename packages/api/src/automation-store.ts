import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One process owns a store file. Copy-on-write + atomic rename keep failed writes invisible. */
export class AutomationStore<T> {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private state: T, private readonly path?: string) {}
  static async load<T>(initial: T, path?: string, validate?: (value: unknown) => T): Promise<AutomationStore<T>> {
    let state = initial;
    if (path) try {
      const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!validate) throw new Error('A persisted state validator is required');
      state = validate(raw);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Unable to load automation store', { cause: error });
    }
    return new AutomationStore(state, path);
  }
  read(): T { return structuredClone(this.state); }
  change<R>(update: (draft: T) => R): Promise<R> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const result = update(draft);
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          const file = await open(temporary, 'wx', 0o600);
          try { await file.writeFile(JSON.stringify(draft)); await file.sync(); } finally { await file.close(); }
          await rename(temporary, this.path);
        } finally { await rm(temporary, { force: true }); }
      }
      this.state = draft;
      return structuredClone(result);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
