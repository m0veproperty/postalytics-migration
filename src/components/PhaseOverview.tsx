'use client';

import { ArrowRight, ArrowUpRight, CheckCircle, ClockCounterClockwise, Files, Flag, ListChecks, Pulse, Signpost } from '@phosphor-icons/react';
import type { Milestone, Section, Status, Task } from './portalTypes';
import { StatusBadge } from './WorkspaceDialogs';

type PhaseOverviewProps = {
  phase: 'prelaunch' | 'postlaunch';
  tasks: Task[];
  allTasks: Task[];
  milestones: Milestone[];
  onTask: (id: string) => void;
  onNavigate: (section: Section) => void;
};

function linkedProgress(milestone: Milestone, tasksById: Map<string, Task>) {
  const ids = [...new Set(milestone.taskIds)];
  const linked = ids.map(id => tasksById.get(id)).filter((task): task is Task => Boolean(task));
  const done = linked.filter(task => task.status === 'done').length;
  const total = ids.length;
  const missing = total - linked.length;
  let status: Status = 'todo';
  if (total > 0 && done === total) status = 'done';
  else if (linked.some(task => task.status === 'blocked')) status = 'blocked';
  else if (linked.some(task => task.status === 'review')) status = 'review';
  else if (done > 0 || linked.some(task => task.status === 'in_progress')) status = 'in_progress';
  const next = linked.find(task => task.status === 'blocked')
    || linked.find(task => task.status === 'review')
    || linked.find(task => task.status === 'in_progress')
    || linked.find(task => task.status === 'todo')
    || linked[0];
  return { done, total, missing, status, next };
}

export function PhaseOverview({ phase, tasks, allTasks, milestones, onTask, onNavigate }: PhaseOverviewProps) {
  const prelaunch = phase === 'prelaunch';
  const done = tasks.filter(task => task.status === 'done').length;
  const outstanding = tasks.length - done;
  const attention = tasks.filter(task => task.status === 'blocked' || task.status === 'review').length;
  const tasksById = new Map(allTasks.map(task => [task.id, task]));
  const PhaseIcon = prelaunch ? ListChecks : Pulse;

  return <div className={`phase-overview phase-overview--${phase}`}>
    <section className="phase-summary" aria-label={`${prelaunch ? 'Prelaunch' : 'Post-launch'} task progress`}>
      <div className="phase-summary-main">
        <div className="phase-summary-copy">
          <span className="phase-summary-icon" aria-hidden="true"><PhaseIcon size={23} /></span>
          <div>
            <h2>{prelaunch ? 'Prepare for the move.' : 'Verify, monitor and settle in.'}</h2>
            <p>{prelaunch
              ? 'Confirm the decisions and close the remaining checks before the site moves.'
              : 'Plan the checks now. After launch, verify the live site, review tracking and monitor performance.'}</p>
          </div>
        </div>
        <dl className="phase-counts">
          <div><dt>Complete</dt><dd><CheckCircle size={17} aria-hidden="true" />{done}<small>of {tasks.length}</small></dd></div>
          <div><dt>Outstanding</dt><dd>{outstanding}</dd></div>
          <div className={attention ? 'phase-count-attention' : ''}><dt>Needs attention</dt><dd>{attention}</dd></div>
        </dl>
      </div>
      <div className="phase-summary-footer">
        <p>Task progress · “Needs attention” includes blocked actions and items awaiting review.</p>
        <div className="phase-shortcuts">
          {prelaunch
            ? <button type="button" onClick={() => onNavigate('decisions')}><Signpost size={16} aria-hidden="true" />URL decisions<ArrowUpRight size={14} aria-hidden="true" /></button>
            : <button type="button" onClick={() => onNavigate('activity')}><ClockCounterClockwise size={16} aria-hidden="true" />Recent updates<ArrowUpRight size={14} aria-hidden="true" /></button>}
          <button type="button" onClick={() => onNavigate('documents')}><Files size={16} aria-hidden="true" />Project documents<ArrowUpRight size={14} aria-hidden="true" /></button>
        </div>
      </div>
    </section>

    {milestones.length > 0 && <section className="phase-milestones" aria-labelledby={`phase-milestones-${phase}`}>
      <div className="phase-section-heading">
        <div><h3 id={`phase-milestones-${phase}`}>{prelaunch ? 'Prelaunch milestones' : 'Post-launch milestones'}</h3><p>Progress includes every action linked to each milestone.</p></div>
        <button className="phase-all-milestones" type="button" onClick={() => onNavigate('milestones')}>All milestones<ArrowRight size={15} aria-hidden="true" /></button>
      </div>
      <div className={`phase-milestone-grid ${milestones.length <= 2 ? 'phase-milestone-grid--pair' : ''}`}>
        {milestones.map((milestone, index) => {
          const progress = linkedProgress(milestone, tasksById);
          return <article key={milestone.id} className={`phase-milestone ${progress.status === 'done' ? 'phase-milestone--complete' : ''}`}>
            <div className="phase-milestone-top"><span className="phase-milestone-index"><Flag size={14} aria-hidden="true" />{String(index + 1).padStart(2, '0')}</span><StatusBadge status={progress.status} /></div>
            <h4>{milestone.title}</h4>
            <div className="phase-milestone-progress">
              {progress.total > 0 ? <><div className="phase-progress-track" role="progressbar" aria-label={`${milestone.title} linked action completion`} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><span style={{ width: `${progress.done / progress.total * 100}%` }} /></div><p><strong>{progress.done}/{progress.total}</strong> linked actions complete</p></> : <p>No actions linked yet.</p>}
              {progress.missing > 0 && <p className="phase-missing-links">{progress.missing} linked {progress.missing === 1 ? 'action is' : 'actions are'} unavailable.</p>}
            </div>
            {progress.next && <button className="phase-task-link" type="button" onClick={() => onTask(progress.next!.id)} aria-label={`Open action: ${progress.next.title}`} title={progress.next.title}>
              <span><small>{progress.next.status === 'done' ? 'Review completed action' : 'Next linked action'}</small><strong>{progress.next.title}</strong></span><ArrowUpRight size={17} aria-hidden="true" />
            </button>}
          </article>;
        })}
      </div>
    </section>}

    <div className="phase-actions-heading"><h2>{prelaunch ? 'Prelaunch actions' : 'Post-launch actions'}</h2><p>{prelaunch ? 'Work through the remaining preparation below.' : 'Assign owners and prepare the follow-up work before launch.'}</p></div>
  </div>;
}

export default PhaseOverview;
