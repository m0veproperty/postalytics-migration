import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { get, put } from '@vercel/blob';
import { blobCredentials, storageConfigured } from './blob-store.ts';
import { contentName, contentType, assertManifestAsset, validateSourceJson } from './content-validation.ts';
import { localStoreDirectory } from './local-store.ts';
import { WorkspaceError } from './errors.ts';

const PREFIX = 'postalytics-migration/content/';
export interface PrivateContent { stream: ReadableStream<Uint8Array>; size: number | null; etag: string }

export async function readPrivateContent(name: string): Promise<PrivateContent | null> {
  contentName(name);
  const directory = localStoreDirectory();
  if (directory) {
    try {
      const body = await readFile(resolve(directory, PREFIX, name));
      return { stream: new Response(new Uint8Array(body)).body!, size: body.length, etag: createHash('sha256').update(body).digest('hex') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  if (!storageConfigured()) throw new WorkspaceError(503, 'STORAGE_NOT_CONFIGURED', 'Private source storage is not configured.');
  const file = await get(`${PREFIX}${name}`, { access: 'private', useCache: false, ...blobCredentials() });
  if (!file) return null;
  if (file.statusCode !== 200 || !file.stream) throw new WorkspaceError(503, 'STORAGE_UNAVAILABLE', 'This source file could not be read.');
  return { stream: file.stream, size: file.blob.size, etag: file.blob.etag };
}

export async function readPrivateJson(name: 'project.json' | 'decisions.json'): Promise<unknown> {
  const file = await readPrivateContent(name);
  if (!file) throw new WorkspaceError(503, 'SOURCE_NOT_READY', 'The source workspace is being prepared. Please try again shortly.');
  return new Response(file.stream).json();
}

export async function readAsset(name: string): Promise<PrivateContent> {
  contentName(name);
  await assertAssetAllowed(name);
  const file = await readPrivateContent(name);
  if (!file) throw new WorkspaceError(404, 'ASSET_NOT_READY', 'This file has not been added to private source storage yet.');
  return file;
}

async function assertAssetAllowed(name: string): Promise<void> {
  if (/\.json$/.test(name)) throw new WorkspaceError(404, 'UNKNOWN_ASSET', 'This source is not an asset download.');
  assertManifestAsset(await readPrivateJson('project.json'), name);
}

function digest(body: Uint8Array): string { return createHash('sha256').update(body).digest('hex'); }

async function existingMatches(name: string, expectedHash: string): Promise<boolean> {
  const existing = await readPrivateContent(name);
  if (!existing) return false;
  const hash = digest(new Uint8Array(await new Response(existing.stream).arrayBuffer()));
  if (hash !== expectedHash) throw new WorkspaceError(409, 'IMMUTABLE_SOURCE_EXISTS', 'A different source file already exists under this name. Existing evidence cannot be overwritten through this endpoint.');
  return true;
}

export async function uploadPrivateContent(name: string, body: Buffer): Promise<{ name: string; bytes: number; sha256: string; alreadyExists: boolean }> {
  contentName(name);
  if (name.endsWith('.json')) validateSourceJson(name, body);
  else await assertAssetAllowed(name);
  const sha256 = digest(body);
  if (await existingMatches(name, sha256)) return { name, bytes: body.length, sha256, alreadyExists: true };
  const directory = localStoreDirectory();
  if (directory) {
    const filename = resolve(directory, PREFIX, name);
    await mkdir(dirname(filename), { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(body); } finally { await handle.close(); }
    let lock;
    try { lock = await open(`${filename}.lock`, 'wx', 0o600); }
    catch { await unlink(temporary); throw new WorkspaceError(409, 'WRITE_CONTENTION', 'Another source upload is in progress. Retry this upload.'); }
    try {
      if (await existingMatches(name, sha256)) return { name, bytes: body.length, sha256, alreadyExists: true };
      await rename(temporary, filename);
    } finally {
      await lock.close();
      await unlink(`${filename}.lock`).catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  } else {
    try {
      await put(`${PREFIX}${name}`, body, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: contentType(name), cacheControlMaxAge: 60, ...blobCredentials() });
    } catch (error) {
      if (await existingMatches(name, sha256)) return { name, bytes: body.length, sha256, alreadyExists: true };
      throw error;
    }
  }
  return { name, bytes: body.length, sha256, alreadyExists: false };
}
