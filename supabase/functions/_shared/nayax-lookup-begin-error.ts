type NayaxLookupBeginError = {
  code?: unknown;
};

export type NayaxLookupBeginFailure = {
  status: 403 | 409;
  body: {
    errorCode: "lookup_access_required" | "lookup_precondition_conflict";
    error: string;
  };
};

export const classifyNayaxLookupBeginError = (
  error: unknown,
): NayaxLookupBeginFailure | null => {
  const code = typeof error === "object" && error !== null
    ? (error as NayaxLookupBeginError).code
    : null;

  if (code === "P4622") {
    return {
      status: 409,
      body: {
        errorCode: "lookup_precondition_conflict",
        error:
          "No transaction check was started. Follow the case's current next step before checking again.",
      },
    };
  }

  if (code === "42501") {
    return {
      status: 403,
      body: {
        errorCode: "lookup_access_required",
        error:
          "Current refund case access is required before checking transactions.",
      },
    };
  }

  return null;
};
