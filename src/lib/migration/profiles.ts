/** Public profile labels. The shared access PIN is configured only on the server. */
export const WORKSPACE_PROFILES = [
  { id: 'amir', name: 'Amir', canApprove: false, roleLabel: 'Project editor' },
  { id: 'tony', name: 'Tony', canApprove: false, roleLabel: 'Project editor' },
  { id: 'dennis', name: 'Dennis', canApprove: true, roleLabel: 'Decision approver' },
  { id: 'maddy', name: 'Maddy', canApprove: true, roleLabel: 'Decision approver' },
] as const;

export type ProfileId = (typeof WORKSPACE_PROFILES)[number]['id'];
export type WorkspaceProfile = (typeof WORKSPACE_PROFILES)[number];

export function getWorkspaceProfile(id: unknown): WorkspaceProfile | undefined {
  return WORKSPACE_PROFILES.find((profile) => profile.id === id);
}
