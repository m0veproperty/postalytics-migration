import { WorkspaceError } from './errors.ts';
import type { DecisionFields, DecisionPatch, Mutation, NewTask, TaskPatch } from './types.ts';
import { getWorkspaceProfile } from './profiles.ts';
import type { ProfileId } from './profiles.ts';

const statuses = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;
const priorities = ['high', 'medium', 'low'] as const;
const approvalStatuses = ['Not approved', 'Needs discussion', 'Approved', 'Rejected'] as const;
const actions = ['', 'Retain', 'Redirect', 'Retire (410)', 'External service', 'Fix link', 'Hold'] as const;
const taskKeys = ['title', 'description', 'status', 'priority', 'owner', 'dueDate'];
const decisionKeys = ['approvalStatus', 'approvedAction', 'approvedTarget', 'evidence', 'notes', 'conditionsConfirmed'];

function invalid(message: string): never {
  throw new WorkspaceError(400, 'INVALID_INPUT', message);
}

export function object(value: unknown, allowed: string[], label = 'Request'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) invalid(`${label} contains an unsupported field.`);
  return record;
}

export function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string') invalid(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) invalid(`${label} must contain ${min}–${max} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) invalid(`${label} contains an unsupported control character.`);
  return normalized;
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(`${label} is not supported.`);
  return value as T;
}

export function date(value: unknown, label: string, allowBlank = false): string {
  const result = text(value, label, 10, allowBlank ? 0 : 10);
  if (allowBlank && !result) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalid(`${label} is not a valid calendar date.`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be true or false.`);
  return value;
}

function id(value: unknown, label: string): string {
  const result = text(value, label, 120, 1);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result) || ['__proto__', 'constructor', 'prototype'].includes(result)) invalid(`${label} is invalid.`);
  return result;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid('The current entity revision is required. Refresh the workspace and try again.');
  return value as number;
}

function taskPatch(value: unknown): TaskPatch {
  const record = object(value, taskKeys, 'Task patch');
  if (!Object.keys(record).length) invalid('Choose a task field to update.');
  const patch: TaskPatch = {};
  if ('title' in record) patch.title = text(record.title, 'Title', 200, 3);
  if ('description' in record) patch.description = text(record.description, 'Description', 6000);
  if ('status' in record) patch.status = choice(record.status, statuses, 'Status');
  if ('priority' in record) patch.priority = choice(record.priority, priorities, 'Priority');
  if ('owner' in record) patch.owner = text(record.owner, 'Owner', 120);
  if ('dueDate' in record) patch.dueDate = record.dueDate === null || record.dueDate === '' ? null : date(record.dueDate, 'Due date');
  return patch;
}

function decisionPatch(value: unknown): DecisionPatch {
  const record = object(value, decisionKeys, 'Decision patch');
  if (!Object.keys(record).length) invalid('Choose a decision field to update.');
  const patch: DecisionPatch = {};
  if ('approvalStatus' in record) patch.approvalStatus = choice(record.approvalStatus, approvalStatuses, 'Approval status');
  if ('approvedAction' in record) patch.approvedAction = choice(record.approvedAction, actions, 'Approved action');
  if ('approvedTarget' in record) patch.approvedTarget = text(record.approvedTarget, 'Approved destination', 2048);
  if ('evidence' in record) patch.evidence = text(record.evidence, 'Approval evidence', 4000);
  if ('notes' in record) patch.notes = text(record.notes, 'Notes', 6000);
  if ('conditionsConfirmed' in record) patch.conditionsConfirmed = boolean(record.conditionsConfirmed, 'Conditions confirmation');
  return patch;
}

function newTask(value: unknown): NewTask {
  const record = object(value, ['title', 'description', 'workstreamId', 'priority', 'owner', 'dueDate', 'subtasks'], 'New task');
  const subtasks = record.subtasks ?? [];
  if (!Array.isArray(subtasks) || subtasks.length > 30) invalid('A task can have at most 30 checklist items.');
  return {
    title: text(record.title, 'Title', 200, 3),
    description: text(record.description ?? '', 'Description', 6000),
    workstreamId: id(record.workstreamId, 'Workstream'),
    priority: choice(record.priority ?? 'medium', priorities, 'Priority'),
    owner: text(record.owner ?? '', 'Owner', 120),
    dueDate: record.dueDate == null || record.dueDate === '' ? null : date(record.dueDate, 'Due date'),
    subtasks: subtasks.map((item) => text(item, 'Checklist item', 400, 1)),
  };
}

export function validateMutation(value: unknown): Mutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Request must be an object.');
  const type = (value as Record<string, unknown>).type;
  switch (type) {
    case 'task.update': {
      const body = object(value, ['type', 'taskId', 'expectedRevision', 'patch']);
      return { type, taskId: id(body.taskId, 'Task'), expectedRevision: revision(body.expectedRevision), patch: taskPatch(body.patch) };
    }
    case 'task.subtask': {
      const body = object(value, ['type', 'taskId', 'expectedRevision', 'subtaskId', 'done']);
      return { type, taskId: id(body.taskId, 'Task'), expectedRevision: revision(body.expectedRevision), subtaskId: id(body.subtaskId, 'Checklist item'), done: boolean(body.done, 'Checklist state') };
    }
    case 'task.comment': {
      const body = object(value, ['type', 'taskId', 'text']);
      return { type, taskId: id(body.taskId, 'Task'), text: text(body.text, 'Comment', 4000, 1) };
    }
    case 'task.create': {
      const body = object(value, ['type', 'task']);
      return { type, task: newTask(body.task) };
    }
    case 'decision.update': {
      const body = object(value, ['type', 'decisionId', 'expectedRevision', 'patch']);
      return { type, decisionId: id(body.decisionId, 'URL decision'), expectedRevision: revision(body.expectedRevision), patch: decisionPatch(body.patch) };
    }
    default: return invalid('This action is not supported.');
  }
}

export function validateLogin(value: unknown): { profileId: ProfileId; pin: string } {
  const body = object(value, ['profileId', 'pin']);
  const profile = getWorkspaceProfile(body.profileId);
  if (!profile) invalid('Choose one of the workspace profiles.');
  if (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)) invalid('Enter the six-digit workspace PIN.');
  return { profileId: profile.id, pin: body.pin };
}

export function validateApproval(fields: DecisionFields, sourceUrl: string): void {
  if (fields.approvedTarget) {
    let target: URL;
    try { target = new URL(fields.approvedTarget); } catch { return invalid('The approved destination must be a complete URL.'); }
    if (target.protocol !== 'https:' || target.username || target.password) invalid('Use an HTTPS destination without embedded credentials.');
  }
  if (fields.approvalStatus !== 'Approved') return;
  if (!fields.approvedAction || fields.approvedAction === 'Hold') invalid('Choose a final migration action before marking this URL Approved.');
  if (fields.approvedAction === 'Retire (410)') {
    if (fields.approvedTarget) invalid('A 410 retirement must have an empty destination.');
    return;
  }
  if (!fields.approvedTarget) invalid('This action requires an approved destination.');
  if (fields.approvedAction === 'Retain' && fields.approvedTarget !== sourceUrl) invalid('Retain must use the exact source URL. Use Redirect if the URL changes.');
  if (fields.approvedAction === 'Fix link' && fields.approvedTarget === sourceUrl) invalid('A link correction must change the source URL spelling.');
  if (fields.approvedAction === 'Redirect') {
    const target = new URL(fields.approvedTarget);
    target.hash = '';
    let sourceRequest = sourceUrl;
    try { const source = new URL(sourceUrl); source.hash = ''; sourceRequest = source.href; } catch { /* Preserve malformed source evidence; the approved target is valid. */ }
    if (target.href === sourceRequest) invalid('The destination must differ from the source URL for this action.');
  }
}
