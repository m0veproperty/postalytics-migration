import { WorkspaceError } from './errors.ts';
import { validateApproval } from './validation.ts';
import type { AuditEvent, DecisionFields, Ledger, Mutation, Projection, SeedData, Task, TaskOverride } from './types.ts';

export const EMPTY_DECISION: DecisionFields = {
  approvalStatus: 'Not approved', approvedAction: '', approvedTarget: '', approver: '',
  approvalDate: '', evidence: '', notes: '', conditionsConfirmed: false,
};

export function emptyLedger(now = new Date().toISOString()): Ledger {
  return { schemaVersion: 1, revision: 0, createdAt: now, events: [] };
}

/** The current workspace is derived from immutable, ordered audit events. */
export function projectLedger(ledger: Ledger): Projection {
  const projection: Projection = { revision: ledger.revision, taskOverrides: {}, customTasks: [], decisionOverrides: {} };
  for (const event of ledger.events) {
    const mutation = event.mutation;
    if (mutation.type === 'decision.update') {
      const previous = projection.decisionOverrides[mutation.decisionId];
      projection.decisionOverrides[mutation.decisionId] = {
        ...EMPTY_DECISION, ...previous, ...mutation.patch,
        revision: (previous?.revision ?? 0) + 1, updatedAt: event.at, updatedBy: event.actor,
      };
      continue;
    }
    const taskId = event.entityId;
    const previous = projection.taskOverrides[taskId];
    const next: TaskOverride = { ...previous, revision: (previous?.revision ?? 0) + 1, updatedAt: event.at, updatedBy: event.actor };
    switch (mutation.type) {
      case 'task.create': {
        const task: Task = {
          ...mutation.task, id: taskId, status: 'todo', createdAt: event.at, createdBy: event.actor,
          dependencies: [], sourceLinks: [],
          subtasks: (mutation.task.subtasks ?? []).map((title, index) => ({ id: `${taskId}-s${index + 1}`, title, done: false })),
        };
        projection.customTasks.push(task);
        break;
      }
      case 'task.update': Object.assign(next, mutation.patch); break;
      case 'task.subtask': next.subtaskState = { ...previous?.subtaskState, [mutation.subtaskId]: mutation.done }; break;
      case 'task.comment':
        next.comments = [...(previous?.comments ?? []), { id: event.id, author: event.actor, text: mutation.text, createdAt: event.at }];
        break;
    }
    projection.taskOverrides[taskId] = next;
  }
  return projection;
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new WorkspaceError(409, 'STALE_REVISION', 'Someone updated this item while you were editing. Refresh it before saving your changes.', { currentRevision: actual });
}

export function appendMutation(
  ledger: Ledger,
  mutation: Mutation,
  actor: string,
  seeds: SeedData,
  context: { now: string; eventId: string; newTaskId: string },
): Ledger {
  if (ledger.events.length >= 20_000) throw new WorkspaceError(503, 'AUDIT_CAPACITY', 'The workspace audit archive needs maintenance before more changes can be saved. Existing records remain available.');
  const projection = projectLedger(ledger);
  let entityId: string;
  let entityType: 'task' | 'decision' = 'task';
  let summary: string;
  if (mutation.type === 'decision.update') {
    const seed = seeds.decisions.find((decision) => decision.id === mutation.decisionId);
    if (!seed) throw new WorkspaceError(404, 'UNKNOWN_DECISION', 'This URL is not in the source decision register.');
    const previous = projection.decisionOverrides[mutation.decisionId];
    assertRevision(previous?.revision ?? 0, mutation.expectedRevision);
    const fields = { ...EMPTY_DECISION, ...previous, ...mutation.patch };
    validateApproval(fields, seed.url, context.now);
    entityId = mutation.decisionId;
    entityType = 'decision';
    summary = fields.approvalStatus === 'Approved' ? `Recorded approval for ${seed.url}` : `Updated URL review for ${seed.url}`;
  } else if (mutation.type === 'task.create') {
    if (!seeds.workstreamIds.includes(mutation.task.workstreamId)) throw new WorkspaceError(400, 'UNKNOWN_WORKSTREAM', 'Choose an existing workstream for this action.');
    if (projection.customTasks.length >= 2000) throw new WorkspaceError(400, 'TASK_LIMIT', 'The workspace has reached its additional action limit.');
    entityId = context.newTaskId;
    summary = `Added action: ${mutation.task.title}`;
  } else {
    const task = seeds.tasks.find((item) => item.id === mutation.taskId) ?? projection.customTasks.find((item) => item.id === mutation.taskId);
    if (!task) throw new WorkspaceError(404, 'UNKNOWN_TASK', 'This action is not in the workspace.');
    entityId = mutation.taskId;
    const previous = projection.taskOverrides[entityId];
    const title = previous?.title ?? task.title;
    if ('expectedRevision' in mutation) assertRevision(previous?.revision ?? 0, mutation.expectedRevision);
    if (mutation.type === 'task.subtask') {
      const subtask = task.subtasks?.find((item) => item.id === mutation.subtaskId);
      if (!subtask) throw new WorkspaceError(404, 'UNKNOWN_SUBTASK', 'This checklist item is not in the action.');
      summary = `${mutation.done ? 'Completed' : 'Reopened'} checklist item: ${subtask.title}`;
    } else if (mutation.type === 'task.comment') {
      summary = `Added a note to ${title}`;
    } else {
      summary = mutation.patch.status ? `Set ${title} to ${mutation.patch.status.replaceAll('_', ' ')}` : `Updated action: ${title}`;
    }
  }
  const event: AuditEvent = {
    id: context.eventId, revision: ledger.revision + 1, at: context.now, actor,
    type: mutation.type, entityType, entityId, summary, mutation,
  };
  return { ...ledger, revision: event.revision, events: [...ledger.events, event] };
}

export function assertLedger(value: unknown): Ledger {
  if (!value || typeof value !== 'object') throw new WorkspaceError(503, 'INVALID_LEDGER', 'The shared record could not be read safely. Please contact the workspace administrator.');
  const ledger = value as Ledger;
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.events) || ledger.revision !== ledger.events.length || !Number.isSafeInteger(ledger.revision) || typeof ledger.createdAt !== 'string') {
    throw new WorkspaceError(503, 'INVALID_LEDGER', 'The shared record uses an unsupported format. No changes were written.');
  }
  for (let index = 0; index < ledger.events.length; index++) {
    const event = ledger.events[index];
    if (!event || event.revision !== index + 1 || typeof event.id !== 'string' || typeof event.actor !== 'string' || typeof event.at !== 'string' || !event.mutation || event.type !== event.mutation.type || !['task.create', 'task.update', 'task.subtask', 'task.comment', 'decision.update'].includes(event.type)) {
      throw new WorkspaceError(503, 'INVALID_LEDGER', 'The shared audit sequence is incomplete. No changes were written.');
    }
  }
  return ledger;
}
