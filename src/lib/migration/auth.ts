import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SessionInfo } from './types.ts';
import { WorkspaceError } from './errors.ts';

export interface AuthConfig { password: string; secret: string; secure: boolean }
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const READ_ONLY_SESSION: SessionInfo = { canEdit: false, name: null, expiresAt: null };

export function authConfig(): AuthConfig | null {
  const password = process.env.MIGRATION_EDIT_PASSWORD;
  const secret = process.env.MIGRATION_SESSION_SECRET;
  if (!password || password.length < 16 || !secret || secret.length < 32) return null;
  return { password, secret, secure: process.env.NODE_ENV === 'production' };
}

export function passwordMatches(provided: string, expected: string): boolean {
  // Equal-size digests avoid exposing the configured password length.
  return timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(expected).digest());
}

function signature(payload: string, config: AuthConfig): string {
  // Password rotation also revokes existing sessions.
  const key = createHmac('sha256', config.secret).update(`session-key:${config.password}`).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createSession(name: string, config: AuthConfig, now = Date.now()): { token: string; session: SessionInfo } {
  const iat = Math.floor(now / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const encoded = Buffer.from(JSON.stringify({ v: 1, name, iat, exp })).toString('base64url');
  return { token: `${encoded}.${signature(encoded, config)}`, session: { canEdit: true, name, expiresAt: new Date(exp * 1000).toISOString() } };
}

export function verifySession(token: string | undefined, config: AuthConfig | null, now = Date.now()): SessionInfo {
  if (!token || !config || token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return READ_ONLY_SESSION;
  const [payload, suppliedSignature] = token.split('.');
  const expected = Buffer.from(signature(payload, config));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return READ_ONLY_SESSION;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    if (data.v !== 1 || typeof data.name !== 'string' || data.name.length < 2 || data.name.length > 100 || !Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) || data.exp <= seconds || data.iat > seconds + 60 || data.exp - data.iat !== SESSION_TTL_SECONDS) return READ_ONLY_SESSION;
    return { canEdit: true, name: data.name, expiresAt: new Date(data.exp * 1000).toISOString() };
  } catch { return READ_ONLY_SESSION; }
}

export function cookieName(secure: boolean): string {
  return secure ? '__Host-postalytics-edit' : 'postalytics-edit';
}

export function sessionCookie(token: string, config: Pick<AuthConfig, 'secure'>, clear = false): string {
  return `${cookieName(config.secure)}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_TTL_SECONDS}${config.secure ? '; Secure' : ''}`;
}

export function requestSession(request: Request, config: AuthConfig | null = authConfig()): SessionInfo {
  const name = cookieName(config?.secure ?? process.env.NODE_ENV === 'production');
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return verifySession(cookie?.slice(name.length + 1), config);
}

export function requireEditor(request: Request): SessionInfo & { name: string } {
  const session = requestSession(request);
  if (!session.canEdit || !session.name) throw new WorkspaceError(401, 'EDIT_SESSION_REQUIRED', 'Sign in to open the workspace.');
  return session as SessionInfo & { name: string };
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!origin || (site && !['same-origin', 'none'].includes(site))) throw new WorkspaceError(403, 'ORIGIN_REJECTED', 'Open the workspace directly before making changes.');
  const reject = (): never => { throw new WorkspaceError(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.'); };
  const requestUrl = new URL(request.url);
  // Next dev may put its bind address (0.0.0.0) in request.url. Host retains the
  // authority requested by the browser. Never authorize a forwarded-host header.
  const host = request.headers.get('host') ?? requestUrl.host;
  if (!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:.]+\])(?::\d{1,5})?$/.test(host)) reject();
  const onVercel = process.env.VERCEL === '1' && ['production', 'preview'].includes(process.env.VERCEL_ENV ?? '');
  // Deployed Vercel requests arrive over HTTPS even if the internal URL reflects
  // its proxy connection. Local development uses its actual request protocol.
  // Client-supplied forwarded-proto headers never change this decision.
  const protocol = onVercel ? 'https:' : requestUrl.protocol;
  if (!['http:', 'https:'].includes(protocol)) reject();
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(`${protocol}//${host}`);
    actual = new URL(origin);
  } catch { return reject(); }
  if (!expected.hostname || actual.username || actual.password || actual.pathname !== '/' || actual.search || actual.hash || actual.origin !== expected.origin) reject();
}
