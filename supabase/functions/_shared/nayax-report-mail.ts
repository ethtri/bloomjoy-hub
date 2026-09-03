import {
  decodeGmailBody,
  getGmailHeader,
  type GmailMessage,
  type GmailMessagePart,
  parseEmailAddressList,
} from "./refund-gmail.ts";
import {
  downloadNayaxScheduledReport,
  NAYAX_REPORT_MAX_BYTES,
  normalizeNayaxScheduledReport,
  requireNayaxReportDownloadUrl,
} from "./nayax-scheduled-report.ts";
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export function isNayaxScheduledReportMessage(message: GmailMessage) {
  return parseEmailAddressList(getGmailHeader(message.payload?.headers, "From"))
        .join() === "notifier@nayax.com" &&
    getGmailHeader(message.payload?.headers, "Subject").trim() ===
      "Nayax Transactions Report";
}
const parts = (part: GmailMessagePart | undefined): GmailMessagePart[] =>
  part ? [part, ...(part.parts ?? []).flatMap(parts)] : [];
export async function ingestNayaxReportMail(
  {
    message,
    mailbox,
    rpc,
    getAttachment,
    download = downloadNayaxScheduledReport,
  }: {
    message: GmailMessage;
    mailbox: string;
    rpc: Rpc;
    getAttachment: (
      messageId: string,
      attachmentId: string,
    ) => Promise<Uint8Array>;
    download?: (url: string) => Promise<Uint8Array>;
  },
) {
  if (!isNayaxScheduledReportMessage(message)) {
    return { handled: false, duplicate: false };
  }
  const id = message.id ?? "";
  const headers = message.payload?.headers;
  const authentication = getGmailHeader(headers, "Authentication-Results");
  const alignedDmarc = authentication.split(";").filter((clause) =>
    /^\s*dmarc=/i.test(clause) &&
    /\bheader\.from=nayax\.com(?:\s|$)/i.test(clause)
  );
  // Gmail's receiving-server result, not an arbitrary sender-supplied pass string.
  if (
    !/^[a-f0-9]{1,255}$/i.test(id) ||
    mailbox.toLowerCase() !== "info@bloomjoysweets.com" ||
    !parseEmailAddressList(getGmailHeader(headers, "To")).includes(
      mailbox.toLowerCase(),
    ) ||
    !/^mx\.google\.com\s*;/i.test(authentication) ||
    alignedDmarc.length !== 1 || !/^\s*dmarc=pass\b/i.test(alignedDmarc[0])
  ) throw new Error("nayax_report_sender_unverified");
  const prior = await rpc("service_get_nayax_report_message", {
    p_message_id: id,
  }) as { recorded?: boolean } | null;
  if (prior?.recorded) return { handled: true, duplicate: true };
  const date = new Date(Number(message.internalDate));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("nayax_report_date_invalid");
  }
  const all = parts(message.payload);
  const attachments = all.filter((p) =>
    /^Nayax_R\d+_A2001508696_D\d{8}_\d{6}\.csv$/i.test(p.filename ?? "")
  );
  const html = all.filter((p) => p.mimeType === "text/html").map((p) =>
    decodeGmailBody(p.body?.data, 200000)
  ).join("\n");
  const links = [
    ...new Set(
      [...html.matchAll(
        /href\s*=\s*["'](https:\/\/my\.nayax\.com\/core\/reports\/download\?[^"']+)["']/gi,
      )].map((m) =>
        requireNayaxReportDownloadUrl(m[1].replaceAll("&amp;", "&"))
      ),
    ),
  ];
  if (attachments.length > 1 || (!attachments.length && links.length !== 1)) {
    throw new Error("nayax_report_file_missing_or_ambiguous");
  }
  let bytes: Uint8Array;
  if (attachments.length) {
    const part = attachments[0];
    if (Number(part.body?.size ?? 0) > NAYAX_REPORT_MAX_BYTES) {
      throw new Error("nayax_report_file_too_large");
    }
    if (part.body?.attachmentId) {
      bytes = await getAttachment(id, part.body.attachmentId);
    } else if (part.body?.data) {
      if (part.body.data.length > Math.ceil(NAYAX_REPORT_MAX_BYTES / 3) * 4) {
        throw new Error("nayax_report_file_too_large");
      }
      const binary = atob(
        part.body.data.replaceAll("-", "+").replaceAll("_", "/"),
      );
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    } else throw new Error("nayax_report_attachment_unavailable");
  } else bytes = await download(links[0]);
  const report = await normalizeNayaxScheduledReport(bytes);
  const result = await rpc("service_record_nayax_scheduled_report", {
    p_message_id: id,
    p_received_at: date.toISOString(),
    p_delivery_form: attachments.length ? "attachment" : "linked_download",
    p_report: report,
  }) as { recorded?: boolean; duplicate?: boolean };
  if (result?.recorded !== true) {
    throw new Error("nayax_report_observations_not_recorded");
  }
  return { handled: true, duplicate: result.duplicate === true };
}
