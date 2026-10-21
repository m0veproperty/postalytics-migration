import { requireEditor } from '@/lib/migration/auth';
import { readAsset } from '@/lib/migration/content-store';
import { contentType } from '@/lib/migration/content-validation';
import { errorResponse } from '@/lib/migration/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  try {
    requireEditor(request);
    const { name } = await context.params;
    const file = await readAsset(name);
    const html = name.endsWith('.html');
    const download = !html || new URL(request.url).searchParams.get('download') === '1';
    const headers: Record<string, string> = {
      'Content-Type': `${contentType(name)}${/\.(html|csv)$/.test(name) ? '; charset=utf-8' : ''}`,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Cookie',
    };
    // Private Blob streams may report size 0 when the upstream length is unknown.
    // Let the runtime frame the stream rather than truncating a nonempty file.
    // Keep report interactivity while denying the document the app's cookie origin.
    if (html) headers['Content-Security-Policy'] = "sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
    return new Response(file.stream, { headers });
  } catch (error) { return errorResponse(error); }
}
