import { assertSameOrigin, authConfig, createSession, pinMatches, READ_ONLY_SESSION, requestSession, sessionCookie } from '@/lib/migration/auth';
import { getStore, storageConfigured } from '@/lib/migration/blob-store';
import { WorkspaceError } from '@/lib/migration/errors';
import { errorResponse, jsonResponse, readJson } from '@/lib/migration/http';
import { consumeLoginAttempt, requestIp } from '@/lib/migration/rate-limit';
import { validateLogin } from '@/lib/migration/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return jsonResponse({ session: requestSession(request) });
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const config = authConfig();
    if (!config || !storageConfigured()) throw new WorkspaceError(503, 'EDITING_NOT_CONFIGURED', 'Shared editing has not been configured yet.');
    const login = validateLogin(await readJson(request, 3000));
    await consumeLoginAttempt(getStore(), requestIp(request), config.secret);
    if (!pinMatches(login.pin, config.pin)) throw new WorkspaceError(401, 'INCORRECT_PIN', 'The workspace PIN is incorrect.');
    const { token, session } = createSession(login.profileId, config);
    return jsonResponse({ session }, 200, { 'Set-Cookie': sessionCookie(token, config) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const secure = process.env.NODE_ENV === 'production';
    return jsonResponse({ session: READ_ONLY_SESSION }, 200, { 'Set-Cookie': sessionCookie('', { secure }, true) });
  } catch (error) { return errorResponse(error); }
}
