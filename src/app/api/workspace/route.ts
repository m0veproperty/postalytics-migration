import { assertSameOrigin, authConfig, requireEditor } from '@/lib/migration/auth';
import { getStore, storageConfigured } from '@/lib/migration/blob-store';
import { errorResponse, jsonResponse, readJson } from '@/lib/migration/http';
import { getSeedData } from '@/lib/migration/seeds';
import { readWorkspace, saveMutation, workspaceResponse } from '@/lib/migration/service';
import { emptyLedger } from '@/lib/migration/state';
import { validateMutation } from '@/lib/migration/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireEditor(request);
    const configured = storageConfigured();
    const ledger = configured ? await readWorkspace(getStore()) : emptyLedger();
    const allActivity = new URL(request.url).searchParams.get('activity') === 'all';
    return jsonResponse(workspaceResponse(ledger, session, configured && Boolean(authConfig()), allActivity));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = requireEditor(request);
    const mutation = validateMutation(await readJson(request));
    const ledger = await saveMutation(getStore(), await getSeedData(), mutation, session.name);
    return jsonResponse(workspaceResponse(ledger, session, true));
  } catch (error) { return errorResponse(error); }
}
