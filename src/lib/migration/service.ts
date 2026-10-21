import { randomUUID } from 'node:crypto';
import { updateDocument } from './atomic-store.ts';
import type { AtomicDocumentStore } from './atomic-store.ts';
import { appendMutation, assertLedger, emptyLedger, projectLedger } from './state.ts';
import type { Ledger, Mutation, SeedData, SessionInfo, WorkspaceResponse } from './types.ts';
import type { ProfileId } from './profiles.ts';

export const LEDGER_PATH = 'postalytics-migration/workspace-v1.json';

export async function readWorkspace(store: AtomicDocumentStore): Promise<Ledger> {
  const record = await store.read(LEDGER_PATH);
  return record ? assertLedger(record.value) : emptyLedger();
}

export async function saveMutation(store: AtomicDocumentStore, seeds: SeedData, mutation: Mutation, actorProfileId: ProfileId): Promise<Ledger> {
  const context = { now: new Date().toISOString(), eventId: randomUUID(), newTaskId: `custom-${randomUUID()}` };
  return updateDocument(store, LEDGER_PATH, (previous) => {
    const ledger = previous ? assertLedger(previous) : emptyLedger(context.now);
    // If an initial put succeeded but its acknowledgement was lost, retrying this
    // server request must not duplicate the event.
    if (ledger.events.some((event) => event.id === context.eventId)) return ledger;
    return appendMutation(ledger, mutation, actorProfileId, seeds, context);
  });
}

export function workspaceResponse(ledger: Ledger, session: SessionInfo, configured: boolean, allActivity = false): WorkspaceResponse {
  return {
    schemaVersion: 1, ...projectLedger(ledger),
    activity: [...(allActivity ? ledger.events : ledger.events.slice(-200))].reverse(),
    activityTotal: ledger.events.length,
    session,
    persistence: { configured, mode: 'shared', ...(!configured ? { message: 'Shared editing is not configured. The source workspace is available for review.' } : {}) },
  };
}
