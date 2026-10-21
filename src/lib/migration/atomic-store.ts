import { ConditionalWriteConflict, WorkspaceError } from './errors.ts';

export interface AtomicDocumentStore {
  read(path: string): Promise<{ value: unknown; etag: string } | null>;
  /** null creates only if absent; a string replaces only if that ETag still matches. */
  write(path: string, value: unknown, expectedEtag: string | null): Promise<void>;
}

export async function updateDocument<T>(
  store: AtomicDocumentStore,
  path: string,
  update: (previous: unknown | null) => T,
  attempts = 6,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const previous = await store.read(path);
    const next = update(previous?.value ?? null);
    try {
      await store.write(path, next, previous?.etag ?? null);
      return next;
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflict)) throw error;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 40));
    }
  }
  throw new WorkspaceError(409, 'WRITE_CONTENTION', 'The workspace is receiving another update. Please try saving again.');
}
