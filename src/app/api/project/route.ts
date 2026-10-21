import { requireEditor } from '@/lib/migration/auth';
import { readPrivateJson } from '@/lib/migration/content-store';
import { errorResponse, jsonResponse } from '@/lib/migration/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try { requireEditor(request); return jsonResponse(await readPrivateJson('project.json')); }
  catch (error) { return errorResponse(error); }
}
