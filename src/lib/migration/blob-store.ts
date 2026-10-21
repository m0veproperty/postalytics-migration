import 'server-only';
import { BlobPreconditionFailedError, get, put } from '@vercel/blob';
import { ConditionalWriteConflict, WorkspaceError } from './errors.ts';
import type { AtomicDocumentStore } from './atomic-store.ts';
import { LocalDocumentStore, localStoreDirectory } from './local-store.ts';

export function storageConfigured(): boolean {
  return Boolean(localStoreDirectory() || process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function blobCredentials(): { token: string } | { storeId: string | undefined } {
  // Explicit tokens take priority in the SDK, including when the project also has OIDC.
  return process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : { storeId: process.env.BLOB_STORE_ID };
}

class VercelBlobDocumentStore implements AtomicDocumentStore {
  async read(path: string): Promise<{ value: unknown; etag: string } | null> {
    const result = await get(path, { access: 'private', useCache: false, ...blobCredentials() });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new WorkspaceError(503, 'STORAGE_UNAVAILABLE', 'Shared records could not be read. Please try again.');
    // Uncached private reads ensure the conditional write uses the newest version.
    const value: unknown = await new Response(result.stream).json();
    return { value, etag: result.blob.etag };
  }

  async write(path: string, value: unknown, expectedEtag: string | null): Promise<void> {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body, 'utf8') > 32 * 1024 * 1024) throw new WorkspaceError(503, 'AUDIT_CAPACITY', 'The shared audit archive needs maintenance. Existing records remain available.');
    try {
      await put(path, body, {
        ...blobCredentials(),
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        allowOverwrite: expectedEtag !== null,
        ...(expectedEtag !== null ? { ifMatch: expectedEtag } : {}),
        cacheControlMaxAge: 60,
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new ConditionalWriteConflict();
      // On competing initial creates, allowOverwrite:false fails safely. Re-read to
      // distinguish that race from a genuine storage failure without guessing SDK error text.
      if (expectedEtag === null && await this.read(path)) throw new ConditionalWriteConflict();
      throw error;
    }
  }
}

export function getStore(): AtomicDocumentStore {
  const directory = localStoreDirectory();
  if (directory) return new LocalDocumentStore(directory);
  if (!storageConfigured()) throw new WorkspaceError(503, 'STORAGE_NOT_CONFIGURED', 'Shared editing is not configured yet.');
  return new VercelBlobDocumentStore();
}
