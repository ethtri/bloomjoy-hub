export class RefundNayaxCompletionMessageLaneBlockedError extends Error {
  constructor() {
    super("nayax_completion_customer_message_lane_blocked");
    this.name = "RefundNayaxCompletionMessageLaneBlockedError";
  }
}

export const assertOpenNayaxCompletionMessageLane = async ({
  checkOpen,
}: {
  checkOpen: () => Promise<boolean>;
}): Promise<void> => {
  if (await checkOpen() !== true) {
    throw new RefundNayaxCompletionMessageLaneBlockedError();
  }
};
