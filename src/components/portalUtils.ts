import type { Decision, DecisionFields, ProjectData, Task, WorkspaceState } from './portalTypes';
import { getTaskPhase } from '../lib/migration/phases';

export const STATUS_LABELS = {
  todo: 'Not started', in_progress: 'In progress', blocked: 'Blocked', review: 'In review', done: 'Complete',
} as const;
export const STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;
export const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const APPROVAL_STATUSES = ['Not approved', 'Needs discussion', 'Approved', 'Rejected'] as const;
export const APPROVAL_HELP: Record<DecisionFields['approvalStatus'], string> = {
  'Not approved': 'No final approval has been recorded for this URL.',
  'Needs discussion': 'A question or dependency needs to be resolved before a final decision.',
  Approved: 'Confirm the action and destination. Your name and the approval time are recorded automatically.',
  Rejected: 'The proposed treatment has not been accepted. Use the working notes to explain the next step.',
};
export const DECISION_ACTION_LABELS: Record<DecisionFields['approvedAction'], string> = {
  '': 'Select an action', Retain: 'Retain at the same URL', Redirect: 'Redirect / consolidate',
  'Retire (410)': 'Retire (410)', 'External service': 'Keep external service', 'Fix link': 'Correct a link', Hold: 'Hold for further review',
};
export const DECISION_DEFAULTS: DecisionFields = {
  approvalStatus: 'Not approved', approvedAction: '', approvedTarget: '', approver: '',
  approvalDate: '', approvedAt: '', evidence: '', notes: '', conditionsConfirmed: false,
};
export function londonDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  return ['year', 'month', 'day'].map(part => parts.find(item => item.type === part)?.value).join('-');
}
export function decisionPresentation(decision: Decision) {
  const approved = decision.approvalStatus === 'Approved';
  return {
    approved,
    action: approved ? decision.approvedAction : decision.proposedAction,
    target: approved ? decision.approvedTarget : decision.proposedTarget,
    retired: approved && decision.approvedAction === 'Retire (410)',
    targetToConfirm: decision.isPage && !approved && !decision.proposedTarget,
  };
}
export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return 'Not set';
  const date = new Date(value.length === 10 ? value + 'T12:00:00Z' : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' } : {}),
  }).format(date);
}
export function humanise(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/^\w/, x => x.toUpperCase());
}
export function initials(name?: string): string {
  if (!name || /unassigned|to confirm/i.test(name)) return '?';
  return name.split(/[\s/]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}
export function shortUrl(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/^www\.postalytics\.com/, '').replace(/^postalytics\.com/, '') || '/';
}
export function safeHref(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { return ['https:', 'http:'].includes(new URL(value).protocol) ? value : undefined; } catch { return undefined; }
}
export function mergeTasks(project: ProjectData, state?: WorkspaceState | null): Task[] {
  return [...project.tasks, ...(state?.customTasks || [])].map(task => {
    const patch = state?.taskOverrides[task.id];
    return {
      ...task, dependencies: task.dependencies || [], sourceLinks: task.sourceLinks || [],
      sourceAssignees: task.sourceAssignees || [], ...patch, revision: patch?.revision || task.revision || 0,
      phase: getTaskPhase({ ...task, ...patch }),
      comments: patch?.comments || task.comments || [],
      subtasks: (task.subtasks || []).map(item => ({ ...item, done: patch?.subtaskState?.[item.id] ?? item.done })),
    };
  });
}
function read(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  return '';
}
export function normaliseDecision(row: Record<string, unknown>, index: number): Decision {
  const id = read(row, ['id', 'reference', 'Reference', 'ref', 'url_id']) || `U${String(index + 1).padStart(4, '0')}`;
  const role = read(row, ['role', 'scope', 'classification', 'record_type', 'url_role', 'urlRole', 'type', 'register_role']);
  const live = row.live && typeof row.live === 'object' ? row.live as Record<string, unknown> : {};
  const chain = Array.isArray(live.chain) ? live.chain as Record<string, unknown>[] : [];
  const route = chain.map(step => String(step.status || step.status_code || '')).filter(Boolean);
  if (live.final_status && route[route.length - 1] !== String(live.final_status)) route.push(String(live.final_status));
  return {
    ...DECISION_DEFAULTS, id,
    url: read(row, ['url', 'current_url', 'currentUrl', 'Current URL', 'source_url', 'sourceUrl']),
    title: read(row, ['title', 'page_title', 'pageTitle', 'Page title']),
    group: read(row, ['group', 'page_group', 'pageGroup', 'Page group', 'category', 'content_type']),
    role,
    proposedAction: read(row, ['proposedAction', 'proposed_action', 'Proposed action', 'proposed_treatment', 'action']),
    proposedTarget: read(row, ['proposedTarget', 'proposed_target', 'proposed_destination', 'proposedDestination', 'Proposed destination', 'proposed_url', 'target']),
    rationale: read(row, ['rationale', 'Rationale', 'reason']),
    question: read(row, ['question', 'client_question', 'clientQuestion', 'Question for client confirmation', 'question_for_client']),
    dependency: read(row, ['dependency', 'dependencies', 'Dependency before implementation', 'implementation_dependency']),
    observedStatus: read(row, ['observedStatus', 'observed_status', 'live_check_result', 'Live check result', 'http_status', 'status']) || route.join(' → ') || (live.error ? String(live.error) : ''),
    observedTarget: read(row, ['observedTarget', 'observed_target', 'observed_destination', 'Observed destination']) || String(live.final_url || ''),
    source: read(row, ['source', 'source_location', 'sourceLocation', 'Source location and check scope', 'source_reference', 'source_notes']) || [row.source_row ? `Reconciliation workbook row ${row.source_row}` : '', row.metadata_row ? `Metadata row ${row.metadata_row}` : '', row.http_evidence_id ? `HTTP evidence ${row.http_evidence_id}` : '', live.observation_scope ? String(live.observation_scope) : ''].filter(Boolean).join(' · '),
    sourceUrl: read(row, ['sourceLink', 'source_link', 'source_reference_url', 'Source URL', 'evidence_url']),
    checkedAt: read(row, ['checkedAt', 'checked_at', 'live_checked_at', 'Live check timestamp (UTC)', 'observed_at']) || String(live.checked_at_utc || ''),
    isPage: row.isPublishedPage === true || row.isPage === true || row.is_page === true || row.is_page_decision === true || row.pageDecision === true || /^P\d+$/i.test(id) || /published.*non.?blog|page.?decision/i.test(role),
    revision: 0, raw: row,
  };
}
export function csvDownload(fileName: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const encode = (value: unknown) => {
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const csv = '\uFEFF' + [columns.map(encode).join(','), ...rows.map(row => columns.map(key => encode(row[key])).join(','))].join('\r\n');
  download(fileName, csv, 'text/csv;charset=utf-8');
}
export function download(fileName: string, content: string, type: string): void {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = objectUrl; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
