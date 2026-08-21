export type RefundBrandDetail = {
  label: string;
  value: string;
};

export type RefundBrandLink = {
  label: string;
  url: string;
};

export type RefundBrandEmailInput = {
  preheader: string;
  eyebrow?: string;
  headline: string;
  greeting?: string | null;
  paragraphs: string[];
  details?: RefundBrandDetail[];
  primaryLink?: RefundBrandLink | null;
  secondaryLink?: RefundBrandLink | null;
  replyLine?: string | null;
  safetyLine?: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const paragraphHtml = (paragraph: string) =>
  `<p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:15px;line-height:24px;margin:0 0 16px;color:#382b35;">${
    escapeHtml(paragraph).replaceAll("\n", "<br />")
  }</p>`;

const safeHttpsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};

export const renderBloomjoyRefundEmail = ({
  preheader,
  eyebrow = "Bloomjoy customer care",
  headline,
  greeting,
  paragraphs,
  details = [],
  primaryLink,
  secondaryLink,
  replyLine = "You can reply directly to this email if anything looks off.",
  safetyLine,
}: RefundBrandEmailInput) => {
  const primaryUrl = primaryLink ? safeHttpsUrl(primaryLink.url) : "";
  const secondaryUrl = secondaryLink ? safeHttpsUrl(secondaryLink.url) : "";
  const detailRows = details
    .filter((detail) => detail.label.trim() && detail.value.trim())
    .map((detail) => `
      <tr>
        <td valign="top" style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:12px;line-height:18px;color:#765f70;padding:5px 12px 5px 0;">${
      escapeHtml(detail.label)
    }</td>
        <td valign="top" align="right" style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#382b35;padding:5px 0;">${
      escapeHtml(detail.value)
    }</td>
      </tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:#fbf4ec;color:#382b35;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${
    escapeHtml(preheader)
  }</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fbf4ec;">
      <tr>
        <td align="center" style="padding:24px 12px 36px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#fffdfa;border:1px solid #ead7d1;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(79,45,60,.08);">
            <tr>
              <td style="background:#b83d64;padding:10px 28px;">
                <span style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:11px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:#fff8f1;">${
    escapeHtml(eyebrow)
  }</span>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 22px;border-bottom:1px solid #f0dfda;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:38px;font-weight:700;color:#4d2738;">${
    escapeHtml(headline)
  }</div>
                <div style="width:52px;height:4px;background:#f4ad6f;border-radius:99px;margin-top:18px;line-height:4px;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 30px;">
                ${greeting ? paragraphHtml(greeting) : ""}
                ${paragraphs.map(paragraphHtml).join("")}
                ${
    primaryLink && primaryUrl
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 22px;"><tr><td bgcolor="#b83d64" style="border-radius:999px;"><a href="${
        escapeHtml(primaryUrl)
      }" style="display:inline-block;min-height:20px;padding:13px 22px;font-family:'Trebuchet MS',Verdana,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">${
        escapeHtml(primaryLink.label)
      }</a></td></tr></table>`
      : ""
  }
                ${
    secondaryLink && secondaryUrl
      ? `<p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;line-height:22px;margin:0 0 20px;color:#765f70;"><a href="${
        escapeHtml(secondaryUrl)
      }" style="color:#9b3155;font-weight:700;">${
        escapeHtml(secondaryLink.label)
      }</a></p>`
      : ""
  }
                ${
    detailRows
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fff3ef;border:1px solid #efd9d3;border-radius:14px;margin:4px 0 20px;"><tr><td style="padding:13px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${detailRows}</table></td></tr></table>`
      : ""
  }
                ${
    replyLine
      ? `<p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;line-height:22px;margin:0;color:#684f61;">${
        escapeHtml(replyLine)
      }</p>`
      : ""
  }
                ${
    safetyLine
      ? `<p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:12px;line-height:19px;margin:18px 0 0;color:#816f7c;">${
        escapeHtml(safetyLine)
      }</p>`
      : ""
  }
                <p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;line-height:22px;margin:22px 0 0;color:#684f61;">Warmly,<br /><strong style="color:#4d2738;">The Bloomjoy Sweets Team</strong></p>
              </td>
            </tr>
          </table>
          <p style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:11px;line-height:17px;margin:14px 0 0;color:#8a7783;">Bloomjoy Sweets customer care</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export const renderBloomjoyRefundStoredText = ({
  headline,
  text,
}: {
  headline: string;
  text: string;
}) => {
  const blocks = text.replaceAll("\r\n", "\n").split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const greeting = blocks[0]?.toLowerCase().startsWith("hi ")
    ? blocks.shift() ?? null
    : null;
  const signatureIndex = blocks.findIndex((block) =>
    block.startsWith("Warmly,")
  );
  if (signatureIndex >= 0) blocks.splice(signatureIndex);
  return renderBloomjoyRefundEmail({
    preheader: headline,
    eyebrow: "Bloomjoy refund update",
    headline,
    greeting,
    paragraphs: blocks,
    details: [],
    replyLine: null,
  });
};
