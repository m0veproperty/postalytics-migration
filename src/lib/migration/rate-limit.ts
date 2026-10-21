import { createHmac } from 'node:crypto';
import { updateDocument } from './atomic-store.ts';
import type { AtomicDocumentStore } from './atomic-store.ts';
import { WorkspaceError } from './errors.ts';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/** A durable per-IP login limit shared across Vercel function instances. */
export async function consumeLoginAttempt(store: AtomicDocumentStore, ip: string, secret: string, now = Date.now()): Promise<void> {
  const anonymousKey = createHmac('sha256', secret).update(`login-ip:${ip}`).digest('hex');
  const path = `postalytics-migration/login-limits/${anonymousKey}.json`;
  await updateDocument(store, path, (previous) => {
    const record = previous as { startedAt?: number; count?: number } | null;
    const sameWindow = typeof record?.startedAt === 'number' && record.startedAt <= now && now - record.startedAt < WINDOW_MS;
    const count = sameWindow && Number.isSafeInteger(record?.count) ? record!.count! : 0;
    if (count >= MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record!.startedAt! + WINDOW_MS - now) / 1000));
      throw new WorkspaceError(429, 'LOGIN_RATE_LIMIT', 'Too many edit sign-in attempts. Please wait before trying again.', { retryAfterSeconds });
    }
    return { startedAt: sameWindow ? record!.startedAt : now, count: count + 1 };
  });
}

export function requestIp(request: Request): string {
  // Vercel's edge sets this header. With no proxy header, all local requests share a bucket.
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 120) || 'local';
}
