import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AtomicDocumentStore } from '../src/lib/migration/atomic-store.ts';
import { ConditionalWriteConflict, WorkspaceError } from '../src/lib/migration/errors.ts';
import { assertSameOrigin, authConfig, createSession, pinMatches, READ_ONLY_SESSION, requireEditor, sessionCookie, verifySession } from '../src/lib/migration/auth.ts';
import { assertManifestAsset, contentName, validateSourceJson } from '../src/lib/migration/content-validation.ts';
import { readJson } from '../src/lib/migration/http.ts';
import { LocalDocumentStore } from '../src/lib/migration/local-store.ts';
import { consumeLoginAttempt } from '../src/lib/migration/rate-limit.ts';
import { readWorkspace, saveMutation, workspaceResponse } from '../src/lib/migration/service.ts';
import { appendMutation, assertLedger, EMPTY_DECISION, emptyLedger, projectLedger } from '../src/lib/migration/state.ts';
import type { DecisionPatch, Ledger, Mutation, SeedData } from '../src/lib/migration/types.ts';
import { validateApproval, validateLogin, validateMutation } from '../src/lib/migration/validation.ts';

import { WORKSPACE_PROFILES } from '../src/lib/migration/profiles.ts';
import type { ProfileId } from '../src/lib/migration/profiles.ts';

const TEST_PIN = randomInt(0, 1_000_000).toString().padStart(6, '0');
const TEST_SECRET = randomBytes(32).toString('hex');

const seeds: SeedData = {
  tasks: [
    { id: 'task-a', title: 'Review redirect plan', subtasks: [{ id: 'sub-a', title: 'Check target', done: false }] },
    { id: 'task-b', title: 'Review navigation', subtasks: [] },
  ],
  workstreamIds: ['urls', 'navigation'],
  decisions: [{ id: 'D001', url: 'https://www.postalytics.com/old/' }],
};
const approved: DecisionPatch = {
  approvalStatus: 'Approved', approvedAction: 'Redirect', approvedTarget: 'https://www.postalytics.com/new/',
  evidence: '', notes: '',
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
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'in_progress', owner: 'MADX' } }), 'amir'),
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-b', expectedRevision: 0, patch: { dueDate: '2026-11-01' } }), 'tony'),
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
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'done' } }), 'amir'),
    saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'blocked' } }), 'tony'),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason.code, 'STALE_REVISION');
  assert.equal((await readWorkspace(store)).events.length, 1);
});

test('task comments append concurrently; checklist state and original seed stay separate', async () => {
  const store = new MemoryStore();
  await Promise.all(['First review note', 'Second review note'].map((text, index) => saveMutation(store, seeds, validateMutation({ type: 'task.comment', taskId: 'task-a', text }), (['amir', 'tony'] as const)[index])));
  await saveMutation(store, seeds, validateMutation({ type: 'task.subtask', taskId: 'task-a', expectedRevision: 2, subtaskId: 'sub-a', done: true }), 'amir');
  const state = projectLedger(await readWorkspace(store));
  assert.equal(state.taskOverrides['task-a'].comments?.length, 2);
  assert.equal(state.taskOverrides['task-a'].subtaskState?.['sub-a'], true);
  assert.equal(seeds.tasks[0].subtasks[0].done, false);
});

test('new actions persist with real IDs and support subsequent updates', async () => {
  const store = new MemoryStore();
  const created = await saveMutation(store, seeds, validateMutation({ type: 'task.create', task: { title: 'Verify search destinations', workstreamId: 'urls', priority: 'high', owner: 'Postalytics', dueDate: null, subtasks: ['Check search results'] } }), 'amir');
  const task = projectLedger(created).customTasks[0];
  assert.ok(task.id.startsWith('custom-'));
  assert.equal(task.subtasks[0].done, false);
  const changed = await saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: task.id, expectedRevision: 1, patch: { status: 'in_progress' } }), 'amir');
  assert.equal(projectLedger(changed).taskOverrides[task.id].status, 'in_progress');
});

test('approval still requires a final action and a safe destination', async () => {
  const invalidVariants: DecisionPatch[] = [
    { approvedAction: 'Hold' }, { approvedAction: '' }, { approvedTarget: '' },
    { approvedTarget: 'javascript:alert(1)' }, { approvedTarget: 'https://www.postalytics.com/old/' },
    { approvedTarget: 'https://www.postalytics.com:443/old/#fragment' },
    { approvedAction: 'Retire (410)', approvedTarget: 'https://www.postalytics.com/new/' },
  ];
  for (const patch of invalidVariants) {
    const store = new MemoryStore();
    await assert.rejects(async () => saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, ...patch } }), 'dennis'), (error: unknown) => error instanceof WorkspaceError && error.status === 400);
    assert.equal((await readWorkspace(store)).revision, 0);
  }
});

test('approval stamps the logged-in approver and server time without requiring evidence or a checklist', async () => {
  const store = new MemoryStore();
  const earliest = new Date().toISOString();
  const ledger = await saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: approved }), 'dennis');
  const latest = new Date().toISOString();
  const override = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(override.approvalStatus, 'Approved');
  assert.equal(override.approver, 'Dennis');
  assert.ok(override.approvedAt >= earliest && override.approvedAt <= latest);
  assert.equal(override.approvedAt, ledger.events[0].at);
  assert.equal(override.updatedBy, 'Dennis');
  assert.equal(override.evidence, '');
  assert.equal(override.conditionsConfirmed, false);
  assert.equal(ledger.events[0].actor, 'Dennis');
  assert.equal(ledger.events[0].actorProfileId, 'dennis');
  assert.equal(seeds.decisions[0].url, 'https://www.postalytics.com/old/');
});

function decisionUpdate(ledger: Ledger, patch: DecisionPatch, profileId: ProfileId, now: string): Ledger {
  const expectedRevision = projectLedger(ledger).decisionOverrides.D001?.revision ?? 0;
  return appendMutation(ledger, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision, patch }), profileId, seeds, { now, eventId: `event-${ledger.revision + 1}`, newTaskId: 'unused-custom-task' });
}

test('all four profiles can edit tasks and draft URL decisions', async () => {
  for (const profile of WORKSPACE_PROFILES) {
    const store = new MemoryStore();
    await saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'in_progress' } }), profile.id);
    const ledger = await saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { approvalStatus: 'Needs discussion', approvedAction: 'Redirect', approvedTarget: 'https://www.postalytics.com/new/', evidence: 'Optional working evidence.', notes: 'Review the recommendation.' } }), profile.id);
    const state = projectLedger(ledger);
    assert.equal(state.taskOverrides['task-a'].status, 'in_progress');
    assert.equal(state.decisionOverrides.D001.approvalStatus, 'Needs discussion');
    assert.equal(state.decisionOverrides.D001.approvedAt, '');
    assert.equal(ledger.events[1].actor, profile.name);
  }
});

test('Amir and Tony cannot approve, even with a valid action and target', async () => {
  for (const profileId of ['amir', 'tony'] as const) {
    const store = new MemoryStore();
    await assert.rejects(saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: approved }), profileId), (error: unknown) => error instanceof WorkspaceError && error.status === 403);
    assert.equal((await readWorkspace(store)).revision, 0);
  }
});

test('nonapprovers can add notes to approved records but cannot revoke or change other fields', () => {
  const initial = decisionUpdate(emptyLedger(), approved, 'dennis', '2026-07-01T12:00:00.000Z');
  for (const profileId of ['amir', 'tony'] as const) {
    const changed = decisionUpdate(initial, { notes: `Working note from ${profileId}.` }, profileId, '2026-07-01T13:00:00.000Z');
    assert.equal(projectLedger(changed).decisionOverrides.D001.approver, 'Dennis');
    for (const patch of [{ approvalStatus: 'Rejected' }, { approvalStatus: 'Approved' }, { approvedTarget: 'https://www.postalytics.com/revised/' }, { approvedAction: 'Retain' }, { evidence: 'Changed evidence.' }, { conditionsConfirmed: true }] as DecisionPatch[]) {
      assert.throws(() => decisionUpdate(changed, patch, profileId, '2026-07-01T14:00:00.000Z'), (error: unknown) => error instanceof WorkspaceError && error.status === 403);
    }
  }
});

test('both approvers can approve; notes and evidence preserve the original approval stamp', () => {
  for (const profileId of ['dennis', 'maddy'] as const) {
    let ledger = decisionUpdate(emptyLedger(), approved, profileId, '2026-07-01T12:00:00.000Z');
    const original = projectLedger(ledger).decisionOverrides.D001;
    ledger = decisionUpdate(ledger, { notes: 'Implementation note.' }, 'amir', '2026-07-01T13:00:00.000Z');
    ledger = decisionUpdate(ledger, { evidence: 'Additional optional reference.', approvalStatus: 'Approved' }, 'maddy', '2026-07-01T14:00:00.000Z');
    const current = projectLedger(ledger).decisionOverrides.D001;
    assert.equal(current.approver, original.approver);
    assert.equal(current.approvalDate, original.approvalDate);
    assert.equal(current.approvedAt, original.approvedAt);
    assert.ok(!ledger.events[2].summary.startsWith('Recorded approval'));
  }
});

test('revoking preserves previous approval provenance; reapproval or a changed final disposition stamps fresh', () => {
  let ledger = decisionUpdate(emptyLedger(), approved, 'dennis', '2026-07-01T12:00:00.000Z');
  ledger = decisionUpdate(ledger, { approvalStatus: 'Needs discussion' }, 'maddy', '2026-07-02T12:00:00.000Z');
  let current = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(current.approvalStatus, 'Needs discussion');
  assert.equal(current.approver, 'Dennis');
  assert.equal(current.approvedAt, '2026-07-01T12:00:00.000Z');
  ledger = decisionUpdate(ledger, { approvalStatus: 'Approved' }, 'maddy', '2026-07-03T12:00:00.000Z');
  current = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(current.approver, 'Maddy');
  assert.equal(current.approvedAt, '2026-07-03T12:00:00.000Z');
  ledger = decisionUpdate(ledger, { approvedTarget: 'https://www.postalytics.com/revised/' }, 'dennis', '2026-07-04T12:00:00.000Z');
  current = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(current.approver, 'Dennis');
  assert.equal(current.approvedAt, '2026-07-04T12:00:00.000Z');
  ledger = decisionUpdate(ledger, { approvedAction: 'Retain', approvedTarget: seeds.decisions[0].url }, 'maddy', '2026-07-05T12:00:00.000Z');
  current = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(current.approver, 'Maddy');
  assert.equal(current.approvedAt, '2026-07-05T12:00:00.000Z');
  assert.equal(current.conditionsConfirmed, false);
});

test('concurrent approvals preserve the winning disposition and its matching actor stamp', async () => {
  const store = new MemoryStore();
  const results = await Promise.allSettled([
    saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, approvedTarget: 'https://www.postalytics.com/dennis-choice/' } }), 'dennis'),
    saveMutation(store, seeds, validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, approvedTarget: 'https://www.postalytics.com/maddy-choice/' } }), 'maddy'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason.code, 'STALE_REVISION');
  const ledger = await readWorkspace(store);
  const decision = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(ledger.events.length, 1);
  assert.equal(decision.approver, ledger.events[0].actor);
  assert.equal(decision.approvedAt, ledger.events[0].at);
  assert.equal(decision.approvedTarget, `https://www.postalytics.com/${ledger.events[0].actorProfileId}-choice/`);
});

test('approval stamps the London calendar date and exact UTC time at the summer day boundary', () => {
  const ledger = decisionUpdate(emptyLedger(), approved, 'maddy', '2026-07-01T23:30:00.000Z');
  const current = projectLedger(ledger).decisionOverrides.D001;
  assert.equal(current.approvalDate, '2026-07-02');
  assert.equal(current.approvedAt, '2026-07-01T23:30:00.000Z');
});

test('submitted approver, approvalDate, approvedAt or role claims cannot forge approval provenance', async () => {
  for (const [key, value] of Object.entries({ approver: 'Dennis', approvalDate: '2000-01-01', approvedAt: '2000-01-01T00:00:00.000Z' })) {
    const forged = { type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, [key]: value } };
    assert.throws(() => validateMutation(forged), /unsupported field/);
    await assert.rejects(saveMutation(new MemoryStore(), seeds, forged as Mutation, 'dennis'), /unsupported field/);
  }
  assert.throws(() => validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: approved, canApprove: true }), /unsupported field/);
  assert.throws(() => decisionUpdate(emptyLedger(), approved, { id: 'amir', name: 'Dennis', canApprove: true } as unknown as ProfileId, '2026-07-01T12:00:00.000Z'), /workspace profile/);
});

test('legacy audit rows replay unchanged and retain historical approval evidence when notes are added', () => {
  const legacy: Ledger = { schemaVersion: 1, revision: 1, createdAt: '2026-01-01T12:00:00.000Z', events: [{ id: 'legacy-1', revision: 1, at: '2026-01-01T12:00:00.000Z', actor: 'Legacy recorder', type: 'decision.update', entityType: 'decision', entityId: 'D001', summary: 'Legacy approval record', mutation: { type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { ...approved, approver: 'Legacy client reviewer', approvalDate: '2026-01-01', evidence: 'Historical client approval reference.', conditionsConfirmed: true } } }] };
  const copy = structuredClone(legacy);
  const loaded = assertLedger(legacy);
  const initial = projectLedger(loaded).decisionOverrides.D001;
  assert.equal(initial.approver, 'Legacy client reviewer');
  assert.equal(initial.approvedAt, '');
  const updated = decisionUpdate(loaded, { notes: 'New implementation note.' }, 'tony', '2026-07-01T12:00:00.000Z');
  const current = projectLedger(updated).decisionOverrides.D001;
  assert.equal(current.approver, 'Legacy client reviewer');
  assert.equal(current.approvalDate, '2026-01-01');
  assert.equal(current.evidence, 'Historical client approval reference.');
  assert.equal(current.conditionsConfirmed, true);
  assert.deepEqual(updated.events[0], copy.events[0]);
  assert.deepEqual(legacy, copy);
});

test('link spelling corrections allow changed raw spelling while redirects still reject normalized self-targets', () => {
  const source = 'https://www.postalytics.com';
  assert.doesNotThrow(() => validateApproval({ ...EMPTY_DECISION, ...approved, approvedAction: 'Fix link', approvedTarget: `${source}/` }, source));
  assert.throws(() => validateApproval({ ...EMPTY_DECISION, ...approved, approvedAction: 'Fix link', approvedTarget: source }, source), /spelling/);
  assert.throws(() => validateApproval({ ...EMPTY_DECISION, ...approved, approvedAction: 'Redirect', approvedTarget: `${source}/` }, source), /differ/);
});

test('client cannot overwrite source evidence, forge audit actor, use unknown IDs, or fake calendar dates', async () => {
  assert.throws(() => validateMutation({ type: 'decision.update', decisionId: 'D001', expectedRevision: 0, patch: { proposed_action: 'Retire' } }), /unsupported field/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, actor: 'Someone else', patch: { status: 'done' } }), /unsupported field/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: '__proto__', expectedRevision: 0, patch: { status: 'done' } }), /invalid/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { dueDate: '2026-02-30' } }), /calendar date/);
  assert.throws(() => validateMutation({ type: 'task.update', taskId: 'task-a', patch: { status: 'done' } }), /revision/);
  await assert.rejects(saveMutation(new MemoryStore(), seeds, validateMutation({ type: 'task.update', taskId: 'missing', expectedRevision: 0, patch: { status: 'done' } }), 'amir'), /not in the workspace/);
});

test('completed action never auto-approves any URL; source-only workspace is honest about editing', async () => {
  const store = new MemoryStore();
  const ledger = await saveMutation(store, seeds, validateMutation({ type: 'task.update', taskId: 'task-a', expectedRevision: 0, patch: { status: 'done' } }), 'amir');
  assert.deepEqual(projectLedger(ledger).decisionOverrides, {});
  const response = workspaceResponse(emptyLedger(), READ_ONLY_SESSION, false);
  assert.equal(response.persistence.configured, false);
  assert.equal(response.session.canEdit, false);
});

test('v2 sessions resolve all four profile identities and roles on the server', () => {
  const config = { pin: TEST_PIN, secret: TEST_SECRET, secure: true };
  const now = 1_790_000_000_000;
  for (const profile of WORKSPACE_PROFILES) {
    const result = createSession(profile.id, config, now);
    const session = verifySession(result.token, config, now);
    assert.deepEqual(session, { profileId: profile.id, canEdit: true, canApprove: profile.canApprove, name: profile.name, expiresAt: result.session.expiresAt });
    const payload = JSON.parse(Buffer.from(result.token.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(payload.v, 2);
    assert.equal(payload.profileId, profile.id);
    assert.equal(payload.name, undefined);
    assert.equal(payload.canApprove, undefined);
    assert.equal(payload.pin, undefined);
  }
});

test('session signatures reject tampering, expiry, PIN rotation, v1 tokens and extra role claims', () => {
  const config = { pin: TEST_PIN, secret: TEST_SECRET, secure: true };
  const now = 1_790_000_000_000;
  const result = createSession('amir', config, now);
  assert.equal(verifySession(result.token, config, now).canEdit, true);
  assert.equal(verifySession(`${result.token.slice(0, -5)}AAAAA`, config, now).canEdit, false);
  assert.equal(verifySession(result.token, config, now + 12 * 60 * 60 * 1000).canEdit, false);
  const otherPin = ((Number(TEST_PIN) + 1) % 1_000_000).toString().padStart(6, '0');
  assert.equal(verifySession(result.token, { ...config, pin: otherPin }, now).canEdit, false);
  const iat = Math.floor(now / 1000);
  const signTestPayload = (value: unknown) => {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    const key = createHmac('sha256', config.secret).update(`session-v2:${config.pin}`).digest();
    return `${encoded}.${createHmac('sha256', key).update(encoded).digest('base64url')}`;
  };
  for (const payload of [{ v: 1, name: 'Dennis', iat, exp: iat + 43200 }, { v: 2, profileId: 'amir', canApprove: true, name: 'Dennis', iat, exp: iat + 43200 }, { v: 2, profileId: 'unknown', iat, exp: iat + 43200 }]) assert.equal(verifySession(signTestPayload(payload), config, now).canEdit, false);
  assert.ok(pinMatches(TEST_PIN, TEST_PIN));
  assert.ok(!pinMatches(otherPin, TEST_PIN));
  const cookie = sessionCookie(result.token, config);
  assert.match(cookie, /^__Host-postalytics-edit=/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!JSON.stringify(result.session).includes(TEST_PIN));
});

test('login accepts only known profiles and six-digit string PINs without client role claims', () => {
  assert.deepEqual(validateLogin({ profileId: 'dennis', pin: TEST_PIN }), { profileId: 'dennis', pin: TEST_PIN });
  assert.doesNotThrow(() => validateLogin({ profileId: 'amir', pin: '0'.repeat(6) }));
  for (const pin of [Number(TEST_PIN), TEST_PIN.slice(0, 5), `${TEST_PIN}0`, ` ${TEST_PIN}`, 'abcdef']) assert.throws(() => validateLogin({ profileId: 'amir', pin }), /six-digit/);
  assert.throws(() => validateLogin({ profileId: 'unknown', pin: TEST_PIN }), /profiles/);
  assert.throws(() => validateLogin({ profileId: 'amir', pin: TEST_PIN, canApprove: true }), /unsupported field/);
  assert.throws(() => validateLogin({ profileId: 'amir', pin: TEST_PIN, name: 'Dennis' }), /unsupported field/);
  const beforePin = process.env.MIGRATION_ACCESS_PIN;
  const beforeSecret = process.env.MIGRATION_SESSION_SECRET;
  try {
    process.env.MIGRATION_ACCESS_PIN = TEST_PIN;
    process.env.MIGRATION_SESSION_SECRET = TEST_SECRET;
    assert.equal(authConfig()?.pin, TEST_PIN);
    process.env.MIGRATION_ACCESS_PIN = TEST_PIN.slice(0, 5);
    assert.equal(authConfig(), null);
    delete process.env.MIGRATION_ACCESS_PIN;
    assert.equal(authConfig(), null);
  } finally {
    if (beforePin === undefined) delete process.env.MIGRATION_ACCESS_PIN; else process.env.MIGRATION_ACCESS_PIN = beforePin;
    if (beforeSecret === undefined) delete process.env.MIGRATION_SESSION_SECRET; else process.env.MIGRATION_SESSION_SECRET = beforeSecret;
  }
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
  await saveMutation(first, seeds, validateMutation({ type: 'task.comment', taskId: 'task-a', text: 'Persistent note across instances.' }), 'amir');
  assert.equal(projectLedger(await readWorkspace(second)).taskOverrides['task-a'].comments?.[0].text, 'Persistent note across instances.');
  await assert.rejects(second.write('postalytics-migration/workspace-v1.json', {}, null), ConditionalWriteConflict);
});

test('corrupted or truncated audit records fail closed rather than resetting shared work', () => {
  assert.throws(() => assertLedger({ schemaVersion: 1, revision: 1, createdAt: '2026-01-01', events: [] }), /unsupported format/);
  assert.throws(() => assertLedger({ schemaVersion: 2, revision: 0, createdAt: '2026-01-01', events: [] }), /unsupported format/);
});
