import { WorkspaceError } from './errors.ts';

export const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
export const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json', html: 'text/html', csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function contentName(value: string | null): string {
  if (!value || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(value) || value.includes('..')) throw new WorkspaceError(400, 'INVALID_CONTENT_NAME', 'Choose an allowed source filename.');
  const extension = value.split('.').at(-1);
  if (!extension || !Object.hasOwn(CONTENT_TYPES, extension)) throw new WorkspaceError(400, 'INVALID_CONTENT_TYPE', 'Only the source JSON, HTML reports, CSVs and XLSX workbooks are supported.');
  if (extension === 'json' && !['project.json', 'decisions.json'].includes(value)) throw new WorkspaceError(400, 'INVALID_CONTENT_NAME', 'Only project.json and decisions.json are allowed as JSON source files.');
  return value;
}

export function contentType(name: string): string {
  return CONTENT_TYPES[name.split('.').at(-1)!];
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function assertUniqueIds(records: unknown[], label: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== 'object' || !validId((record as { id?: unknown }).id)) throw new WorkspaceError(400, 'INVALID_SOURCE', `${label} contains an invalid ID.`);
    const id = (record as { id: string }).id;
    if (ids.has(id)) throw new WorkspaceError(400, 'INVALID_SOURCE', `${label} contains duplicate IDs.`);
    ids.add(id);
  }
}

export function validateSourceJson(name: string, body: Buffer): unknown {
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); }
  catch { throw new WorkspaceError(400, 'INVALID_SOURCE', 'The source file is not valid JSON.'); }
  if (name === 'project.json') {
    const data = value as Record<string, unknown>;
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.workstreams) || !Array.isArray(data.assets) || !data.project || data.tasks.length > 5000 || data.workstreams.length > 100) throw new WorkspaceError(400, 'INVALID_SOURCE', 'Project source must contain project details, tasks, workstreams and assets.');
    assertUniqueIds(data.tasks, 'Tasks');
    assertUniqueIds(data.workstreams, 'Workstreams');
    for (const asset of data.assets) {
      const filename = (asset as { fileName?: unknown })?.fileName;
      if (filename != null && (typeof filename !== 'string' || !/\.(html|csv|xlsx)$/.test(contentName(filename)))) throw new WorkspaceError(400, 'INVALID_SOURCE', 'The asset manifest contains an unsupported filename.');
    }
  } else {
    if (!Array.isArray(value) || value.length > 10_000) throw new WorkspaceError(400, 'INVALID_SOURCE', 'Decision source must be an array of URL records.');
    assertUniqueIds(value, 'URL decisions');
    for (const decision of value) {
      const record = decision as { url?: unknown; role?: unknown; group?: unknown };
      if (typeof record.url !== 'string' || !record.url.trim() || record.url.length > 4096 || /[\u0000-\u001F\u007F]/.test(record.url)) throw new WorkspaceError(400, 'INVALID_SOURCE', 'Every decision must preserve a nonempty source URL string.');
      // The reconciliation deliberately retains malformed links as source evidence.
      // They must remain exact strings, not be silently corrected during import.
      const recordedMalformed = [record.role, record.group].some((label) => typeof label === 'string' && /malformed/i.test(label));
      try {
        const url = new URL(record.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        if (!recordedMalformed) throw new WorkspaceError(400, 'INVALID_SOURCE', 'Every decision must have a valid source URL or an explicit malformed-link classification.');
      }
    }
  }
  return value;
}

export function assertManifestAsset(project: unknown, name: string): void {
  const assets = (project as { assets?: { fileName?: string | null }[] })?.assets;
  if (!Array.isArray(assets) || !assets.some((asset) => asset.fileName === name)) throw new WorkspaceError(404, 'UNKNOWN_ASSET', 'This file is not in the workspace asset manifest.');
}
