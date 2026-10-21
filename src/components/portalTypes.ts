import type { ProfileId } from '../lib/migration/profiles';

export type Status = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type Section = 'overview' | 'actions' | 'decisions' | 'documents' | 'milestones' | 'activity';
export type SourceLink = { label: string; url: string };
export type ChecklistItem = { id: string; title: string; done: boolean };
export type Comment = { id: string; author: string; text: string; createdAt: string };
export type Task = {
  id: string; title: string; description: string; workstreamId: string;
  status: Status; priority: Priority; owner: string; dueDate: string | null;
  dependencies: string[]; subtasks: ChecklistItem[]; sourceLinks: SourceLink[];
  completionEvidence: string | null; notes: string; sourceStatus: string | null;
  sourceCheckedAt: string | null; sourceAssignees: string[];
  revision?: number; updatedAt?: string; updatedBy?: string; comments?: Comment[];
};
export type Workstream = { id: string; title: string; description: string; order: number };
export type Asset = {
  id: string; title: string; description: string; kind: string; status: string;
  href: string | null; fileName: string | null; workstreamId: string; updatedAt: string;
  notes: string; sourceLinks: SourceLink[];
};
export type Milestone = {
  id: string; title: string; description: string; status: Status;
  taskIds: string[]; dueDate: string | null; notes: string;
};
export type ProjectData = {
  project: {
    id: string; name: string; client: string; description: string; snapshotDate: string;
    sourceCheckedAt: string; approvalNote: string; scopeNote: string; currentFocus?: string;
  };
  tasks: Task[]; workstreams: Workstream[]; assets: Asset[]; milestones: Milestone[];
  sources: { id: string; title: string; url: string; description: string; checkedAt: string }[];
  metrics: Record<string, number>; scopeNotes: string[];
};
export type TaskOverride = Partial<Omit<Task, 'id' | 'subtasks'>> & {
  revision: number; updatedAt: string; updatedBy: string; subtaskState?: Record<string, boolean>;
};
export type DecisionFields = {
  approvalStatus: 'Not approved' | 'Needs discussion' | 'Approved' | 'Rejected';
  approvedAction: '' | 'Retain' | 'Redirect' | 'Retire (410)' | 'External service' | 'Fix link' | 'Hold';
  approvedTarget: string; approver: string; approvalDate: string; approvedAt: string; evidence: string;
  notes: string; conditionsConfirmed: boolean;
};
export type DecisionOverride = DecisionFields & { revision: number; updatedAt: string; updatedBy: string };
export type Decision = {
  id: string; url: string; title: string; group: string; role: string;
  proposedAction: string; proposedTarget: string; rationale: string; question: string;
  dependency: string; observedStatus: string; observedTarget: string; source: string;
  sourceUrl: string; checkedAt: string; isPage: boolean;
  raw: Record<string, unknown>;
} & DecisionFields & { revision: number; updatedAt?: string; updatedBy?: string };
export type AuditEvent = {
  id: string; timestamp?: string; createdAt?: string; at?: string; actor?: string;
  author?: string; type?: string; action?: string; entityId?: string; entityType?: string;
  summary?: string; details?: unknown; changes?: unknown; [key: string]: unknown;
};
export type WorkspaceState = {
  schemaVersion: number; revision: number; taskOverrides: Record<string, TaskOverride>;
  customTasks: Task[]; decisionOverrides: Record<string, DecisionOverride>; activity: AuditEvent[];
  activityTotal?: number;
  session: { profileId: ProfileId | null; canEdit: boolean; canApprove: boolean; name: string | null; expiresAt: string | null };
  persistence: { configured: boolean; mode: 'shared'; message?: string };
};
export type Mutation = Record<string, unknown>;
