'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, ArrowRight, ArrowUpRight, CalendarBlank, CaretLeft, CaretRight, Check, CheckCircle, CheckSquare, Clock, ClockCounterClockwise, Columns, DownloadSimple, FileCode, FileText, FileXls, Flag, FolderOpen, Info, LinkSimple, List, LockSimple, MagnifyingGlass, Plus, SignOut, SpinnerGap, SquaresFour, WarningCircle, X } from '@phosphor-icons/react';
import type { Asset, AuditEvent, Decision, DecisionFields, Mutation, ProjectData, Section, Status, Task, WorkspaceState } from './portalTypes';
import { APPROVAL_STATUSES, csvDownload, decisionPresentation, download, formatDate, humanise, mergeTasks, normaliseDecision, safeHref, shortUrl, STATUSES, STATUS_LABELS } from './portalUtils';
import { ApprovalSelect, Avatar, DecisionDrawer, EmptyState, LoginModal, NewTaskModal, PreviewModal, PriorityBadge, SourceLinks, StatusBadge, TaskDrawer, WorkspaceEntry } from './WorkspaceDialogs';
import './workspace.css';

const NAVIGATION: { id: Section; title: string; icon: typeof SquaresFour }[] = [
  { id: 'overview', title: 'Overview', icon: SquaresFour },
  { id: 'actions', title: 'Actions', icon: CheckSquare },
  { id: 'decisions', title: 'URL decisions', icon: LinkSimple },
  { id: 'documents', title: 'Documents', icon: FolderOpen },
  { id: 'milestones', title: 'Milestones', icon: Flag },
  { id: 'activity', title: 'Activity', icon: ClockCounterClockwise },
];
const PAGE_COPY: Record<Section, { title: string; description: string }> = {
  overview: { title: 'Migration overview', description: 'The decisions, actions, and evidence behind a considered move.' },
  actions: { title: 'Every next step, in one place.', description: 'Track the work, clarify ownership, and keep handovers moving.' },
  decisions: { title: 'A destination for every URL.', description: 'Review the recommendations and record what has actually been approved.' },
  documents: { title: 'The project reference shelf.', description: 'Working spreadsheets, client reports, and the evidence behind the recommendations.' },
  milestones: { title: 'From preparation to launch.', description: 'See the remaining dependencies and the work behind each milestone.' },
  activity: { title: 'A shared record of progress.', description: 'Changes made here, with the person and time behind every update.' },
};

async function responseJson<T>(response: Response): Promise<T> {
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error('The workspace returned an unexpected response. Please try again.'); }
  if (!response.ok) {
    const data = result as { error?: { message?: string } };
    const error = new Error(data.error?.message || 'The workspace could not be loaded. Please try again.');
    Object.assign(error, { status: response.status }); throw error;
  }
  return result as T;
}

export default function MigrationWorkspace() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [section, setSection] = useState<Section>('overview');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [decisionApprovalChoice, setDecisionApprovalChoice] = useState<DecisionFields['approvalStatus'] | undefined>();
  const [login, setLogin] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [decisionSeed, setDecisionSeed] = useState<Decision[] | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [actionsPreset, setActionsPreset] = useState('all');
  const [actionsWorkstream, setActionsWorkstream] = useState('all');

  const clearSession = useCallback(() => {
    setSignedOut(true); setProject(null); setState(null); setDecisionSeed(null); setTaskId(null); setDecisionId(null); setDecisionApprovalChoice(undefined); setPreview(null); setNewTask(false); setLogin(false); setLoading(false); setSyncError(''); setToast(null); setDecisionError(''); setLoadError(''); setPendingAdd(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await responseJson<WorkspaceState>(await fetch('/api/workspace', { cache: 'no-store' }));
      setState(data); setSyncError('');
    } catch (e) { if ((e as Error & { status?: number }).status === 401) clearSession(); throw e; }
  }, [clearSession]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    const results = await Promise.allSettled([
      fetch('/api/project', { cache: 'no-store' }).then(responseJson<ProjectData>),
      fetch('/api/workspace', { cache: 'no-store' }).then(responseJson<WorkspaceState>),
    ]);
    if (results.some(result => result.status === 'rejected' && result.reason?.status === 401)) { clearSession(); return; }
    setSignedOut(false);
    if (results[0].status === 'fulfilled') { setProject(results[0].value); }
    else setLoadError(results[0].reason instanceof Error ? results[0].reason.message : 'Project information could not be loaded.');
    if (results[1].status === 'fulfilled') { setState(results[1].value); setSyncError(''); }
    else setSyncError('Shared updates could not be loaded. You are viewing the source snapshot. Retry to see the latest changes.');
    setLoading(false);
  }, [clearSession]);

  useEffect(() => {
    void fetch('/api/session', { cache: 'no-store' }).then(responseJson<{ session: { canEdit: boolean } }>).then(result => {
      if (result.session.canEdit) return load();
      clearSession();
    }).catch(() => { setLoadError('We couldn’t check your session. Please try again.'); setLoading(false); });
  }, [load, clearSession]);
  useEffect(() => {
    const fromHash = () => { const value = window.location.hash.slice(1) as Section; if (NAVIGATION.some(item => item.id === value)) setSection(value); };
    fromHash(); window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible' && !busy && !signedOut) void refresh().catch(e => { if (e.status !== 401) setSyncError('The shared workspace is temporarily unavailable. Your last loaded view is shown.'); }); };
    const interval = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', check); };
  }, [refresh, busy, signedOut]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), toast.error ? 10000 : 5000); return () => window.clearTimeout(timer); }, [toast]);

  const loadDecisions = useCallback(async () => {
    setDecisionLoading(true); setDecisionError('');
    try {
      const payload = await responseJson<Record<string, unknown>[] | { decisions: Record<string, unknown>[] }>(await fetch('/api/decisions', { cache: 'no-store' }));
      const records = Array.isArray(payload) ? payload : payload.decisions;
      if (!Array.isArray(records)) throw new Error('The URL register format could not be read.');
      setDecisionSeed(records.map(normaliseDecision));
    } catch (e) { if ((e as Error & { status?: number }).status === 401) clearSession(); else setDecisionError(e instanceof Error ? e.message : 'The URL register could not be loaded.'); }
    finally { setDecisionLoading(false); }
  }, [clearSession]);
  useEffect(() => { if (!signedOut && project && section === 'decisions' && !decisionSeed && !decisionLoading && !decisionError) void loadDecisions(); }, [section, decisionSeed, decisionLoading, decisionError, loadDecisions, project, signedOut]);

  const tasks = useMemo(() => project ? mergeTasks(project, state) : [], [project, state]);
  const decisions = useMemo(() => (decisionSeed || []).map(row => ({ ...row, ...state?.decisionOverrides[row.id] })), [decisionSeed, state?.decisionOverrides]);
  const activeTask = tasks.find(task => task.id === taskId);
  const activeDecision = decisions.find(decision => decision.id === decisionId);
  const canEdit = !!state?.session.canEdit && !!state?.persistence.configured && !syncError;
  const doneCount = tasks.filter(task => task.status === 'done').length;
  const approvalCount = Object.values(state?.decisionOverrides || {}).filter(item => item.approvalStatus === 'Approved').length;

  function navigate(value: Section) {
    setSection(value); window.history.replaceState(null, '', `#${value}`); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function openActions(preset = 'all', workstream = 'all') { setActionsPreset(preset); setActionsWorkstream(workstream); navigate('actions'); }
  function openDecision(id: string, approvalStatus?: DecisionFields['approvalStatus']) { setDecisionApprovalChoice(approvalStatus); setDecisionId(id); }
  function closeDecision() { setDecisionId(null); setDecisionApprovalChoice(undefined); }
  async function mutate(payload: Mutation, message = 'Changes saved to the shared workspace.') {
    if (!canEdit) { setLogin(true); throw new Error('Sign in to edit the shared workspace.'); }
    setBusy(true);
    try {
      const result = await responseJson<WorkspaceState>(await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
      setState(result); setSyncError(''); setToast({ message, error: false }); return result;
    } catch (e) {
      const error = e as Error & { status?: number };
      if (error.status === 409) { await refresh().catch(() => {}); }
      if (error.status === 401 || error.status === 403) { await refresh().catch(() => {}); }
      setToast({ message: error.message || 'The changes could not be saved. Please try again.', error: true }); throw e;
    } finally { setBusy(false); }
  }
  async function manualRefresh() { setRefreshing(true); try { await refresh(); setToast({ message: 'You’re viewing the latest shared updates.', error: false }); } catch (e) { setSyncError(e instanceof Error ? e.message : 'Shared updates could not be loaded.'); } finally { setRefreshing(false); } }
  function addTask() { if (canEdit) setNewTask(true); else { setPendingAdd(true); setLogin(true); } }
  async function signOut() {
    try { await responseJson(await fetch('/api/session', { method: 'DELETE' })); clearSession(); }
    catch (e) { setToast({ message: e instanceof Error ? e.message : 'We could not sign you out. Please try again.', error: true }); }
  }
  async function exportBackup() {
    if (!project) return;
    try {
      const [latest, originalDecisions] = await Promise.all([
        fetch('/api/workspace?activity=all', { cache: 'no-store' }).then(responseJson<WorkspaceState>),
        decisionSeed ? Promise.resolve(decisionSeed.map(d => d.raw)) : fetch('/api/decisions', { cache: 'no-store' }).then(responseJson<Record<string, unknown>[]>),
      ]);
      setState({ ...latest, activity: latest.activity.slice(0, 200) });
      const { session: _session, ...exportState } = latest;
      download(`Postalytics_Workspace_Backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), project, workspace: exportState, tasks: mergeTasks(project, latest), originalDecisions, note: 'Contains source project data, original URL proposals, all current shared overrides, and the complete audit history.' }, null, 2), 'application/json');
      setToast({ message: 'Current workspace backup downloaded.', error: false });
    } catch (e) { setToast({ message: e instanceof Error ? e.message : 'The backup could not be created.', error: true }); }
  }

  if (signedOut) return <WorkspaceEntry onSuccess={load} />;
  if (loading) return <div className="boot-screen" aria-busy="true"><div className="boot-logo">postalytics<ArrowUpRight size={30} weight="bold" /></div><p>Opening the migration workspace</p><div className="boot-grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>;
  if (loadError || !project) return <div className="boot-screen"><WarningCircle size={36} /><h1>We couldn’t open the workspace.</h1><p>{loadError || 'Project data is unavailable.'}</p><button className="button button-primary" onClick={() => void load()}><ArrowClockwise size={18} />Try again</button></div>;

  return <div className="workspace-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('overview')} aria-label="Postalytics migration overview"><span className="brand-wordmark">postalytics</span><ArrowUpRight size={26} weight="bold" /></button>
      <div className="project-label"><span className="project-initial">P</span><div><strong>Website migration</strong><span>Postalytics × MADX</span></div></div>
      <p className="sidebar-label">Workspace</p>
      <nav className="main-nav" aria-label="Workspace sections">{NAVIGATION.map(item => <button key={item.id} onClick={() => navigate(item.id)} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined}><item.icon size={20} weight={section === item.id ? 'fill' : 'regular'} /><span>{item.title}</span>{item.id === 'actions' && <span className="nav-count">{tasks.filter(t => t.status !== 'done').length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="source-stamp"><span className="eyebrow">Source snapshot</span><strong>{formatDate(project.project.snapshotDate)}</strong><p>Portal changes are shared here. ClickUp is tracked separately.</p></div><button className="sidebar-export" onClick={() => void exportBackup()}><DownloadSimple size={17} />Export workspace</button><div className="madx-credit"><span>MADX</span><span>Migration management</span></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Postalytics</span><CaretRight size={13} /><strong>{NAVIGATION.find(item => item.id === section)?.title}</strong></div><div className="topbar-actions"><span className={`sync-status ${syncError || !state?.persistence.configured ? 'is-warning' : ''}`} aria-live="polite">{busy ? <SpinnerGap size={15} className="spin" /> : syncError || !state?.persistence.configured ? <WarningCircle size={15} /> : <CheckCircle size={15} />}{busy ? 'Saving…' : syncError ? 'Connection issue' : state?.persistence.configured ? 'Shared workspace' : 'Source snapshot'}</span><button className="icon-button refresh-button" title="Refresh shared updates" aria-label="Refresh shared updates" onClick={() => void manualRefresh()} disabled={refreshing || busy}><ArrowClockwise size={17} className={refreshing ? 'spin' : ''} /></button>{state?.session.canEdit ? <button className="session-button" onClick={() => void signOut()} disabled={busy} title="Sign out of the workspace"><Avatar name={state.session.name || ''} showName={false} /><span>{state.session.name}</span><SignOut size={17} /></button> : <button className="button button-secondary edit-button" onClick={() => setLogin(true)}><LockSimple size={15} />Edit workspace</button>}</div></header>
      <main id="main-content" className={`main-content section-${section}`}>
        {syncError && <div className="connection-banner" role="alert"><WarningCircle size={19} /><p>{syncError}</p><button onClick={() => void manualRefresh()} className="inline-button">Retry</button></div>}
        {state && !state.persistence.configured && !syncError && <div className="connection-banner"><Info size={19} /><p>{state.persistence.message || 'Shared editing is not configured yet. The source snapshot and documents remain available.'}</p></div>}
        <div className="page-header"><div><p className="eyebrow">{section === 'overview' ? 'Postalytics website migration' : NAVIGATION.find(item => item.id === section)?.title}</p><h1>{PAGE_COPY[section].title}</h1><p className="page-description">{PAGE_COPY[section].description}</p></div><div className="page-header-action">{section === 'overview' || section === 'actions' ? <button className="button button-primary" onClick={addTask}><Plus size={18} />Add action</button> : section === 'activity' ? <button className="button button-secondary" onClick={() => void exportBackup()}><DownloadSimple size={17} />Export workspace</button> : null}</div></div>
        {section === 'overview' && <Overview project={project} tasks={tasks} approvalCount={approvalCount} doneCount={doneCount} activity={state?.activity || []} onTask={setTaskId} onActions={openActions} onNavigate={navigate} onPreview={setPreview} />}
        {section === 'actions' && <ActionsView key={`${actionsPreset}-${actionsWorkstream}`} project={project} tasks={tasks} initialPreset={actionsPreset} initialWorkstream={actionsWorkstream} onTask={setTaskId} onAdd={addTask} />}
        {section === 'decisions' && <DecisionsView decisions={decisions} loading={decisionLoading} error={decisionError} onRetry={() => void loadDecisions()} onDecision={openDecision} onApproval={openDecision} canEdit={canEdit && !busy} project={project} />}
        {section === 'documents' && <DocumentsView project={project} onPreview={setPreview} />}
        {section === 'milestones' && <MilestonesView project={project} tasks={tasks} onTask={setTaskId} onActions={openActions} />}
        {section === 'activity' && <ActivityView activity={state?.activity || []} total={state?.activityTotal} tasks={tasks} onTask={setTaskId} onDecision={id => { openDecision(id); navigate('decisions'); }} />}
        <footer className="workspace-footer"><p>Prepared by MADX for Postalytics.</p><span>Source baseline: {formatDate(project.project.snapshotDate)} · Decisions remain proposals until recorded as approved.</span></footer>
      </main>
    </div>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <WarningCircle size={21} /> : <CheckCircle size={21} />}<span>{toast.message}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16} /></button></div>}
    {activeTask && <TaskDrawer key={activeTask.id} task={activeTask} tasks={tasks} workstreams={project.workstreams} canEdit={canEdit} busy={busy} mutate={mutate} onClose={() => setTaskId(null)} onLogin={() => setLogin(true)} onTask={setTaskId} />}
    {activeDecision && <DecisionDrawer key={activeDecision.id} decision={activeDecision} initialApprovalStatus={decisionApprovalChoice} canEdit={canEdit} busy={busy} mutate={mutate} onClose={closeDecision} onLogin={() => setLogin(true)} />}
    {preview && <PreviewModal asset={preview} onClose={() => setPreview(null)} />}
    {login && <LoginModal onClose={() => { setLogin(false); setPendingAdd(false); }} onSuccess={async () => { await refresh(); if (pendingAdd) { setNewTask(true); setPendingAdd(false); } }} />}
    {newTask && canEdit && <NewTaskModal project={project} tasks={tasks} busy={busy} mutate={mutate} onClose={() => setNewTask(false)} />}
  </div>;
}

function Overview({ project, tasks, approvalCount, doneCount, activity, onTask, onActions, onNavigate, onPreview }: {
  project: ProjectData; tasks: Task[]; approvalCount: number; doneCount: number; activity: AuditEvent[];
  onTask: (id: string) => void; onActions: (preset?: string, workstream?: string) => void; onNavigate: (section: Section) => void; onPreview: (asset: Asset) => void;
}) {
  const openTasks = tasks.filter(t => t.status !== 'done');
  const reviewTasks = tasks.filter(t => t.status === 'review' || t.status === 'blocked');
  const nextTasks = [...openTasks].sort((a, b) => {
    const aDeps = a.dependencies.filter(id => tasks.find(t => t.id === id)?.status !== 'done').length;
    const bDeps = b.dependencies.filter(id => tasks.find(t => t.id === id)?.status !== 'done').length;
    const score = (t: Task, deps: number) => (t.priority === 'high' ? 0 : t.priority === 'medium' ? 3 : 6) + (t.status === 'in_progress' ? -3 : t.status === 'review' ? -2 : 0) + Math.min(deps, 4);
    return score(a, aDeps) - score(b, bDeps);
  }).slice(0, 5);
  const attentionTasks = reviewTasks.length ? reviewTasks.slice(0, 3) : openTasks.filter(t => /approv|confirm|client/i.test(t.title)).slice(0, 3);
  const featuredAssets = project.assets.filter(a => /html/i.test(a.kind) || /\.html$/i.test(a.href || '')).slice(0, 2);
  const totalUrls = project.metrics.combinedUrlCount || 0;
  const pageUrls = project.metrics.pageDecisionCount || 0;
  return <>
    <div className="overview-intro"><div><span className="status-badge status-review"><span />Decisions before implementation</span><h2>The groundwork is here.<br />Let’s agree the move.</h2><p>{project.project.currentFocus || project.project.description}</p><button className="text-link" onClick={() => onNavigate('decisions')}>Review URL decisions<ArrowRight size={17} /></button></div><div className="intro-register"><span className="eyebrow">Current reconciliation</span><div className="intro-number">{pageUrls.toLocaleString()}<span>published pages<br />to review</span></div><div className="intro-divider" /><p>Within a register of <strong>{totalUrls.toLocaleString()} URL entries</strong>, including variants and service dependencies.</p><span className="fine-print">Recommendations prepared {formatDate(project.project.snapshotDate)}</span></div></div>
    <div className="metrics-row"><Metric label="Actions complete" value={String(doneCount).padStart(2, '0')} suffix={`/ ${tasks.length}`} note="Task completion, not launch readiness" icon={<CheckSquare size={20} />} onClick={() => onActions('done')} /><Metric label="Need review or unblocking" value={String(reviewTasks.length).padStart(2, '0')} note="Decisions that help the team move" icon={<Flag size={20} />} onClick={() => onActions('attention')} /><Metric label="URL approvals recorded" value={String(approvalCount).padStart(2, '0')} suffix={`/ ${totalUrls.toLocaleString()}`} note="Approval evidence lives with each URL" icon={<LinkSimple size={20} />} onClick={() => onNavigate('decisions')} /><Metric label="Project documents" value={String(project.assets.length).padStart(2, '0')} note="Reports, workbooks, and source files" icon={<FolderOpen size={20} />} onClick={() => onNavigate('documents')} /></div>
    <div className="overview-grid"><section className="panel next-actions"><div className="section-heading"><div><h2>Next actions</h2><p>The immediate work to keep things moving.</p></div><button className="text-link" onClick={() => onActions()}>All actions<ArrowRight size={15} /></button></div><div className="action-preview-list">{nextTasks.map((task, index) => <button className="action-preview" key={task.id} onClick={() => onTask(task.id)}><span className="action-number">{String(index + 1).padStart(2, '0')}</span><span className="action-preview-main"><strong>{task.title}</strong><span>{project.workstreams.find(w => w.id === task.workstreamId)?.title}<span className="dot-separator">·</span>{task.owner || 'Owner to confirm'}</span></span><StatusBadge status={task.status} /><ArrowUpRight size={17} className="row-arrow" /></button>)}</div>{!nextTasks.length && <EmptyState title="Every action is complete" description="Add another action as new work is agreed." />}</section>
      <section className="attention-panel"><div className="section-heading"><div className="attention-title"><Flag size={20} /><h2>Needs your input</h2></div></div><p className="attention-intro">A few clear decisions will unlock the next stage.</p><div className="attention-list">{attentionTasks.map(task => <button key={task.id} onClick={() => onTask(task.id)}><span>{task.title}</span><ArrowUpRight size={17} /></button>)}</div><div className="attention-footer"><Info size={17} /><p>Commercial priorities and final page destinations need client confirmation.</p></div></section>
      <section className="panel workstream-panel"><div className="section-heading"><div><h2>Workstreams</h2><p>Progress across the migration plan.</p></div><button className="text-link" onClick={() => onNavigate('milestones')}>Milestones<ArrowRight size={15} /></button></div><div className="workstream-grid">{project.workstreams.slice().sort((a, b) => a.order - b.order).map((workstream, index) => { const entries = tasks.filter(t => t.workstreamId === workstream.id); const completed = entries.filter(t => t.status === 'done').length; return <button className="workstream-item" key={workstream.id} onClick={() => onActions('all', workstream.id)}><div><span className="workstream-index">{String(index + 1).padStart(2, '0')}</span><h3>{workstream.title}</h3><ArrowUpRight size={14} /></div><div className="progress-track" role="progressbar" aria-label={`${workstream.title} task completion`} aria-valuemin={0} aria-valuemax={entries.length || 1} aria-valuenow={completed}><span style={{ width: `${entries.length ? completed / entries.length * 100 : 0}%` }} /></div><p><strong>{completed}/{entries.length}</strong> actions complete<span>{entries.filter(t => t.status === 'blocked').length ? `${entries.filter(t => t.status === 'blocked').length} blocked` : entries.some(t => t.status === 'review') ? 'Review needed' : entries.length && completed === entries.length ? 'Complete' : 'In the plan'}</span></p></button>; })}</div></section>
      <section className="reference-panel"><div className="section-heading"><h2>Start with the evidence</h2><FolderOpen size={20} /></div><p>Client reports and working sheets, together in one place.</p><div className="featured-documents">{featuredAssets.map(asset => <button key={asset.id} onClick={() => onPreview(asset)}><FileText size={23} /><span><strong>{asset.title}</strong><small>Read the client report</small></span><ArrowUpRight size={17} /></button>)}</div><button className="button button-secondary" onClick={() => onNavigate('documents')}>Browse all documents<ArrowRight size={16} /></button></section>
    </div>
    <section className="overview-bottom"><div><ClockCounterClockwise size={20} /><h2>Latest workspace updates</h2></div>{activity.length ? <div className="recent-events">{activity.slice(0, 3).map(event => <div key={event.id}><span>{event.summary || humanise(String(event.type || event.action || 'Workspace updated'))}</span><small>{event.actor || 'Project team'} · {formatDate(event.at || event.createdAt || event.timestamp, true)}</small></div>)}</div> : <p>Changes made in this workspace will appear here. The source snapshot is dated {formatDate(project.project.snapshotDate)}.</p>}<button className="text-link" onClick={() => onNavigate('activity')}>View activity<ArrowRight size={15} /></button></section>
  </>;
}

function Metric({ label, value, suffix, note, icon, onClick }: { label: string; value: string; suffix?: string; note: string; icon: React.ReactNode; onClick: () => void }) {
  return <button className="metric" onClick={onClick}><div className="metric-top"><span>{label}</span>{icon}</div><div className="metric-value">{value}{suffix && <small>{suffix}</small>}</div><p>{note}</p></button>;
}

function ActionsView({ project, tasks, initialPreset, initialWorkstream, onTask, onAdd }: { project: ProjectData; tasks: Task[]; initialPreset: string; initialWorkstream: string; onTask: (id: string) => void; onAdd: () => void }) {
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState(initialPreset);
  const [workstream, setWorkstream] = useState(initialWorkstream);
  const [owner, setOwner] = useState('all');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [sort, setSort] = useState('priority');
  const owners = Array.from(new Set(tasks.map(task => task.owner || 'Unassigned'))).sort();
  const counts = { all: tasks.length, open: tasks.filter(t => t.status !== 'done').length, attention: tasks.filter(t => ['review', 'blocked'].includes(t.status)).length, done: tasks.filter(t => t.status === 'done').length };
  const filtered = useMemo(() => tasks.filter(task => {
    const query = search.toLocaleLowerCase().trim();
    return (!query || `${task.title} ${task.description} ${task.owner} ${task.id}`.toLowerCase().includes(query)) &&
      (workstream === 'all' || task.workstreamId === workstream) && (owner === 'all' || (task.owner || 'Unassigned') === owner) &&
      (status === 'all' || task.status === status) && (priority === 'all' || task.priority === priority) &&
      (preset === 'all' || preset === 'open' && task.status !== 'done' || preset === 'attention' && ['review', 'blocked'].includes(task.status) || preset === 'done' && task.status === 'done');
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'due' ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999') : ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || Number(a.status === 'done') - Number(b.status === 'done')), [tasks, search, workstream, owner, status, priority, preset, sort]);
  function reset() { setSearch(''); setPreset('all'); setWorkstream('all'); setOwner('all'); setStatus('all'); setPriority('all'); }
  function exportActions() { csvDownload('Postalytics_Current_Actions.csv', filtered.map(task => ({ ID: task.id, Action: task.title, Description: task.description, Workstream: project.workstreams.find(w => w.id === task.workstreamId)?.title || task.workstreamId, Status: STATUS_LABELS[task.status], Priority: task.priority, Owner: task.owner, 'Due date': task.dueDate, 'Checklist complete': task.subtasks.filter(s => s.done).length, 'Checklist total': task.subtasks.length, 'Source status': task.sourceStatus, 'Source checked': task.sourceCheckedAt, 'Updated by': task.updatedBy || '', 'Updated at': task.updatedAt || '', 'Source links': task.sourceLinks.map(s => s.url).join(' | ') }))); }
  return <><div className="list-tabs"><div className="tab-group">{[['all', 'All actions'], ['open', 'Open'], ['attention', 'Needs attention'], ['done', 'Completed']].map(([value, label]) => <button key={value} className={preset === value ? 'selected' : ''} onClick={() => setPreset(value)}>{label}<span>{counts[value as keyof typeof counts]}</span></button>)}</div><div className="view-switch" aria-label="Action view"><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')} aria-label="List view" aria-pressed={view === 'list'}><List size={18} /></button><button className={view === 'board' ? 'selected' : ''} onClick={() => setView('board')} aria-label="Board view" aria-pressed={view === 'board'}><Columns size={18} /></button></div></div>
    <div className="filter-bar"><label className="search-field"><MagnifyingGlass size={18} /><span className="sr-only">Search actions</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search actions…" /></label><label><span className="sr-only">Filter by workstream</span><select value={workstream} onChange={e => setWorkstream(e.target.value)}><option value="all">All workstreams</option>{project.workstreams.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label><label><span className="sr-only">Filter by owner</span><select value={owner} onChange={e => setOwner(e.target.value)}><option value="all">All owners</option>{owners.map(o => <option key={o}>{o}</option>)}</select></label><label><span className="sr-only">Filter by status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option value={s} key={s}>{STATUS_LABELS[s]}</option>)}</select></label><label><span className="sr-only">Filter by priority</span><select value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></label><button className="icon-button export-filtered" onClick={exportActions} disabled={!filtered.length} aria-label="Export filtered actions as CSV" title="Export filtered actions as CSV"><DownloadSimple size={19} /></button></div>
    <div className="results-bar"><p><strong>{filtered.length}</strong> {filtered.length === 1 ? 'action' : 'actions'}{filtered.length !== tasks.length ? ` of ${tasks.length}` : ''}{(search || workstream !== 'all' || owner !== 'all' || status !== 'all' || priority !== 'all') && <button className="inline-button" onClick={reset}>Clear filters</button>}</p><label>Sort by <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort actions"><option value="priority">Priority</option><option value="due">Due date</option><option value="title">Title</option></select></label></div>
    {!filtered.length ? <div className="panel"><EmptyState title="No actions match this view" description="Try another search or clear the filters to see the full migration plan." action={<button className="button button-secondary" onClick={reset}>Clear filters</button>} /></div> : view === 'list' ? <div className="table-container"><table className="actions-table"><thead><tr><th>Action</th><th>Owner</th><th>Status</th><th>Due date</th><th><span className="sr-only">Open action</span></th></tr></thead><tbody>{filtered.map(task => <tr key={task.id}><td><button className="table-task" onClick={() => onTask(task.id)}><span className={`task-check ${task.status === 'done' ? 'complete' : ''}`}>{task.status === 'done' ? <Check size={13} weight="bold" /> : null}</span><span><strong>{task.title}</strong><span className="table-subline">{project.workstreams.find(w => w.id === task.workstreamId)?.title}<span className="dot-separator">·</span><PriorityBadge priority={task.priority} />{task.subtasks.length > 0 && <span className="checklist-count"><CheckSquare size={13} />{task.subtasks.filter(s => s.done).length}/{task.subtasks.length}</span>}</span></span></button></td><td><Avatar name={task.owner} /></td><td><StatusBadge status={task.status} /></td><td><span className={`due-label ${task.dueDate ? '' : 'muted'}`}>{task.dueDate ? formatDate(task.dueDate) : 'Not set'}</span></td><td><button className="icon-button" onClick={() => onTask(task.id)} aria-label={`Open ${task.title}`}><ArrowUpRight size={18} /></button></td></tr>)}</tbody></table><div className="mobile-action-list">{filtered.map(task => <button key={task.id} onClick={() => onTask(task.id)}><div><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div><strong>{task.title}</strong><span className="muted small">{project.workstreams.find(w => w.id === task.workstreamId)?.title}</span><div><Avatar name={task.owner} /><span className="due-label">{task.dueDate ? formatDate(task.dueDate) : 'No due date'}</span></div></button>)}</div></div> : <div className="kanban-board">{STATUSES.map(boardStatus => { const entries = filtered.filter(t => t.status === boardStatus); return <section key={boardStatus} className={`kanban-column kanban-${boardStatus}`}><div className="kanban-heading"><StatusBadge status={boardStatus} /><span>{entries.length}</span></div><div className="kanban-cards">{entries.map(task => <button key={task.id} className="kanban-card" onClick={() => onTask(task.id)}><p className="kanban-workstream">{project.workstreams.find(w => w.id === task.workstreamId)?.title}</p><h3>{task.title}</h3><PriorityBadge priority={task.priority} /><div><Avatar name={task.owner} showName={false} /><span>{task.subtasks.length ? <><CheckSquare size={13} />{task.subtasks.filter(s => s.done).length}/{task.subtasks.length}</> : null}{task.dueDate ? <><CalendarBlank size={13} />{formatDate(task.dueDate)}</> : null}</span></div></button>)}{!entries.length && <div className="kanban-empty">No actions in this status</div>}</div></section>; })}</div>}
    <div className="source-footnote"><Info size={17} /><p>ClickUp statuses were checked on {formatDate(project.project.snapshotDate)}. Updates made here are saved to this workspace; they do not update ClickUp.</p><button className="text-link" onClick={onAdd}>Add action<Plus size={14} /></button></div>
  </>;
}

function DecisionDestination({ decision }: { decision: Decision }) {
  const view = decisionPresentation(decision);
  return <>{view.retired ? <span className="destination-text">No destination · 410 retirement</span> : view.target ? <span className="destination-text" title={view.target}>{view.target === decision.url ? <span className="same-url"><Check size={13} />Same URL</span> : shortUrl(view.target)}</span> : <span className="target-unresolved">To be confirmed</span>}{view.approved && view.target !== decision.proposedTarget && <small className="cell-subtext proposal-context">Proposed: {decision.proposedTarget ? shortUrl(decision.proposedTarget) : 'Target to confirm'}</small>}</>;
}

type DecisionReviewControls = { onDecision: (id: string) => void; onApproval: (id: string, status: DecisionFields['approvalStatus']) => void; canEdit: boolean };

function DecisionTableRow({ decision: d, onDecision, onApproval, canEdit }: { decision: Decision } & DecisionReviewControls) {
  const view = decisionPresentation(d);
  return <tr data-decision-id={d.id}>
    <td><button className="decision-link" onClick={() => onDecision(d.id)}><span className="record-id">{d.id}</span><strong title={d.url}>{shortUrl(d.url)}</strong><small>{d.title || d.group || d.role}</small></button></td>
    <td><span className={`treatment-basis ${view.approved ? 'is-approved' : ''}`}>{view.approved ? 'Approved action' : 'Proposed action'}</span><span className="action-treatment">{view.action || 'Classification required'}</span>{view.approved && view.action !== d.proposedAction ? <small className="cell-subtext">Proposed: {d.proposedAction || 'Classification required'}</small> : d.role && <small className="cell-subtext">{d.role}</small>}</td>
    <td><span className={`treatment-basis ${view.approved ? 'is-approved' : ''}`}>{view.approved ? 'Approved destination' : 'Proposed destination'}</span><DecisionDestination decision={d} /></td>
    <td><ApprovalSelect decision={d} disabled={!canEdit} onChoose={onApproval} />{d.updatedBy && <span className="cell-subtext">Updated by {d.updatedBy}</span>}</td>
    <td><button className="icon-button" aria-label={`Review ${d.id}`} onClick={() => onDecision(d.id)}><ArrowUpRight size={17} /></button></td>
  </tr>;
}

function DecisionMobileCard({ decision: d, onDecision, onApproval, canEdit }: { decision: Decision } & DecisionReviewControls) {
  const view = decisionPresentation(d);
  return <article className="mobile-decision-card" data-decision-id={d.id}>
    <div className="mobile-decision-heading"><span className="record-id">{d.id}</span><ApprovalSelect decision={d} disabled={!canEdit} onChoose={onApproval} /></div>
    <button className="mobile-decision-review" onClick={() => onDecision(d.id)} aria-label={`Review ${d.id}`}><strong>{shortUrl(d.url)}</strong><span>{d.title || d.role}</span><div className="mobile-treatment"><div><span className={`treatment-basis ${view.approved ? 'is-approved' : ''}`}>{view.approved ? 'Approved action' : 'Proposed action'}</span><span>{view.action || 'Classification required'}</span></div><ArrowRight size={16} /><div><span className={`treatment-basis ${view.approved ? 'is-approved' : ''}`}>{view.approved ? 'Approved destination' : 'Proposed destination'}</span><DecisionDestination decision={d} /></div></div><span className="mobile-review-label">Review details<ArrowUpRight size={14} /></span></button>
  </article>;
}

function DecisionsView({ decisions, loading, error, onRetry, onDecision, onApproval, canEdit, project }: { decisions: Decision[]; loading: boolean; error: string; onRetry: () => void; project: ProjectData } & DecisionReviewControls) {
  const [scope, setScope] = useState('pages');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [action, setAction] = useState('all');
  const [approval, setApproval] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const roles = Array.from(new Set(decisions.map(d => d.role).filter(Boolean))).sort();
  const actions = Array.from(new Set(decisions.map(d => d.proposedAction).filter(Boolean))).sort();
  const filtered = useMemo(() => decisions.filter(d => {
    const query = search.toLowerCase().trim();
    return (scope !== 'pages' || d.isPage) && (scope !== 'unresolved' || decisionPresentation(d).targetToConfirm) && (!query || `${d.id} ${d.url} ${d.title} ${d.proposedTarget} ${d.approvedTarget} ${d.approver} ${d.notes} ${d.rationale}`.toLowerCase().includes(query)) && (role === 'all' || d.role === role) && (action === 'all' || d.proposedAction === action) && (approval === 'all' || d.approvalStatus === approval);
  }), [decisions, scope, search, role, action, approval]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [search, scope, role, action, approval, pageSize]);
  function reset() { setSearch(''); setRole('all'); setAction('all'); setApproval('all'); }
  function exportRows() { csvDownload(`Postalytics_URL_Decisions_${scope}.csv`, filtered.map(d => ({ Reference: d.id, 'Current URL': d.url, 'Page title': d.title, Classification: d.role, 'Page group': d.group, 'Proposed action': d.proposedAction, 'Proposed destination': d.proposedTarget, Rationale: d.rationale, 'Client question': d.question, Dependency: d.dependency, 'Approval status': d.approvalStatus, 'Approved action': d.approvedAction, 'Approved destination': d.approvedTarget, Approver: d.approver, 'Approval date': d.approvalDate, Evidence: d.evidence, Notes: d.notes, 'Conditions confirmed': d.conditionsConfirmed, 'Updated by': d.updatedBy || '', 'Updated at': d.updatedAt || '' }))); }
  if (loading) return <div className="register-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><p>Loading the URL register…</p></div>;
  if (error) return <div className="panel"><EmptyState title="The URL register could not be loaded" description={error} action={<button className="button button-primary" onClick={onRetry}><ArrowClockwise size={17} />Try again</button>} /></div>;
  return <><div className="register-note"><Info size={22} /><div><h2>Review the {decisions.filter(d => d.isPage).length.toLocaleString()} published pages first.</h2><p>The complete register contains {decisions.length.toLocaleString()} exact URL entries, including archives, variants, blog records, and service dependencies. These are reconciliation records, not a content import count.</p></div><span className="register-note-count"><strong>{decisions.filter(d => d.approvalStatus === 'Approved').length}</strong> approvals recorded</span></div>
    <div className="list-tabs"><div className="tab-group">{[['pages', 'Published nonblog pages', String(decisions.filter(d => d.isPage).length)], ['all', 'Complete register', decisions.length.toLocaleString()], ['unresolved', 'Page targets to confirm', String(decisions.filter(d => decisionPresentation(d).targetToConfirm).length)]].map(([value, label, count]) => <button className={scope === value ? 'selected' : ''} key={value} onClick={() => { setScope(value); setRole('all'); setAction('all'); }}>{label}<span>{count}</span></button>)}</div><button className="button button-secondary compact-button" onClick={exportRows} disabled={!filtered.length}><DownloadSimple size={17} />Export view</button></div>
    <div className="filter-bar decision-filters"><label className="search-field"><MagnifyingGlass size={18} /><span className="sr-only">Search URL decisions</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search URL, destination, title, or reference…" /></label><label><span className="sr-only">Filter by proposed action</span><select value={action} onChange={e => setAction(e.target.value)}><option value="all">All proposed actions</option>{actions.map(a => <option key={a}>{a}</option>)}</select></label><label><span className="sr-only">Filter by approval status</span><select value={approval} onChange={e => setApproval(e.target.value)}><option value="all">All approval statuses</option>{APPROVAL_STATUSES.map(s => <option value={s} key={s}>{s}</option>)}</select></label>{scope === 'all' && <label><span className="sr-only">Filter by classification</span><select value={role} onChange={e => setRole(e.target.value)}><option value="all">All classifications</option>{roles.map(r => <option key={r}>{r}</option>)}</select></label>}</div>
    <p className="approval-edit-instructions" id="approval-edit-instructions"><Info size={16} />Choose an approval status to open the editor. Select Save decision to record your changes.</p>
    <div className="results-bar"><p><strong>{filtered.length.toLocaleString()}</strong> matching entries{(search || role !== 'all' || action !== 'all' || approval !== 'all') && <button className="inline-button" onClick={reset}>Clear filters</button>}</p><span className="muted small">Proposals prepared {formatDate(project.project.snapshotDate)}</span></div>
    {filtered.length ? <div className="table-container decisions-container"><table className="decisions-table"><thead><tr><th>Current URL / page</th><th>Migration action</th><th>Destination</th><th>Approval · edit</th><th><span className="sr-only">Open decision</span></th></tr></thead><tbody>{pageRows.map(d => <DecisionTableRow key={d.id} decision={d} onDecision={onDecision} onApproval={onApproval} canEdit={canEdit} />)}</tbody></table><div className="mobile-decision-list">{pageRows.map(d => <DecisionMobileCard key={d.id} decision={d} onDecision={onDecision} onApproval={onApproval} canEdit={canEdit} />)}</div><div className="pagination"><p>{((currentPage - 1) * pageSize + 1).toLocaleString()}–{Math.min(currentPage * pageSize, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</p><div><label><span className="sr-only">Rows per page</span><select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option value={25}>25 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option></select></label><button className="icon-button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page"><CaretLeft size={18} /></button><span>{currentPage} / {pageCount}</span><button className="icon-button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page"><CaretRight size={18} /></button></div></div></div> : <div className="panel"><EmptyState title="No URLs match these filters" description="Try a shorter URL, another classification, or clear the filters." action={<button className="button button-secondary" onClick={reset}>Clear filters</button>} /></div>}
    <div className="decision-context"><div><h3>The blog decisions are a separate input</h3><p>The existing client blog disposition sheet still needs to be merged into the {(project.metrics.blogArticleCount || 0).toLocaleString()} published blog records. Its keep, consolidate, and drop decisions have not been invented here.</p></div><div><h3>Approval stays explicit</h3><p>The source workbook had no approved destinations recorded. An approval here requires a named approver, a date, evidence, and confirmed implementation dependencies.</p></div></div>
    <SourceLinks links={project.sources.filter(s => /reconcil|16 october/i.test(s.title)).map(s => ({ label: s.title, url: s.url }))} />
  </>;
}

function DocumentsView({ project, onPreview }: { project: ProjectData; onPreview: (asset: Asset) => void }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [workstream, setWorkstream] = useState('all');
  const kinds = Array.from(new Set(project.assets.map(a => a.kind))).sort();
  const assets = project.assets.filter(asset => (kind === 'all' || asset.kind === kind) && (workstream === 'all' || asset.workstreamId === workstream) && `${asset.title} ${asset.description} ${asset.fileName}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <><div className="document-intro"><FileText size={29} /><p><strong>Use the reports to review the thinking. Use the working sheets to check the detail.</strong> Decisions recorded in this workspace are separate from the original files; export the current URL view to include the latest approvals.</p></div><div className="filter-bar"><label className="search-field"><MagnifyingGlass size={18} /><span className="sr-only">Search documents</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a report, workbook, or source…" /></label><label><span className="sr-only">Filter by document type</span><select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All file types</option>{kinds.map(k => <option key={k}>{k}</option>)}</select></label><label><span className="sr-only">Filter documents by workstream</span><select value={workstream} onChange={e => setWorkstream(e.target.value)}><option value="all">All workstreams</option>{project.workstreams.filter(w => project.assets.some(a => a.workstreamId === w.id)).map(w => <option value={w.id} key={w.id}>{w.title}</option>)}</select></label></div><div className="results-bar"><p><strong>{assets.length}</strong> documents</p><span className="muted small">Original files preserved as reference assets</span></div>
    {assets.length ? <div className="document-grid">{assets.map(asset => { const isHtml = /html/i.test(asset.kind) || /\.html$/i.test(asset.href || ''); const isSheet = /xlsx|spreadsheet|workbook|csv/i.test(asset.kind) || /\.(xlsx|csv)$/i.test(asset.href || ''); const isExternal = asset.kind === 'link'; const available = !!safeHref(asset.href); return <article className={`document-card ${isHtml ? 'is-report' : ''}`} key={asset.id}><div className="document-card-top"><div className={`file-icon ${isSheet ? 'sheet-icon' : isHtml ? 'html-icon' : ''}`}>{isSheet ? <FileXls size={26} /> : isHtml ? <FileCode size={26} /> : <FileText size={26} />}</div><span className="file-type">{asset.kind === 'link' ? 'Source' : asset.kind}</span></div><div className="document-main"><p className="document-workstream">{project.workstreams.find(w => w.id === asset.workstreamId)?.title || 'Project reference'}</p><h2>{asset.title}</h2><p>{asset.description}</p></div>{asset.status && <span className="document-status">{humanise(asset.status)}</span>}{asset.notes && <p className="document-note">{asset.notes}</p>}<div className="document-bottom"><span>{formatDate(asset.updatedAt)}</span><div>{available && isHtml && <button className="text-link" onClick={() => onPreview(asset)}>Read report<ArrowUpRight size={15} /></button>}{available ? isExternal ? <a className="button button-secondary compact-button" href={safeHref(asset.href)} target="_blank" rel="noreferrer">Open source<ArrowUpRight size={16} /></a> : <a className={isHtml ? 'icon-button' : 'button button-secondary compact-button'} href={asset.href ? `${safeHref(asset.href)}?download=1` : undefined} download={asset.fileName || undefined} aria-label={`Download ${asset.title}`}><DownloadSimple size={17} />{!isHtml && 'Download'}</a> : <span className="asset-unavailable"><Clock size={15} />Awaiting client file</span>}</div></div></article>; })}</div> : <div className="panel"><EmptyState title="No documents found" description="Try another search or file type." action={<button className="button button-secondary" onClick={() => { setSearch(''); setKind('all'); setWorkstream('all'); }}>Clear filters</button>} /></div>}
    <section className="source-library"><div className="section-heading"><div><h2>Project sources</h2><p>Follow the source conversation or task board for its original context.</p></div></div><div>{project.sources.map(source => <a key={source.id} href={safeHref(source.url)} target="_blank" rel="noreferrer"><span><strong>{source.title}</strong><small>{source.description}</small></span><ArrowUpRight size={18} /></a>)}</div></section>
  </>;
}

function MilestonesView({ project, tasks, onTask, onActions }: { project: ProjectData; tasks: Task[]; onTask: (id: string) => void; onActions: (preset?: string, workstream?: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(project.milestones[0]?.id || null);
  return <><div className="milestone-note"><CalendarBlank size={23} /><div><strong>Readiness is earned through the work.</strong><p>Milestones below reflect their linked actions. Dates remain to be agreed unless an explicit deadline is recorded.</p></div></div><div className="milestone-list">{project.milestones.map((milestone, index) => {
    const linked = milestone.taskIds.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
    const done = linked.filter(t => t.status === 'done').length;
    const allDone = linked.length > 0 && done === linked.length;
    const status: Status = allDone ? 'done' : linked.some(t => t.status === 'blocked') ? 'blocked' : linked.some(t => t.status === 'review') ? 'review' : linked.some(t => t.status === 'in_progress') || done > 0 ? 'in_progress' : milestone.status === 'done' && !linked.length ? 'done' : 'todo';
    return <section key={milestone.id} className={`milestone-card ${status === 'done' ? 'milestone-complete' : ''}`}><div className="milestone-rail"><span>{status === 'done' ? <Check size={21} weight="bold" /> : String(index + 1).padStart(2, '0')}</span></div><div className="milestone-content"><div className="milestone-top"><div><StatusBadge status={status} /><span className="milestone-date"><CalendarBlank size={14} />{milestone.dueDate ? formatDate(milestone.dueDate) : 'Date to be agreed'}</span></div><span className="subtle-count">{done}/{linked.length} actions complete</span></div><h2>{milestone.title}</h2><p>{milestone.description}</p>{milestone.notes && <p className="milestone-context">{milestone.notes}</p>}<button className="text-link milestone-toggle" onClick={() => setExpanded(expanded === milestone.id ? null : milestone.id)} aria-expanded={expanded === milestone.id}>{expanded === milestone.id ? 'Hide linked actions' : `View ${linked.length} linked actions`}<CaretRight size={15} className={expanded === milestone.id ? 'rotated' : ''} /></button>{expanded === milestone.id && <div className="milestone-actions">{linked.map(task => <button key={task.id} onClick={() => onTask(task.id)}><span>{task.title}</span><StatusBadge status={task.status} /><ArrowUpRight size={16} /></button>)}{!linked.length && <p className="muted small">Linked actions will appear here when this milestone is planned.</p>}</div>}</div></section>;
  })}</div><section className="workstream-readiness"><div className="section-heading"><div><h2>Readiness by workstream</h2><p>Open actions and dependencies behind the plan.</p></div></div><div className="readiness-table">{project.workstreams.map(w => { const linked = tasks.filter(t => t.workstreamId === w.id); const incomplete = linked.filter(t => t.status !== 'done'); const unresolvedDependencies = new Set(incomplete.flatMap(t => t.dependencies).filter(id => tasks.find(t => t.id === id)?.status !== 'done')); return <button key={w.id} onClick={() => onActions('all', w.id)}><div><h3>{w.title}</h3><p>{w.description}</p></div><span><strong>{incomplete.length}</strong> open actions</span><span><strong>{unresolvedDependencies.size}</strong> dependencies</span><ArrowUpRight size={17} /></button>; })}</div></section>{(project.scopeNotes?.length > 0 || project.project.scopeNote) && <section className="scope-notes"><h2>Scope decisions to keep visible</h2>{(project.scopeNotes?.length ? project.scopeNotes : [project.project.scopeNote]).map((note, i) => <p key={i}><Info size={17} /><span>{note}</span></p>)}</section>}</>;
}

function ActivityView({ activity, total, tasks, onTask, onDecision }: { activity: AuditEvent[]; total?: number; tasks: Task[]; onTask: (id: string) => void; onDecision: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const filtered = activity.filter(event => (type === 'all' || event.entityType === type) && `${event.summary || ''} ${event.actor || ''} ${event.entityId || ''}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <><div className="filter-bar"><label className="search-field"><MagnifyingGlass size={18} /><span className="sr-only">Search workspace activity</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search updates, names, or references…" /></label><label><span className="sr-only">Filter activity by type</span><select value={type} onChange={e => setType(e.target.value)}><option value="all">All updates</option><option value="task">Actions</option><option value="decision">URL decisions</option></select></label></div><div className="results-bar"><p><strong>{filtered.length}</strong> updates shown{total && total > activity.length ? ` · ${total} total events` : ''}</p><span className="muted small">Most recent first</span></div>{filtered.length ? <section className="activity-list">{filtered.map(event => { const at = event.at || event.createdAt || event.timestamp; const actionTitle = event.entityId ? tasks.find(t => t.id === event.entityId)?.title : null; return <article key={event.id} className="activity-event"><div className={`activity-marker ${event.entityType === 'decision' ? 'decision-event' : ''}`}>{event.entityType === 'decision' ? <LinkSimple size={19} /> : <CheckSquare size={19} />}</div><div><div className="activity-event-top"><strong>{event.actor || event.author || 'Project team'}</strong><time dateTime={at}>{formatDate(at, true)}</time></div><h2>{event.summary || humanise(String(event.type || event.action || 'Workspace updated'))}</h2>{event.entityId && <button className="text-link" onClick={() => event.entityType === 'decision' ? onDecision(event.entityId!) : onTask(event.entityId!)}>{actionTitle || event.entityId}<ArrowUpRight size={14} /></button>}<p className="activity-kind">{event.entityType === 'decision' ? 'URL decision' : 'Action'}{event.revision ? ` · Workspace revision ${event.revision}` : ''}</p></div></article>; })}</section> : <div className="panel"><EmptyState title={activity.length ? 'No updates match these filters' : 'Your project history starts here'} description={activity.length ? 'Try another name, action reference, or update type.' : 'When the team updates actions or records URL decisions, the shared history will appear here. The original source snapshot is available in Documents.'} action={activity.length ? <button className="button button-secondary" onClick={() => { setSearch(''); setType('all'); }}>Clear filters</button> : undefined} /></div>}<div className="source-footnote"><ClockCounterClockwise size={18} /><p>This log records changes in the migration workspace. It is separate from email, Slack, and ClickUp history. The latest 200 events are displayed.</p></div></>;
}
