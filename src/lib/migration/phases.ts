export type LaunchPhase = 'prelaunch' | 'postlaunch';

export const PHASE_LABELS: Record<LaunchPhase, string> = {
  prelaunch: 'Prelaunch',
  postlaunch: 'Post launch',
};

type PhaseTask = { id: string; workstreamId: string; phase?: LaunchPhase };

// The imported plan separates launch preparation from production verification.
// Assigning a phase here only organises the source view; it never changes status.
const POST_LAUNCH_SOURCE_ACTIONS = new Set([
  'task-34', 'task-35', 'task-36', 'task-37', 'task-38', 'task-39', 'task-40',
]);

export function getTaskPhase(task: PhaseTask): LaunchPhase {
  if (task.phase === 'prelaunch' || task.phase === 'postlaunch') return task.phase;
  return POST_LAUNCH_SOURCE_ACTIONS.has(task.id) || task.workstreamId === 'monitoring' ? 'postlaunch' : 'prelaunch';
}

export function milestoneInPhase(milestone: { taskIds: string[] }, tasks: PhaseTask[], phase: LaunchPhase): boolean {
  const linked = tasks.filter(task => milestone.taskIds.includes(task.id));
  // A milestone with work in both phases appears in both, with the same shared
  // progress. Unlinked milestones remain available in prelaunch planning.
  return linked.length ? linked.some(task => getTaskPhase(task) === phase) : phase === 'prelaunch';
}
