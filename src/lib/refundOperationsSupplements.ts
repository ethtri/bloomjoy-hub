import type {
  RefundCaseRecord,
  RefundOperationsOverview,
  RefundOperationsSupplements,
} from './refundOperations.ts';

const holdOfficialActions = (refundCase: RefundCaseRecord): RefundCaseRecord => ({
  ...refundCase,
  canPerformOfficialAction: false,
  canSelectNayaxCandidate: false,
  officialActionBlockReason: 'official_actions_disabled',
  manualNayaxPortalEnabled: false,
});

export const mergeRefundOperationsSupplements = (
  overview: RefundOperationsOverview,
  supplements: RefundOperationsSupplements | undefined,
): RefundOperationsOverview => {
  const supplementsReady = supplements?.unavailableSources.length === 0;
  if (!supplements) {
    return {
      ...overview,
      cases: overview.cases.map(holdOfficialActions),
    };
  }

  const internalTestCaseIds = new Set(
    (overview.internalTestCases ?? []).map((refundCase) => refundCase.id),
  );
  const gmailDrafts = supplements.gmailDrafts.filter(
    (refundCase) => !internalTestCaseIds.has(refundCase.id),
  );
  const queueStateByCaseId = new Map(
    supplements.queueStates.map((state) => [state.caseId, state] as const),
  );
  const manualNayaxByCaseId = new Map(
    supplements.manualNayaxContexts.map((context) => [context.caseId, context] as const),
  );
  const cases = [...gmailDrafts, ...overview.cases].map((refundCase) => {
    const state = queueStateByCaseId.get(refundCase.id);
    const manualNayax = manualNayaxByCaseId.get(refundCase.id);
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
      ...(manualNayax ? {
        manualNayaxPortalEnabled: manualNayax.manualNayaxPortalEnabled,
        manualNayaxEvidenceSelected: manualNayax.manualNayaxEvidenceSelected,
        manualNayaxLocationTimezone: manualNayax.manualNayaxLocationTimezone,
        reviewedNayaxPortalFallbackKind: manualNayax.reviewedNayaxPortalFallbackKind,
      } : {}),
    };
    return supplementsReady ? enrichedCase : holdOfficialActions(enrichedCase);
  });

  return { ...overview, cases };
};
