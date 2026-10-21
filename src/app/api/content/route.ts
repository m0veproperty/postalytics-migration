import { assertSameOrigin, requireEditor } from '@/lib/migration/auth';
import { uploadPrivateContent } from '@/lib/migration/content-store';
import { contentName, contentType, MAX_CONTENT_BYTES } from '@/lib/migration/content-validation';
import { WorkspaceError } from '@/lib/migration/errors';
import { errorResponse, jsonResponse, readBody } from '@/lib/migration/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Authenticated one-time source seeding; different existing bytes cannot be replaced. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    requireEditor(request);
    const name = contentName(new URL(request.url).searchParams.get('name'));
    const sentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (sentType !== contentType(name)) throw new WorkspaceError(415, 'CONTENT_TYPE_MISMATCH', 'Use the file type declared for this source filename.');
    const body = await readBody(request, MAX_CONTENT_BYTES);
    if (!body.length) throw new WorkspaceError(400, 'EMPTY_CONTENT', 'The source file is empty.');
    const result = await uploadPrivateContent(name, body);
    return jsonResponse(result, result.alreadyExists ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
