import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionDraftFields, initialDecisionDraft, recommendationFor } from '../src/components/decisionRecommendations.ts';
import type { Decision } from '../src/components/portalTypes.ts';

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'D001', url: 'https://example.com/source/', title: 'Example source page',
    group: 'Pages', role: 'Published page', proposedAction: 'Retain at same URL',
    proposedTarget: 'https://example.com/source/', rationale: '', question: '', dependency: '',
    observedStatus: '', observedTarget: '', source: '', sourceUrl: '', checkedAt: '',
    isPage: true, raw: {}, revision: 0, approvalStatus: 'Not approved', approvedAction: '',
    approvedTarget: '', approver: '', approvalDate: '', approvedAt: '', evidence: '', notes: '',
    conditionsConfirmed: false, ...overrides,
  };
}

test('a new recommendation populates the draft without approving or mutating its source', () => {
  const source = decision();
  const original = structuredClone(source);
  assert.deepEqual(initialDecisionDraft(source), {
    approvalStatus: 'Not approved', approvedAction: 'Retain',
    approvedTarget: source.proposedTarget, evidence: '', notes: '',
  });
  assert.deepEqual(source, original);
  assert.equal(source.revision, 0);
  assert.equal(source.approvedAction, '');
});

test('an explicit consolidation uses a redirect draft and its suggested destination', () => {
  const source = decision({
    proposedAction: 'Consolidate into existing page (proposed)',
    proposedTarget: 'https://example.com/consolidated/',
  });
  assert.deepEqual(recommendationFor(source), {
    action: 'Redirect', target: 'https://example.com/consolidated/', needsDecision: false,
  });
  assert.equal(initialDecisionDraft(source).approvalStatus, 'Not approved');
});

test('review and unknown treatments stay on hold even when a candidate URL is present', () => {
  for (const proposedAction of ['Review for retirement', 'Review proposed support destination', 'Review existing redirect for country intent', 'Future unknown redirect proposal']) {
    const source = decision({ proposedAction, proposedTarget: 'https://example.com/candidate/' });
    const result = recommendationFor(source);
    assert.equal(result.action, 'Hold', proposedAction);
    assert.equal(result.needsDecision, true, proposedAction);
    assert.equal(result.target, source.proposedTarget, proposedAction);
    assert.notEqual(initialDecisionDraft(source).approvedAction, 'Retire (410)');
  }
  assert.equal(recommendationFor(decision({ proposedAction: 'Review for retirement', proposedTarget: '' })).target, '');
});

test('link spelling and malformed-scheme corrections are link fixes rather than redirects', () => {
  for (const [proposedAction, url, proposedTarget] of [
    ['Normalize link spelling; no redirect rule', 'https://example.com', 'https://example.com/'],
    ['Fix malformed internal link', 'ttps://example.com/article/', 'https://example.com/article/'],
  ]) {
    assert.deepEqual(recommendationFor(decision({ proposedAction, url, proposedTarget })), {
      action: 'Fix link', target: proposedTarget, needsDecision: false,
    });
  }
});

test('a separate retained service stays separate from a service-owned redirect', () => {
  const service = decision({
    url: 'https://app.example.com/', proposedTarget: 'https://app.example.com/',
    proposedAction: 'Retain separate service and existing URL',
  });
  assert.equal(initialDecisionDraft(service).approvedAction, 'External service');
  const redirect = decision({
    url: 'https://support.example.com/old/', proposedTarget: 'https://support.example.com/current/',
    proposedAction: 'Preserve existing support-service redirect',
  });
  assert.equal(initialDecisionDraft(redirect).approvedAction, 'Redirect');
});

test('saved treatments and notes take precedence over a different recommendation', () => {
  const source = decision({
    revision: 3, approvalStatus: 'Needs discussion', approvedAction: 'Redirect',
    approvedTarget: 'https://example.com/previously-chosen/',
    evidence: 'An earlier meeting note', notes: 'Keep the editor choice for review.',
  });
  assert.deepEqual(initialDecisionDraft(source), decisionDraftFields(source));
  assert.equal(initialDecisionDraft(source).approvedTarget, source.approvedTarget);
  assert.notEqual(initialDecisionDraft(source).approvedTarget, source.proposedTarget);
});

test('saved blank action and destination fields stay blank, including when approval is selected', () => {
  const source = decision({ revision: 1, notes: 'The destination was deliberately left open.' });
  const normal = initialDecisionDraft(source);
  const requested = initialDecisionDraft(source, 'Approved');
  assert.equal(normal.approvedAction, '');
  assert.equal(normal.approvedTarget, '');
  assert.equal(requested.approvedAction, '');
  assert.equal(requested.approvedTarget, '');
  assert.equal(requested.approvalStatus, 'Approved');
  assert.equal(requested.notes, source.notes);
  assert.equal(source.approvalStatus, 'Not approved');
});

test('an already approved source never receives recommendation defaults, even at revision zero', () => {
  const source = decision({
    approvalStatus: 'Approved', approvedAction: 'Redirect',
    approvedTarget: 'https://example.com/agreed/', approver: 'Example reviewer',
    approvalDate: '2026-01-02', evidence: 'Existing approval record.', conditionsConfirmed: true,
  });
  assert.deepEqual(initialDecisionDraft(source), decisionDraftFields(source));
  assert.equal(initialDecisionDraft(source).approvedTarget, 'https://example.com/agreed/');
});

test('a requested approval is confined to the draft and does not invent approval metadata', () => {
  const source = decision();
  const original = structuredClone(source);
  const draft = initialDecisionDraft(source, 'Approved');
  assert.equal(draft.approvalStatus, 'Approved');
  assert.equal(draft.approvedAction, 'Retain');
  assert.equal(draft.approvedTarget, source.proposedTarget);
  assert.equal('approver' in draft, false);
  assert.equal('approvalDate' in draft, false);
  assert.equal('conditionsConfirmed' in draft, false);
  assert.deepEqual(source, original);
});
