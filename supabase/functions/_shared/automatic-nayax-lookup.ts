import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { deriveRefundMissingFields } from "./refund-deterministic-follow-up.ts";

export type AutomaticNayaxLookupSource =
  | "hosted_intake"
  | "linked_customer_update"
  | "customer_reply_recheck";

export type AutomaticNayaxLookupCase = {
  id: string;
  status: string;
  decision: string | null;
  reporting_machine_id: string | null;
  reporting_location_id: string | null;
  intake_selection_key?: string | null;
  intake_selection_kind?: string | null;
  intake_selection_machine_ids?: string[] | null;
  incident_at: string | null;
  incident_time_resolution: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  card_last4: string | null;
  card_network: string | null;
  card_wallet_used: boolean | null;
  deterministic_fact_version: number;
};

type AutomaticLookupDependencies = {
  enqueue: (input: {
    caseId: string;
    factVersion: number;
    source: AutomaticNayaxLookupSource;
  }) => Promise<{
    status: "scheduled" | "deduplicated" | "not_ready" | "stale";
  }>;
};

const terminalStatuses = new Set(["approved", "denied", "completed", "closed"]);

export const isRefundCaseReadyForAutomaticNayaxLookup = (
  refundCase: AutomaticNayaxLookupCase,
) => {
  const hasExactLivermoreScope =
    refundCase.intake_selection_kind === "livermore_pair" &&
    Boolean(refundCase.intake_selection_key) &&
    Array.isArray(refundCase.intake_selection_machine_ids) &&
    refundCase.intake_selection_machine_ids.length === 2;
  if (
    refundCase.payment_method !== "card" ||
    refundCase.decision !== null ||
    terminalStatuses.has(refundCase.status) ||
    refundCase.status === "draft" ||
    refundCase.status === "waiting_on_customer" ||
    (!refundCase.reporting_machine_id && !hasExactLivermoreScope) ||
    !refundCase.reporting_location_id
  ) return false;

  return deriveRefundMissingFields({
    reportingMachineId: refundCase.reporting_machine_id ??
      (hasExactLivermoreScope ? "server-owned-grouped-selection" : null),
    reportingLocationId: refundCase.reporting_location_id,
    incidentAt: refundCase.incident_at,
    incidentTimeResolution: refundCase.incident_time_resolution,
    paymentMethod: refundCase.payment_method,
    paymentAmountCents: refundCase.payment_amount_cents,
    cardLast4: refundCase.card_last4,
    cardWalletUsed: refundCase.card_wallet_used,
  }).missingFields.length === 0;
};

// Event handlers only create the durable generation-zero queue row. The sweep is
// the single owner of begin/read/persist, so event and scheduled work cannot race
// into separate provider reads. The sweep also backfills a missed event enqueue.
export const coordinateAutomaticNayaxLookup = async ({
  refundCase,
  source,
  dependencies,
}: {
  refundCase: AutomaticNayaxLookupCase;
  source: AutomaticNayaxLookupSource;
  dependencies: AutomaticLookupDependencies;
}) => {
  if (!isRefundCaseReadyForAutomaticNayaxLookup(refundCase)) {
    return { status: "not_ready" as const };
  }
  return await dependencies.enqueue({
    caseId: refundCase.id,
    factVersion: refundCase.deterministic_fact_version,
    source,
  });
};

export const runAutomaticNayaxLookupIfReady = async ({
  supabase,
  caseId,
  source,
  expectedFactVersion,
}: {
  supabase: SupabaseClient;
  caseId: string;
  source: AutomaticNayaxLookupSource;
  expectedFactVersion?: number;
}) => {
  const { data, error } = await supabase.from("refund_cases").select(`
    id,status,decision,reporting_machine_id,reporting_location_id,
    intake_selection_key,intake_selection_kind,intake_selection_machine_ids,incident_at,
    incident_time_resolution,payment_method,payment_amount_cents,card_last4,card_network,
    card_wallet_used,deterministic_fact_version
  `).eq("id", caseId).maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not_ready" as const };
  const refundCase = data as AutomaticNayaxLookupCase;
  if (
    expectedFactVersion !== undefined &&
    refundCase.deterministic_fact_version !== expectedFactVersion
  ) return { status: "stale" as const };

  return await coordinateAutomaticNayaxLookup({
    refundCase,
    source,
    dependencies: {
      enqueue: async ({ caseId: currentCaseId, factVersion }) => {
        const { data: enqueueData, error: enqueueError } = await supabase.rpc(
          "service_enqueue_refund_nayax_lookup",
          {
            p_refund_case_id: currentCaseId,
            p_expected_fact_version: factVersion,
          },
        );
        if (enqueueError) throw enqueueError;
        const status = String(enqueueData?.status ?? "");
        if (
          !["scheduled", "deduplicated", "not_ready", "stale"].includes(status)
        ) {
          throw new Error(
            "Automatic Nayax lookup enqueue returned an invalid status.",
          );
        }
        return {
          status: status as
            | "scheduled"
            | "deduplicated"
            | "not_ready"
            | "stale",
        };
      },
    },
  });
};
