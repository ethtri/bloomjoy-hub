import type {
  RefundCaseRecord,
  RefundOperationsOverview,
  RefundOperationsSupplements,
} from './refundOperations.ts';

export const mergeRefundOperationsSupplements = (
  overview: RefundOperationsOverview,
  supplements: RefundOperationsSupplements | undefined,
): RefundOperationsOverview => {
  // The overview RPC owns payment and selection authority. These reads add email
  // drafts and queue presentation only, so an unavailable supplement must never
  // replace an authoritative server capability with a client-created block.
  if (!supplements) return overview;

  const coreCaseIds = new Set(overview.cases.map((refundCase) => refundCase.id));
  const internalTestCaseIds = new Set(
    (overview.internalTestCases ?? []).map((refundCase) => refundCase.id),
  );
  const gmailDrafts = supplements.gmailDrafts.filter(
    (refundCase) =>
      !internalTestCaseIds.has(refundCase.id) && !coreCaseIds.has(refundCase.id),
  );
  const queueStateByCaseId = new Map(
    supplements.queueStates.map((state) => [state.caseId, state] as const),
  );
  const cases = [...gmailDrafts, ...overview.cases].map((refundCase) => {
    const state = queueStateByCaseId.get(refundCase.id);
    const enrichedCase: RefundCaseRecord = {
      ...refundCase,
      ...(state ? {
        intakeSource: state.intakeSource,
        exactCasePath: state.exactCasePath,
        missingInformation: state.missingInformation,
        possibleDuplicate: state.possibleDuplicate,
        confirmedDuplicate: state.confirmedDuplicate,
        duplicateOfCaseId: state.duplicateOfCaseId,
        aging: state.aging,
        providerHold: state.providerHold,
        providerOutcome: state.providerOutcome,
        legacyStateReviewRequired: state.legacyStateReviewRequired,
        reconciliationActionBlocked: state.actionBlocked,
      } : {}),
    };
    return enrichedCase;
  });

  return { ...overview, cases };
};
