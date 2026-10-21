import type { Decision, DecisionFields } from './portalTypes';

export type DecisionDraft = Pick<DecisionFields, 'approvalStatus' | 'approvedAction' | 'approvedTarget' | 'evidence' | 'notes'>;

// These describe treatments only. The source questions and dependencies remain
// visible for the reviewer; a default never records an approval by itself.
const RETAIN = new Set([
  'Retain at same URL',
  'Retain functional route',
  'Retain asset at same URL',
  'Retain episode at same URL',
  'Retain archive route subject to CMS policy',
  'Retain generated route pending ownership review',
  'Retain pending campaign review',
  'Retain pending content-role review',
  'Retain pending offer review',
  'Retain pending programme review',
  'Retain pending support mapping',
  'Retain pending workflow review',
  'Retain podcast archive pending CMS decision',
  'Preserve archive pagination',
  'Preserve query handling; no separate import',
  'Preserve site-search behaviour',
]);
const REDIRECT = new Set([
  'Consolidate duplicate legacy documentation',
  'Consolidate into existing page (proposed)',
  'Consolidate legacy documentation into current support article',
  'Correct apparent topic mismatch',
  'Normalize URL variant',
  'Preserve and shorten existing redirect chain',
  'Preserve current redirect subject to journey review',
  'Preserve current redirect subject to workflow review',
  'Preserve current route subject to sample-journey review',
  'Preserve existing directory redirect',
  'Preserve existing redirect',
  'Preserve existing support-service redirect',
  'Repair broken HubSpot support redirect',
  'Repair broken agency documentation folder',
  'Repair broken documentation directory redirect',
  'Repair broken documentation redirect',
  'Repair broken legacy support alias',
  'Repair broken support-service article redirect',
]);
const FIX_LINK = new Set(['Fix malformed internal link', 'Normalize link spelling; no redirect rule']);

export function recommendationFor(decision: Pick<Decision, 'proposedAction' | 'proposedTarget'>) {
  const label = decision.proposedAction.trim();
  let action: DecisionFields['approvedAction'] = 'Hold';
  if (RETAIN.has(label)) action = 'Retain';
  else if (REDIRECT.has(label)) action = 'Redirect';
  else if (label === 'Retain separate service and existing URL') action = 'External service';
  else if (FIX_LINK.has(label)) action = 'Fix link';
  // Review/unknown labels stay unresolved, even when a candidate target exists.
  return { action, target: decision.proposedTarget, needsDecision: action === 'Hold' };
}

export function decisionDraftFields(decision: Decision): DecisionDraft {
  return {
    approvalStatus: decision.approvalStatus,
    approvedAction: decision.approvedAction,
    approvedTarget: decision.approvedTarget,
    evidence: decision.evidence,
    notes: decision.notes,
  };
}

export function initialDecisionDraft(decision: Decision, approvalStatus?: DecisionFields['approvalStatus']): DecisionDraft {
  const fields = decisionDraftFields(decision);
  if (decision.revision === 0 && decision.approvalStatus !== 'Approved') {
    const recommendation = recommendationFor(decision);
    fields.approvedAction = recommendation.action;
    fields.approvedTarget = recommendation.target;
  }
  if (approvalStatus) fields.approvalStatus = approvalStatus;
  return fields;
}
