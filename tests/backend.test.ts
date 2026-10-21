import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AtomicDocumentStore } from '../src/lib/migration/atomic-store.ts';
import { ConditionalWriteConflict, WorkspaceError } from '../src/lib/migration/errors.ts';
import { assertSameOrigin, createSession, passwordMatches, requireEditor, sessionCookie, verifySession } from '../src/lib/migration/auth.ts';
import { assertManifestAsset, contentName, validateSourceJson } from '../src/lib/migration/content-validation.ts';
import { readJson } from '../src/lib/migration/http.ts';
import { LocalDocumentStore } from '../src/lib/migration/local-store.ts';
import { consumeLoginAttempt } from '../src/lib/migration/rate-limit.ts';
import { readWorkspace, saveMutation, workspaceResponse } from '../src/lib/migration/service.ts';
import { assertLedger, emptyLedger, projectLedger } from '../src/lib/migration/state.ts';
import type { DecisionFields, SeedData } from '../src/lib/migration/types.ts';
import { validateApproval, validateMutation } from '../src/lib/migration/validation.ts';

const seeds: SeedData = {
  tasks: [
    { id: 'task-a', title: 'Review redirect plan', subtasks: [{ id: 'sub-a', title: 'Check target', done: false }] },
    { id: 'task-b', title: 'Review navigation', subtasks: [] },
  ],
  workstreamIds: ['urls', 'navigation'],
  decisions: [{ id: 'D001', url: 'https://www.postalytics.com/old/' }],
};
const approved: DecisionFields = {
  approvalStatus: 'Approved', approvedAction: 'Redirect', approvedTarget: 'https://www.postalytics.com/new/',
  approver: 'Client reviewer', approvalDate: '2026-01-01', evidence: 'Recorded approval in review meeting notes.',
  notes: '', conditionsConfirmed: true,
};

class MemoryStore implements AtomicDocumentStore {
  records = new Map<string, { value: unknown; etag: string }>();
  counter = 0;
  async read(path: string) { return structuredClone(this.records.get(path) ?? null); }
  async write(path: string, value: unknown, expectedEtag: string | null) {
    // Yield between read/write to exercise races between function instances.
    await new Promise((resolve) => setTimeout(resolve, 1));
    if ((this.records.get(path)?.etag ?? null) !== expectedEtag) throw new ConditionalWriteConflict();
    this.records.set(path, { value: structuredClone(value), etag: String(++this.counter) });
  }
}

test('simultaneous initial writes preserve both independent tasks and ordered audit events', async () => {
  const store = new MemoryStore();
  await Promise.all([
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'in_progress', owner: 'MADX' } }), 'Editor A'),
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-b', expectedRevision: 0, patch: { dueDate: '2026-11-01' } }), 'Editor B'),
  ]);
  const ledger = await readWorkspace(store);
  const state = projectLedger(ledger);
  assert.equal(ledger.revision, 2);
  assert.deepEqual(ledger.events.map((event) => event.revision), [1, 2]);
  assert.equal(state.taskOverrides['task-a'].status, 'in_progress');
  assert.equal(state.taskOverrides['task-b'].dueDate, '2026-11-01');
  assert.equal(seeds.tasks[0].title, 'Review redirect plan');
});

test('concurrent changes to the same entity reject the stale save without overwriting it', async () => {
  const store = new MemoryStore();
  const outcomes = await Promise.allSettled([
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'done' } }), 'Editor A'),
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'blocked' } }), 'Editor B'),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason.code, 'STALE_REVISION');
  assert.equal((await readWorkspace(store)).events.length, 1);
});

test('task comments append concurrently; checklist state and original seed stay separate', async () => {
  const store = new MemoryStore();
  await Promise.all(['First review note', 'Second review note'].map((text, index) => saveMutation(store, seeds, validateMutation({ type: 'task.comment', taskId: 'task-a', text }), `Editor ${index}`)));
  await saveMutation(store, seeds, validateMutation({ type: 'task.subtask', taskId: 'task-a', expectedRevision: 2, subtaskId: 'sub-a', done: true }), 'Editor');
  const state = projectLedger(await readWorkspace(store));
  assert.equal(state.taskOverrides['task-a'].comments?.length, 2);
  assert.equal(state.taskOverrides['task-a'].subtaskState?.['sub-a'], true);
  assert.equal(seeds.tasks[0].subtasks[0].done, false);
});

test('new actions persist with real IDs and support subsequent updates', async () => {
  const store = new MemoryStore();
  const created = await saveMutation(store, seeds, validateMutation({ type: 'task.create', task: { title: 'Verify search destinations', workstreamId: 'urls', priority: 'high', owner: 'Postalytics', dueDate: null, subtasks: ['Check search results'] } }), 'Editor');
  const task = projectLedger(created).customTasks[0];
  assert.ok(task.id.startsWith('custom-'));
  assert.equal(task.subtasks[0].done, false);
  const changed = await saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: task.id, expectedRevision: 1, patch: { status: 'in_progress' } }), 'Editor');
  assert.equal(projectLedger(changed).taskOverrides[task.id].status, 'in_progress');
});

test('approval demands real evidence, a final action, valid target and explicit conditions', async () => {
  const invalidVariants = [
    { evidence: '' }, { approver: '' }, { conditionsConfirmed: false }, { approvedAction: 'Hold' },
    { approvedTarget: 'javascript:alert(1)' }, { approvedTarget: 'https://www.postalytics.com/old/' },
    { approvedTarget: 'https://www.postalytics.com:443/old/#fragment' }, { approvalDate: '2999-01-01' },
    { approvedAction: 'Retire (410)', approvedTarget: 'https://www.postalytics.com/new/' },
  ];
  for (const patch of invalidVariants) {
    const store = new MemoryStore();
    await assert.rejects(async () => saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, ...patch } }), 'Editor'), (error: unknown) => error instanceof WorkspaceError && error.status === 400);
    assert.equal((await readWorkspace(store)).revision, 0);
  }
  const store = new MemoryStore();
  const ledger = await saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: approved }), 'Recorder');
  const override = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(override.approvalStatus, 'Approved');
  assert.equal(override.approver, 'Client reviewer');
  assert.equal(override.updatedBy, 'Recorder');
  assert.equal(ledger.events[0].actor, 'Recorder');
  assert.equal(seeds.decisions[0].url, 'https://www.postalytics.com/old/');
});

test('client cannot overwrite source evidence, forge audit actor, use unknown IDs, or fake calendar dates', async () => {
  assert.throws(() => validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { proposed_action: 'Retire' } }), /unsupported field/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, actor: 'Someone else', patch: { status: 'done' } }), /unsupported field/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: '__proto__', expectedRevision: 0, patch: { status: 'done' } }), /invalid/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { dueDate: '2026-02-30' } }), /calendar date/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', patch: { status: 'done' } }), /revision/);
  await assert.rejects(saveMutation(new MemoryStore(), seeds, validateMutation({ type: 'task.update', taskId: 'missing', expectedRevision: 0, patch: { status: 'done' } }), 'Editor'), /not in the workspace/);
});

test('completed action never auto-approves any URL; source-only workspace is honest about editing', async () => {
  const store = new MemoryStore();
  const ledger = await saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'done' } }), 'Editor');
  assert.deepEqual(projectLedger(ledger).decisionOverrides, {});
  const response = workspaceResponse(emptyLedger(), { canEdit: false, name: null, expiresAt: null }, false);
  assert.equal(response.persistence.configured, false);
  assert.equal(response.session.canEdit, false);
});

test('session signatures reject tampering, expiry, and password rotation; cookies are protected', () => {
  const config = { password: 'a-strong-test-password-only', secret: 'a-long-session-secret-for-unit-testing-only', secure: true };
  const now = 1_790_000_000_000;
  const result = createSession('Project reviewer', config, now);
  assert.equal(verifySession(result.token, config, now).canEdit, true);
  assert.equal(verifySession(`${result.token.slice(0, -5)}AAAAA`, config, now).canEdit, false);
  assert.equal(verifySession(result.token, config, now + 12 * 60 * 60 * 1000).canEdit, false);
  assert.equal(verifySession(result.token, { ...config, password: 'rotated-strong-test-password' }, now).canEdit, false);
  assert.ok(passwordMatches(config.password, config.password));
  assert.ok(!passwordMatches('wrong', config.password));
  const cookie = sessionCookie(result.token, config);
  assert.match(cookie, /^__Host-postalytics-edit=/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!JSON.stringify(result.session).includes(config.password));
});

test('cross-origin or missing-Origin writes are denied', () => {
  const request = (origin?: string) => new Request('https://workspace.example/api/workspace', { method: 'POST', headers: origin ? { origin } : {} });
  assert.doesNotThrow(() => assertSameOrigin(request('https://workspace.example')));
  assert.throws(() => assertSameOrigin(request('https://attacker.example')), /origin/);
  assert.throws(() => assertSameOrigin(request()), /directly/);
});

test('Next development bind addresses use the actual Host and still reject hostile origins', () => {
  for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
    const request = (origin: string, extra: Record<string, string> = {}) => new Request('http://0.0.0.0:4317/api/session', { method: 'POST', headers: { host, origin, 'sec-fetch-site': 'same-origin', ...extra } });
    assert.doesNotThrow(() => assertSameOrigin(request(`http://${host}`)));
    assert.throws(() => assertSameOrigin(request('http://evil.example')), /origin/);
    assert.throws(() => assertSameOrigin(request('http://evil.example', { 'x-forwarded-host': 'evil.example' })), /origin/);
    assert.throws(() => assertSameOrigin(request(`https://${host}`, { 'x-forwarded-proto': 'https' })), /origin/);
    assert.throws(() => assertSameOrigin(request(`http://${host}`, { 'sec-fetch-site': 'cross-site' })), /directly/);
  }
});

test('malformed Host or Origin values cannot be used as an alternate authority', () => {
  const request = (host: string, origin = 'http://localhost:4317') => new Request('http://0.0.0.0:4317/api/session', { method: 'POST', headers: { host, origin } });
  for (const host of ['localhost:4317@evil.example', 'localhost:4317,evil.example', 'localhost:4317/evil', 'localhost:99999']) assert.throws(() => assertSameOrigin(request(host)), /origin/);
  for (const origin of ['http://localhost:4317/other', 'http://localhost:4317#fragment', 'http://user@localhost:4317']) assert.throws(() => assertSameOrigin(request('localhost:4317', origin)), /origin/);
});

test('Vercel deployments require the public HTTPS origin without trusting forwarded headers', () => {
  const previousVercel = process.env.VERCEL;
  const previousEnvironment = process.env.VERCEL_ENV;
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  try {
    const request = (origin: string, extra: Record<string, string> = {}) => new Request('http://0.0.0.0:3000/api/session', { method: 'POST', headers: { host: 'workspace.vercel.app', origin, ...extra } });
    assert.doesNotThrow(() => assertSameOrigin(request('https://workspace.vercel.app')));
    assert.throws(() => assertSameOrigin(request('http://workspace.vercel.app', { 'x-forwarded-proto': 'http' })), /origin/);
    assert.throws(() => assertSameOrigin(request('https://evil.example', { 'x-forwarded-host': 'evil.example' })), /origin/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnvironment;
  }
});

test('unauthenticated requests cannot open private workspace content', () => {
  assert.throws(() => requireEditor(new Request('https://workspace.example/api/project')), (error: unknown) => error instanceof WorkspaceError && error.status === 401);
});

test('source uploads use safe names, immutable manifest scope and unique source IDs', () => {
  assert.equal(contentName('project.json'), 'project.json');
  assert.throws(() => contentName('../project.json'), /allowed source filename/);
  assert.throws(() => contentName('unlisted.json'), /Only project/);
  assert.throws(() => contentName('malware.exe'), /supported/);
  assert.doesNotThrow(() => assertManifestAsset({ assets: [{ fileName: 'Review.html' }] }, 'Review.html'));
  assert.throws(() => assertManifestAsset({ assets: [{ fileName: 'Review.html' }] }, 'Unlisted.html'), /not in the workspace/);
  assert.throws(() => validateSourceJson('decisions.json', Buffer.from(JSON.stringify([{ id: 'D1', url: 'https://example.com' }, { id: 'D1', url: 'https://example.com/other' }]))), /duplicate/);
  assert.throws(() => validateSourceJson('decisions.json', Buffer.from(JSON.stringify([{ id: 'D1', url: 'javascript:alert(1)' }]))), /valid source URL/);
  const malformed = [{ id: 'D1', url: 'ttps://example.com/old/', role: 'Malformed scheme', group: 'Malformed link' }];
  assert.deepEqual(validateSourceJson('decisions.json', Buffer.from(JSON.stringify(malformed))), malformed);
});

test('approval date uses the London calendar at a summer UTC day boundary', () => {
  assert.doesNotThrow(() => validateApproval({ ...approved, approvalDate: '2026-07-02' }, seeds.decisions[0].url, '2026-07-01T23:30:00.000Z'));
  assert.throws(() => validateApproval({ ...approved, approvalDate: '2026-07-03' }, seeds.decisions[0].url, '2026-07-01T23:30:00.000Z'), /future date/);
});

test('JSON parser bounds streamed bodies and rejects unsupported types', async () => {
  await assert.rejects(readJson(new Request('https://workspace.example', { method: 'POST', body: 'not json' })), /JSON/);
  await assert.rejects(readJson(new Request('https://workspace.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(500) }) }), 100), /too large/);
});

test('durable login throttle survives separate limiter calls and resets after its window', async () => {
  const store = new MemoryStore();
  const now = 1_790_000_000_000;
  for (let index = 0; index < 8; index++) await consumeLoginAttempt(store, '192.0.2.1', 'test-secret', now);
  await assert.rejects(consumeLoginAttempt(store, '192.0.2.1', 'test-secret', now), (error: unknown) => error instanceof WorkspaceError && error.status === 429);
  await assert.doesNotReject(consumeLoginAttempt(store, '192.0.2.1', 'test-secret', now + 15 * 60 * 1000));
  assert.ok(![...store.records.keys()].join('').includes('192.0.2.1'));
});

const temporaryDirectories: string[] = [];
after(async () => { for (const directory of temporaryDirectories) await rm(directory, { recursive: true, force: true }); });

test('explicit local QA storage persists between server instances and prevents stale writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'postalytics-backend-test-'));
  temporaryDirectories.push(directory);
  const first = new LocalDocumentStore(directory);
  const second = new LocalDocumentStore(directory);
  await saveMutation(first, seeds, validateMutation({ type: 'task.comment', taskId: 'task-a', text: 'Persistent note across instances.' }), 'Editor');
  assert.equal(projectLedger(await readWorkspace(second)).taskOverrides['task-a'].comments?.[0].text, 'Persistent note across instances.');
  await assert.rejects(second.write('postalytics-migration/workspace-v1.json', {}, null), ConditionalWriteConflict);
});

test('corrupted or truncated audit records fail closed rather than resetting shared work', () => {
  assert.throws(() => assertLedger({ schemaVersion: 1, revision: 1, createdAt: '2026-01-01', events: [] }), /unsupported format/);
  assert.throws(() => assertLedger({ schemaVersion: 2, revision: 0, createdAt: '2026-01-01', events: [] }), /unsupported format/);
});
