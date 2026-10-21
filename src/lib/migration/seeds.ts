import 'server-only';
import { readPrivateJson } from './content-store.ts';
import type { SeedData, SeedDecision, Task } from './types.ts';

/** Source data is read only on the authenticated server, never bundled with the app. */
export async function getSeedData(): Promise<SeedData> {
  const [project, decisions] = await Promise.all([readPrivateJson('project.json'), readPrivateJson('decisions.json')]);
  const document = project as { tasks: Task[]; workstreams: { id: string }[] };
  return { tasks: document.tasks, workstreamIds: document.workstreams.map((workstream) => workstream.id), decisions: decisions as SeedDecision[] };
}
