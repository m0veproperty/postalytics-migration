import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { AtomicDocumentStore } from './atomic-store.ts';
import { ConditionalWriteConflict, WorkspaceError } from './errors.ts';

/** Explicit local QA adapter. This is never selected in production. */
export class LocalDocumentStore implements AtomicDocumentStore {
  directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  private filename(path: string): string {
    const filename = resolve(this.directory, path);
    if (!filename.startsWith(`${this.directory}${sep}`)) throw new Error('Invalid local storage path.');
    return filename;
  }

  async read(path: string): Promise<{ value: unknown; etag: string } | null> {
    try {
      const body = await readFile(this.filename(path), 'utf8');
      return { value: JSON.parse(body), etag: createHash('sha256').update(body).digest('hex') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(path: string, value: unknown, expectedEtag: string | null): Promise<void> {
    const filename = this.filename(path);
    await mkdir(dirname(filename), { recursive: true });
    let lock;
    try { lock = await open(`${filename}.lock`, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ConditionalWriteConflict();
      throw error;
    }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const current = await this.read(path);
      if ((current?.etag ?? null) !== expectedEtag) throw new ConditionalWriteConflict();
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(value), 'utf8'); } finally { await handle.close(); }
      await rename(temporary, filename);
    } finally {
      await lock.close();
      await unlink(`${filename}.lock`).catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export function localStoreDirectory(): string | null {
  const directory = process.env.MIGRATION_LOCAL_STORE_DIR;
  if (!directory) return null;
  if (process.env.NODE_ENV === 'production') throw new WorkspaceError(503, 'LOCAL_STORE_DISABLED', 'Local test storage cannot be used in production.');
  return directory;
}
