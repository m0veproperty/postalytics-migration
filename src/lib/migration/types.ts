import type { ProfileId } from './profiles.ts';

/** Public API types. Source snapshots remain immutable in private storage. */
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type ApprovalStatus = 'Not approved' | 'Needs discussion' | 'Approved' | 'Rejected';
export type ApprovedAction = '' | 'Retain' | 'Redirect' | 'Retire (410)' | 'External service' | 'Fix link' | 'Hold';

export interface Task {
  id: string;
  title: string;
  description: string;
  workstreamId: string;
  status: TaskStatus;
  priority: Priority;
  owner: string;
  dueDate: string | null;
  subtasks: { id: string; title: string; done: boolean }[];
  dependencies?: string[];
  sourceLinks?: { label: string; url: string }[];
  createdAt?: string;
  createdBy?: string;
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  owner?: string;
  dueDate?: string | null;
}

export interface TaskOverride extends TaskPatch {
  revision: number;
  updatedAt: string;
  updatedBy: string;
  subtaskState?: Record<string, boolean>;
  comments?: Comment[];
}

export interface DecisionFields {
  approvalStatus: ApprovalStatus;
  approvedAction: ApprovedAction;
  approvedTarget: string;
  approver: string;
  approvalDate: string;
  approvedAt: string;
  evidence: string;
  notes: string;
  conditionsConfirmed: boolean;
}

export type DecisionPatch = Partial<Omit<DecisionFields, 'approver' | 'approvalDate' | 'approvedAt'>>;

export interface DecisionOverride extends DecisionFields {
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface NewTask {
  title: string;
  description: string;
  workstreamId: string;
  priority: Priority;
  owner: string;
  dueDate: string | null;
  subtasks?: string[];
}

export type Mutation =
  | { type: 'task.update'; taskId: string; expectedRevision: number; patch: TaskPatch }
  | { type: 'task.subtask'; taskId: string; expectedRevision: number; subtaskId: string; done: boolean }
  | { type: 'task.comment'; taskId: string; text: string }
  | { type: 'task.create'; task: NewTask }
  | { type: 'decision.update'; decisionId: string; expectedRevision: number; patch: DecisionPatch };

/** Stored events also contain server-owned approval stamps and historical fields. */
export type RecordedMutation = Exclude<Mutation, { type: 'decision.update' }>
  | { type: 'decision.update'; decisionId: string; expectedRevision: number; patch: Partial<DecisionFields> };

export interface AuditEvent {
  id: string;
  revision: number;
  at: string;
  actor: string;
  actorProfileId?: ProfileId;
  type: Mutation['type'];
  entityType: 'task' | 'decision';
  entityId: string;
  summary: string;
  mutation: RecordedMutation;
}

export interface Ledger {
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  events: AuditEvent[];
}

export interface Projection {
  revision: number;
  taskOverrides: Record<string, TaskOverride>;
  customTasks: Task[];
  decisionOverrides: Record<string, DecisionOverride>;
}

export interface SessionInfo {
  profileId: ProfileId | null;
  canEdit: boolean;
  canApprove: boolean;
  name: string | null;
  expiresAt: string | null;
}

export type SignedInSession = SessionInfo & { profileId: ProfileId; canEdit: true; name: string };

export interface WorkspaceResponse extends Projection {
  schemaVersion: 1;
  activity: AuditEvent[];
  activityTotal: number;
  session: SessionInfo;
  persistence: { configured: boolean; mode: 'shared'; message?: string };
}

export interface SeedDecision { id: string; url: string; [key: string]: unknown }
export interface SeedData {
  tasks: Pick<Task, 'id' | 'title' | 'subtasks'>[];
  workstreamIds: string[];
  decisions: SeedDecision[];
}

export interface ErrorResponse {
  error: { code: string; message: string; details?: unknown };
}
