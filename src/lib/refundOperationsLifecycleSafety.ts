import {
  isRefundLifecycleContract,
  type RefundLifecycleContract,
} from './refundLifecycle';

type LifecycleBearingRefundCase = {
  lifecycle?: unknown;
  canPerformOfficialAction?: boolean;
  canSelectNayaxCandidate?: boolean;
  officialActionBlockReason?: string | null;
};

export type RefundLifecycleSafetyResult<T> = {
  refundCase: T & { lifecycle: RefundLifecycleContract | null };
  invalidLifecycle: boolean;
};

export const applyRefundLifecycleSafety = <T extends LifecycleBearingRefundCase>(
  refundCase: T,
): RefundLifecycleSafetyResult<T> => {
  if (refundCase.lifecycle == null) {
    return {
      refundCase: { ...refundCase, lifecycle: null },
      invalidLifecycle: false,
    };
  }

  if (isRefundLifecycleContract(refundCase.lifecycle)) {
    return {
      refundCase: { ...refundCase, lifecycle: refundCase.lifecycle },
      invalidLifecycle: false,
    };
  }

  return {
    refundCase: {
      ...refundCase,
      lifecycle: null,
      canPerformOfficialAction: false,
      canSelectNayaxCandidate: false,
      officialActionBlockReason: 'official_actions_disabled',
    },
    invalidLifecycle: true,
  };
};
