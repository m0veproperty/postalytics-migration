'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Check, CheckCircle, DownloadSimple, FileText, Info, LockSimple, PaperPlaneTilt, Plus, SpinnerGap, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, Decision, DecisionFields, Mutation, Priority, ProjectData, Status, Task, Workstream, WorkspaceState } from './portalTypes';
import { APPROVAL_HELP, APPROVAL_STATUSES, DECISION_ACTION_LABELS, formatDate, initials, PRIORITY_LABELS, safeHref, shortUrl, STATUSES, STATUS_LABELS } from './portalUtils';
import { decisionDraftFields, initialDecisionDraft, recommendationFor, type DecisionDraft } from './decisionRecommendations';
import { ProfileAccess } from './ProfileAccess';

type Mutate = (payload: Mutation, message?: string) => Promise<WorkspaceState>;

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status}`}><span aria-hidden="true" />{STATUS_LABELS[status] || status}</span>;
}
export function ApprovalBadge({ status }: { status: string }) {
  const color = status === 'Approved' ? 'done' : status === 'Needs discussion' ? 'review' : status === 'Rejected' ? 'blocked' : 'todo';
  return <span className={`status-badge status-${color}`}><span aria-hidden="true" />{status}</span>;
}
export function ApprovalSelect({ decision, disabled, canApprove, onChoose }: { decision: Decision; disabled: boolean; canApprove: boolean; onChoose: (id: string, status: DecisionFields['approvalStatus']) => void }) {
  const locked = !canApprove && decision.approvalStatus === 'Approved';
  return <label className={`approval-select approval-${decision.approvalStatus.toLowerCase().replaceAll(' ', '-')}`}><span className="sr-only">Change approval for {decision.id}</span><select aria-label={`Change approval for ${decision.id}`} value={decision.approvalStatus} disabled={disabled || locked} aria-describedby="approval-edit-instructions" onChange={e => onChoose(decision.id, e.target.value as DecisionFields['approvalStatus'])}>{APPROVAL_STATUSES.map(status => <option value={status} key={status} disabled={status === 'Approved' && !canApprove}>{status === 'Approved' && !canApprove && !locked ? 'Approved — Dennis or Maddy' : status}</option>)}</select></label>;
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority-badge priority-${priority}`}><i aria-hidden="true" />{PRIORITY_LABELS[priority] || priority}</span>;
}
export function Avatar({ name, showName = true }: { name?: string; showName?: boolean }) {
  return <span className="person"><span className={`avatar avatar-${initials(name).charCodeAt(0) % 4}`} aria-hidden="true">{initials(name)}</span>{showName && <span>{name || 'Unassigned'}</span>}</span>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={27} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function SourceLinks({ links }: { links: { label: string; url: string }[] }) {
  return <div className="source-links">{links.filter(link => safeHref(link.url)).map((link, i) => <a key={`${link.url}-${i}`} href={safeHref(link.url)} target="_blank" rel="noreferrer">{link.label}<ArrowUpRight size={14} /></a>)}</div>;
}
export function Modal({ title, eyebrow, children, onClose, drawer = false, wide = false }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void; drawer?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`workspace-dialog ${drawer ? 'sheet-dialog' : ''} ${wide ? 'wide-dialog' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-surface">
      <header className="dialog-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button className="icon-button close-button" onClick={onClose} aria-label="Close dialog" autoFocus><X size={21} /></button></header>
      {children}
    </div>
  </dialog>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const labelId = useId();
  const hintId = useId();
  const control = isValidElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-labelledby': labelId, ...(hint ? { 'aria-describedby': hintId } : {}) })
    : children;
  return <label className="form-field"><span id={labelId}>{label}</span>{control}{hint && <small id={hintId}>{hint}</small>}</label>;
}
function SaveButton({ busy, disabled = false, children = 'Save changes' }: { busy: boolean; disabled?: boolean; children?: ReactNode }) {
  return <button className="button button-primary" type="submit" disabled={busy || disabled}>{busy ? <SpinnerGap size={17} className="spin" /> : <Check size={17} />}{busy ? 'Saving…' : children}</button>;
}
function ReadOnlyNote({ onLogin }: { onLogin: () => void }) {
  return <div className="inline-note"><LockSimple size={18} /><p>You’re viewing the shared workspace. <button className="inline-button" onClick={onLogin} type="button">Sign in to make changes</button>.</p></div>;
}

export function LoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  return <Modal title="Enter the workspace" eyebrow="Postalytics × MADX" onClose={onClose}><ProfileAccess compact onSuccess={async () => { await onSuccess(); onClose(); }} /></Modal>;
}

export function WorkspaceEntry({ onSuccess }: { onSuccess: () => Promise<void> }) {
  return <ProfileAccess onSuccess={onSuccess} />;
}

export function TaskDrawer({ task, tasks, workstreams, canEdit, busy, mutate, onClose, onLogin, onTask }: {
  task: Task; tasks: Task[]; workstreams: Workstream[]; canEdit: boolean; busy: boolean;
  mutate: Mutate; onClose: () => void; onLogin: () => void; onTask: (id: string) => void;
}) {
  const fields = (t: Task) => ({ title: t.title, description: t.description, status: t.status, priority: t.priority, owner: t.owner || '', dueDate: t.dueDate || '' });
  const [draft, setDraft] = useState(fields(task));
  const [baseline, setBaseline] = useState(fields(task));
  const [baselineRevision, setBaselineRevision] = useState(task.revision || 0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const workstream = workstreams.find(w => w.id === task.workstreamId);
  const done = task.subtasks.filter(t => t.done).length;
  const owners = Array.from(new Set(tasks.map(t => t.owner).filter(Boolean))).sort();
  const ownerList = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const stale = (task.revision || 0) !== baselineRevision;
  function reloadDraft() { setDraft(fields(task)); setBaseline(fields(task)); setBaselineRevision(task.revision || 0); setError(''); }
  function acceptNonFormUpdate(result: WorkspaceState) {
    const current = { ...task, ...result.taskOverrides[task.id] };
    if (JSON.stringify(fields(current)) === JSON.stringify(baseline)) setBaselineRevision(result.taskOverrides[task.id]?.revision ?? baselineRevision);
  }
  async function toggleChecklist(subtaskId: string, done: boolean) {
    if (stale) return;
    setError('');
    try { const result = await mutate({ type: 'task.subtask', taskId: task.id, expectedRevision: baselineRevision, subtaskId, done }, done ? 'Checklist item completed.' : 'Checklist item reopened.'); acceptNonFormUpdate(result); }
    catch (e) { setError(e instanceof Error ? e.message : 'The checklist item could not be saved.'); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setError('');
    if (stale) { setError('This action changed while you were editing. Reload the latest version before saving.'); return; }
    try { await mutate({ type: 'task.update', taskId: task.id, expectedRevision: baselineRevision, patch: { ...draft, dueDate: draft.dueDate || null } }, 'Action updated for everyone.'); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The action could not be saved.'); }
  }
  async function addComment(e: FormEvent) {
    e.preventDefault(); if (!comment.trim()) return; setError('');
    try { const result = await mutate({ type: 'task.comment', taskId: task.id, text: comment.trim() }, 'Comment added.'); acceptNonFormUpdate(result); setComment(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'The comment could not be added.'); }
  }
  return <Modal title={task.title} eyebrow={workstream?.title || 'Migration action'} onClose={onClose} drawer>
    <div className="dialog-body">
      <div className="detail-meta"><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /><span className="record-id">{task.id}</span></div>
      {!canEdit && <ReadOnlyNote onLogin={onLogin} />}
      {stale && <div className="stale-note" role="status"><Info size={18} /><div><strong>This action has a newer update.</strong><p>Reload the latest version before saving. Reloading replaces your unsaved form changes.</p><button type="button" className="inline-button" onClick={reloadDraft} disabled={busy}>Reload latest version</button></div></div>}
      <form onSubmit={save} className="form-stack detail-form">
        {canEdit ? <><Field label="Action title"><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} required maxLength={200} /></Field><Field label="Description"><textarea rows={4} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} maxLength={6000} /></Field></> : <p className="task-description">{task.description}</p>}
        <fieldset disabled={!canEdit || busy || stale} className="form-grid">
          <Field label="Status"><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
          <Field label="Priority"><select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Owner"><input list={ownerList} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} maxLength={120} placeholder="Assign an owner" /></Field><datalist id={ownerList}>{owners.map(owner => <option key={owner} value={owner} />)}</datalist>
          <Field label="Due date"><input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></Field>
        </fieldset>
        {canEdit && <div className="form-actions"><span className="fine-print">{dirty ? 'You have unsaved changes.' : task.updatedAt ? `Updated ${formatDate(task.updatedAt, true)}` : 'Changes are shared with the project team.'}</span><SaveButton busy={busy} disabled={stale} /></div>}
      </form>
      {error && <p className="form-error" role="alert"><WarningCircle size={17} />{error}</p>}
      <section className="detail-section"><div className="section-heading compact"><h3>Checklist</h3><span className="subtle-count">{done} of {task.subtasks.length} complete</span></div>
        {task.subtasks.length ? <div className="checklist">{task.subtasks.map(item => <label key={item.id} className={`checklist-item ${item.done ? 'checked' : ''}`}><input type="checkbox" checked={item.done} disabled={!canEdit || busy || stale} onChange={e => void toggleChecklist(item.id, e.target.checked)} /><span>{item.title}</span></label>)}</div> : <p className="muted small">No checklist items have been added to this action.</p>}
      </section>
      {task.completionEvidence && <section className="evidence-note"><CheckCircle size={21} /><div><h3>Completion evidence</h3><p>{task.completionEvidence}</p></div></section>}
      {!!task.dependencies.length && <section className="detail-section"><h3>Depends on</h3><div className="dependency-list">{task.dependencies.map(id => { const dependency = tasks.find(t => t.id === id); return dependency ? <button key={id} type="button" onClick={() => onTask(id)}><span>{dependency.title}</span><StatusBadge status={dependency.status} /></button> : <p key={id} className="muted small">{id}</p>; })}</div></section>}
      {(task.sourceLinks.length > 0 || task.sourceStatus || task.notes) && <section className="detail-section source-section"><h3>Source &amp; context</h3>{task.sourceStatus && <p className="muted small">ClickUp: <strong>{task.sourceStatus}</strong>{task.sourceCheckedAt ? ` · checked ${formatDate(task.sourceCheckedAt)}` : ''}. Portal changes are tracked separately.</p>}{task.notes && <p className="muted small">{task.notes}</p>}<SourceLinks links={task.sourceLinks} /></section>}
      <section className="detail-section"><div className="section-heading compact"><h3>Discussion</h3><span className="subtle-count">{task.comments?.length || 0}</span></div>
        {task.comments?.length ? <div className="comments">{task.comments.map(item => <article className="comment" key={item.id}><Avatar name={item.author} showName={false} /><div><div className="comment-meta"><strong>{item.author}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt, true)}</time></div><p>{item.text}</p></div></article>)}</div> : <p className="muted small">No comments yet. Add context or a handover note for the team.</p>}
        {canEdit && <form className="comment-form" onSubmit={addComment}><label className="sr-only" htmlFor={`comment-${task.id}`}>Add a comment</label><textarea id={`comment-${task.id}`} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a note for the project team…" rows={3} maxLength={4000} /><button className="button button-secondary" type="submit" disabled={busy || !comment.trim()}><PaperPlaneTilt size={16} />Add comment</button></form>}
      </section>
    </div>
  </Modal>;
}

export function NewTaskModal({ project, tasks, busy, mutate, onClose }: { project: ProjectData; tasks: Task[]; busy: boolean; mutate: Mutate; onClose: () => void }) {
  const [draft, setDraft] = useState({ title: '', description: '', workstreamId: project.workstreams[0]?.id || '', priority: 'medium', owner: '', dueDate: '', checklist: '' });
  const [error, setError] = useState('');
  const listId = useId();
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const items = draft.checklist.split('\n').map(item => item.trim()).filter(Boolean);
    if (items.length > 30 || items.some(item => item.length > 400)) { setError('Use up to 30 checklist items, with no more than 400 characters per item.'); return; }
    try {
      await mutate({ type: 'task.create', task: { title: draft.title.trim(), description: draft.description.trim(), workstreamId: draft.workstreamId, priority: draft.priority, owner: draft.owner.trim(), dueDate: draft.dueDate || null, subtasks: items } }, 'New action added to the shared workspace.');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'The action could not be created.'); }
  }
  return <Modal title="Add an action" eyebrow="Keep the next step clear" onClose={onClose}><form onSubmit={submit} className="dialog-body form-stack">
    <Field label="What needs to happen?"><input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Give this action a clear title" /></Field>
    <Field label="Description"><textarea rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} maxLength={6000} placeholder="Context, expected outcome, or acceptance criteria" /></Field>
    <div className="form-grid"><Field label="Workstream"><select value={draft.workstreamId} onChange={e => setDraft({ ...draft, workstreamId: e.target.value })}>{project.workstreams.map(w => <option value={w.id} key={w.id}>{w.title}</option>)}</select></Field><Field label="Priority"><select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Owner"><input list={listId} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} maxLength={120} placeholder="Assign an owner" /></Field><datalist id={listId}>{Array.from(new Set(tasks.map(t => t.owner).filter(Boolean))).sort().map(owner => <option key={owner} value={owner} />)}</datalist><Field label="Due date"><input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></Field></div>
    <Field label="Checklist" hint="One item per line. Up to 30 items, with 400 characters each. Optional."><textarea value={draft.checklist} onChange={e => setDraft({ ...draft, checklist: e.target.value })} rows={3} maxLength={12000} placeholder="List the steps needed to complete this action" /></Field>
    {error && <p className="form-error" role="alert"><WarningCircle size={17} />{error}</p>}
    <div className="form-actions"><button className="button button-ghost" onClick={onClose} type="button">Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <SpinnerGap size={17} className="spin" /> : <Plus size={17} />}{busy ? 'Adding…' : 'Add action'}</button></div>
  </form></Modal>;
}

export function DecisionDrawer({ decision, initialApprovalStatus, canEdit, canApprove, sessionName, busy, mutate, onClose, onLogin }: {
  decision: Decision; initialApprovalStatus?: DecisionFields['approvalStatus']; canEdit: boolean; canApprove: boolean;
  sessionName: string; busy: boolean; mutate: Mutate; onClose: () => void; onLogin: () => void;
}) {
  const recommendation = recommendationFor(decision);
  const requestedStatus = initialApprovalStatus === 'Approved' && !canApprove ? undefined : initialApprovalStatus;
  const [draft, setDraft] = useState<DecisionDraft>(() => initialDecisionDraft(decision, requestedStatus));
  const [savedFields, setSavedFields] = useState<DecisionDraft>(() => decisionDraftFields(decision));
  const [baselineRevision, setBaselineRevision] = useState(decision.revision);
  const [error, setError] = useState('');
  const approvalField = useRef<HTMLSelectElement>(null);
  const isApproved = draft.approvalStatus === 'Approved';
  const stale = decision.revision !== baselineRevision;
  const notesOnly = !canApprove && decision.approvalStatus === 'Approved';
  const hasChanges = notesOnly ? draft.notes !== savedFields.notes : JSON.stringify(draft) !== JSON.stringify(savedFields);
  const targetRequired = ['Retain', 'Redirect', 'External service', 'Fix link'].includes(draft.approvedAction);
  const matchesRecommendation = draft.approvedAction === recommendation.action && draft.approvedTarget === recommendation.target;
  const willStamp = isApproved && (savedFields.approvalStatus !== 'Approved' || draft.approvedAction !== savedFields.approvedAction || draft.approvedTarget !== savedFields.approvedTarget);
  const primaryLabel = notesOnly ? 'Save notes' : willStamp ? (matchesRecommendation && !recommendation.needsDecision ? 'Approve recommendation' : 'Approve decision') : 'Save decision';

  function focusApproval() { approvalField.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); approvalField.current?.focus({ preventScroll: true }); }
  useEffect(() => { if (!initialApprovalStatus) return; const frame = requestAnimationFrame(focusApproval); return () => cancelAnimationFrame(frame); }, [initialApprovalStatus]);
  function chooseAction(action: DecisionFields['approvedAction']) {
    setDraft(previous => ({
      ...previous,
      approvedAction: action,
      approvedTarget: action === 'Retire (410)' ? '' : action === 'Retain' ? decision.url : previous.approvedTarget,
    }));
    setError('');
  }
  function useRecommendation() {
    setDraft(previous => ({ ...previous, approvedAction: recommendation.action, approvedTarget: recommendation.target }));
    setError('');
  }
  function reloadDraft() {
    const latest = decisionDraftFields(decision);
    setDraft(latest); setSavedFields(latest); setBaselineRevision(decision.revision); setError('');
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!canEdit || busy) return;
    if (stale) { setError('This decision changed while you were editing. Reload the latest version before saving.'); return; }
    if (!notesOnly && isApproved) {
      if (!canApprove) { setError('Only Dennis and Maddy can approve URL decisions.'); return; }
      if (!draft.approvedAction || draft.approvedAction === 'Hold') { setError('Choose a final migration action before approving. This recommendation still needs a decision.'); return; }
      if (targetRequired) {
        try {
          const target = new URL(draft.approvedTarget);
          if (target.protocol !== 'https:' || target.username || target.password) throw new Error('invalid');
        } catch { setError('The approved destination must be a complete HTTPS URL.'); return; }
      }
      if (draft.approvedAction === 'Retain' && draft.approvedTarget !== decision.url) { setError('For Retain, the destination must exactly match the current URL.'); return; }
      if (['Redirect', 'Fix link'].includes(draft.approvedAction) && draft.approvedTarget === decision.url) { setError('A redirect or link correction must use a different destination or link spelling.'); return; }
      if (draft.approvedAction === 'Retire (410)' && draft.approvedTarget) { setError('A 410 retirement has no destination URL.'); return; }
    }
    try {
      await mutate({
        type: 'decision.update', decisionId: decision.id, expectedRevision: baselineRevision,
        patch: notesOnly ? { notes: draft.notes } : draft,
      }, willStamp && !notesOnly ? 'Approval recorded as ' + sessionName + '.' : notesOnly ? 'Notes saved. The approval record is unchanged.' : 'URL decision saved for everyone.');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'The decision could not be saved.'); }
  }

  return <Modal title={decision.title || shortUrl(decision.url)} eyebrow={'URL decision · ' + decision.id} onClose={onClose} drawer>
    <div className="dialog-body decision-flow">
      <div className="detail-meta"><ApprovalBadge status={decision.approvalStatus} /><span className="subtle-count">{decision.group || decision.role}</span></div>
      {safeHref(decision.url)
        ? <a className="url-block" href={safeHref(decision.url)} target="_blank" rel="noreferrer">{decision.url}<ArrowUpRight size={17} /></a>
        : <div className="url-block"><span>{decision.url}</span><span className="target-unresolved">Link spelling needs repair</span></div>}

      <section className="proposal-panel decision-summary">
        <div className="decision-summary-heading"><p className="eyebrow">Our recommendation</p><span className="recommendation-tag">{recommendation.needsDecision ? 'Decision needed' : 'Ready to review'}</span></div>
        <h3>{decision.proposedAction || 'Classification required'}</h3>
        {decision.proposedTarget
          ? <a href={safeHref(decision.proposedTarget)} target="_blank" rel="noreferrer" className="proposed-target">{decision.proposedTarget === decision.url ? 'Keep the current URL' : decision.proposedTarget}<ArrowUpRight size={14} /></a>
          : <p className="muted small">A destination has not been nominated yet.</p>}
        {decision.rationale && <p>{decision.rationale}</p>}
        {canEdit && !notesOnly && <button className="text-link" type="button" disabled={busy || stale || matchesRecommendation} onClick={useRecommendation}>{matchesRecommendation ? <Check size={16} /> : <ArrowUpRight size={16} />}{matchesRecommendation ? 'Recommendation selected below' : 'Use recommendation'}</button>}
      </section>

      {(decision.question || decision.dependency) && <div className="decision-context-list">
        {decision.question && <section><Info size={19} /><div><h3>For the reviewer</h3><p>{decision.question}</p></div></section>}
        {decision.dependency && <section><CheckCircle size={19} /><div><h3>Before implementation</h3><p>{decision.dependency}</p></div></section>}
      </div>}

      <section className="decision-editor">
        <div className="decision-editor-head"><div><p className="eyebrow">Your decision</p><h3>{notesOnly ? 'Approved record' : 'Confirm the next step'}</h3></div>{hasChanges && <span className="draft-notice" role="status">Unsaved changes</span>}</div>
        {!canEdit && <ReadOnlyNote onLogin={onLogin} />}
        {canEdit && !canApprove && <div className="inline-note role-note"><LockSimple size={18} /><p>{notesOnly ? 'You can add working notes. Dennis and Maddy can change this approved decision.' : 'You can prepare this decision and add notes. Dennis and Maddy can approve it.'}</p></div>}
        {stale && <div className="stale-note" role="status"><Info size={18} /><div><strong>This decision has a newer update.</strong><p>Reload it before saving. Reloading replaces your unsaved form changes.</p><button type="button" className="inline-button" disabled={busy} onClick={reloadDraft}>Reload latest version</button></div></div>}

        <form className="form-stack decision-form" onSubmit={submit}>
          <fieldset disabled={!canEdit || notesOnly || busy || stale} className="form-stack">
            <div className="form-grid">
              <Field label="Approval status" hint={APPROVAL_HELP[draft.approvalStatus]}><select ref={approvalField} value={draft.approvalStatus} onChange={e => { setDraft(previous => ({ ...previous, approvalStatus: e.target.value as DecisionFields['approvalStatus'] })); setError(''); }}>{APPROVAL_STATUSES.map(status => <option value={status} key={status} disabled={status === 'Approved' && !canApprove}>{status}</option>)}</select></Field>
              <Field label="Migration action" hint={draft.approvedAction === 'Hold' ? 'Choose a final action before approving.' : draft.approvedAction === 'Redirect' ? 'Covers a URL change or consolidation.' : undefined}><select value={draft.approvedAction} onChange={e => chooseAction(e.target.value as DecisionFields['approvedAction'])} required={isApproved}>{Object.entries(DECISION_ACTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
            </div>
            {draft.approvedAction === 'Retire (410)'
              ? <div className="inline-note"><Info size={18} /><p>This URL will return a 410 response. No destination is needed.</p></div>
              : <Field label="Destination URL" hint={draft.approvedAction === 'Retain' ? 'Kept at the current URL, as shown above.' : 'Use the suggested destination or enter the agreed HTTPS URL.'}><input type="url" value={draft.approvedTarget} onChange={e => setDraft(previous => ({ ...previous, approvedTarget: e.target.value }))} readOnly={draft.approvedAction === 'Retain'} placeholder="https://www.postalytics.com/…" required={isApproved && targetRequired} maxLength={2048} /></Field>}
            {draft.approvedAction === 'Retain' && draft.approvedTarget !== decision.url && /^https:\/\//i.test(decision.url) && <button className="text-link" type="button" onClick={() => setDraft(previous => ({ ...previous, approvedTarget: decision.url }))}>Use current URL<ArrowUpRight size={15} /></button>}
          </fieldset>

          {decision.approver && <div className="decision-identity recorded-identity"><Avatar name={decision.approver} showName={false} /><div><span>{decision.approvalStatus === 'Approved' ? 'Approved by' : 'Previous approval'}</span><strong>{decision.approver}</strong><time dateTime={decision.approvedAt || decision.approvalDate}>{formatDate(decision.approvedAt || decision.approvalDate, !!decision.approvedAt)}{decision.approvedAt ? ' · London time' : ''}</time></div></div>}
          {canApprove && willStamp && <div className="decision-identity pending-identity"><Avatar name={sessionName} showName={false} /><div><span>Approval will be recorded as</span><strong>{sessionName}</strong><p>The date and time are added when you approve.</p></div><CheckCircle size={22} /></div>}
          {canApprove && isApproved && !willStamp && <p className="fine-print">Updating notes or evidence keeps the original approver and approval time.</p>}

          <fieldset disabled={!canEdit || busy || stale} className="form-stack">
            <Field label="Working notes · optional"><textarea rows={3} value={draft.notes} onChange={e => setDraft(previous => ({ ...previous, notes: e.target.value }))} maxLength={6000} placeholder="Context, questions, or a handover for the team" /></Field>
          </fieldset>
          <details className="decision-optional" open={!!savedFields.evidence}>
            <summary><FileText size={17} /><span>Approval evidence <small>Optional</small></span></summary>
            <Field label="Supporting evidence" hint="Add a link or meeting note if useful. You can approve without it."><textarea rows={3} disabled={!canEdit || notesOnly || busy || stale} value={draft.evidence} onChange={e => setDraft(previous => ({ ...previous, evidence: e.target.value }))} maxLength={4000} placeholder="A relevant message, document, or meeting note" /></Field>
          </details>

          {error && <p className="form-error" role="alert"><WarningCircle size={17} />{error}</p>}
          {canEdit && <div className="decision-approval-footer"><p className="fine-print">{willStamp && !notesOnly ? 'Approving confirms the action and destination shown above.' : 'Your update is shared when you save.'}</p><div><button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>Cancel</button><SaveButton busy={busy} disabled={stale || !hasChanges}>{primaryLabel}</SaveButton></div></div>}
        </form>
      </section>

      {(decision.observedStatus || decision.observedTarget || decision.source || decision.sourceUrl) && <details className="decision-source-details"><summary>Source &amp; technical context</summary>
        {(decision.observedStatus || decision.observedTarget) && <div className="observation"><span>Observed response</span><strong>{decision.observedStatus || 'See source evidence'}</strong>{decision.observedTarget && <span className="break-text">{decision.observedTarget}</span>}{decision.checkedAt && <small>Checked {formatDate(decision.checkedAt, true)}</small>}</div>}
        {decision.source && <p className="muted small break-text">{decision.source}</p>}
        {decision.sourceUrl && <SourceLinks links={[{ label: 'Open source', url: decision.sourceUrl }]} />}
      </details>}
    </div>
  </Modal>;
}

export function PreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return <Modal title={asset.title} eyebrow="Document preview" onClose={onClose} wide><div className="preview-toolbar"><p>Dated review snapshot. Workspace changes are recorded separately; export the current register for the latest approvals.</p><a href={safeHref(asset.href)} className="button button-secondary" target="_blank" rel="noreferrer">Open full document<ArrowUpRight size={16} /></a><a href={asset.href ? `${safeHref(asset.href)}?download=1` : undefined} download={asset.fileName || undefined} className="icon-button" aria-label={`Download ${asset.title}`}><DownloadSimple size={19} /></a></div><div className="iframe-wrap">{!loaded && <div className="preview-loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><p>Loading the document…</p></div>}<iframe title={asset.title} src={safeHref(asset.href)} sandbox="allow-scripts allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox" onLoad={() => setLoaded(true)} /></div></Modal>;
}
