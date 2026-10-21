import { WorkspaceError } from './errors.ts';

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
};

export function jsonResponse(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { ...responseHeaders, ...extraHeaders } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof WorkspaceError) {
    const retry = error.code === 'LOGIN_RATE_LIMIT' && error.details && typeof error.details === 'object' ? (error.details as { retryAfterSeconds?: number }).retryAfterSeconds : undefined;
    return jsonResponse({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status, retry ? { 'Retry-After': String(retry) } : {});
  }
  // Never serialize SDK errors, credentials, cookies, or request bodies to the client/log.
  console.error('Migration workspace request failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  return jsonResponse({ error: { code: 'STORAGE_UNAVAILABLE', message: 'The shared workspace is temporarily unavailable. Your change was not confirmed. Refresh before trying again.' } }, 503);
}

export async function readBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) throw new WorkspaceError(413, 'REQUEST_TOO_LARGE', 'This update is too large. Please shorten the note or action.');
  if (!request.body) throw new WorkspaceError(400, 'INVALID_JSON', 'The request body is missing.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new WorkspaceError(413, 'REQUEST_TOO_LARGE', 'This update is too large. Please shorten the note or action.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request: Request, maxBytes = 24_000): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new WorkspaceError(415, 'JSON_REQUIRED', 'Send this request as JSON.');
  const body = await readBody(request, maxBytes);
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new WorkspaceError(400, 'INVALID_JSON', 'The request body is not valid JSON.'); }
}
