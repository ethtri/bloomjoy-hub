const sanitizeText = (value, maxLength = 160) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const extractRecords = (payload, keys) => {
  if (Array.isArray(payload)) return payload;
  const record = typeof payload === "object" && payload !== null ? payload : {};
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
};

const parseDate = (value) => {
  const raw = sanitizeText(value, 120);
  if (!raw) return null;
  const candidates = [raw];
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    candidates.unshift(`${raw}Z`);
  }
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const moneyToCents = (value) => {
  if (value === null || typeof value === "undefined") return null;
  const numeric = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : null;
};

const productCodeFrom = (record) => {
  const direct = sanitizeText(
    record.SelectionNumber ??
      record.SelectionNum ??
      record.Selection ??
      record.ProductCode ??
      record.SlotNumber ??
      record.SpiralNumber ??
      record.Motor,
    40,
  );
  if (direct) return direct;

  const rawName = sanitizeText(record.ProductName ?? record.Name ?? record.Description, 160);
  const encodedSelection = rawName.match(/(?:unknown|selection)?\s*\(?\s*([a-z0-9_-]+)\s*=\s*\d+(?:\.\d+)?\s*\)?/i);
  return encodedSelection?.[1] ?? "";
};

const productLabelFrom = (record, productCode) => {
  const rawName = sanitizeText(record.ProductName ?? record.Name ?? record.Description, 160);
  if (rawName && !/^unknown\s*\(/i.test(rawName)) return rawName;
  return productCode ? `Selection ${productCode}` : "";
};

const productPriceFrom = (record) =>
  moneyToCents(
    record.Price ??
      record.ProductPrice ??
      record.UnitPrice ??
      record.SalePrice ??
      record.AuthorizationValue ??
      record.SettlementValue,
  );

const buildProductCatalog = (payload) =>
  extractRecords(payload, ["data", "Data", "products", "Products", "items", "Items", "result", "Result"])
    .map((item) => {
      const record = typeof item === "object" && item !== null ? item : {};
      const code = productCodeFrom(record);
      const label = productLabelFrom(record, code);
      const priceCents = productPriceFrom(record);
      return code || label || priceCents !== null ? { code, label, priceCents } : null;
    })
    .filter(Boolean)
    .slice(0, 200);

const statusTextFrom = (payload) => {
  const record = typeof payload === "object" && payload !== null ? payload : {};
  const nestedSource = record.data ?? record.Data;
  const nested = typeof nestedSource === "object" && nestedSource !== null ? nestedSource : {};
  const source = { ...record, ...nested };
  if (source.IsOnline === true || source.isOnline === true) return "online";
  if (source.IsOnline === false || source.isOnline === false) return "offline";
  return sanitizeText(
    source.MachineStatus ??
      source.machineStatus ??
      source.OnlineStatus ??
      source.onlineStatus ??
      source.ConnectivityStatus ??
      source.connectivityStatus ??
      source.Status ??
      source.status,
    80,
  ).toLowerCase();
};

const buildMachineStatus = (payload, checkedAt) => {
  const statusText = statusTextFrom(payload);
  const attention = /offline|disconnect|error|fault|down|inactive|not communicating/.test(statusText);
  const online = /online|connected|active|normal|operational|communicating/.test(statusText);
  if (attention) {
    return {
      state: "attention",
      label: "Nayax reported that the machine may need attention when this lookup ran",
      checkedAt,
    };
  }
  if (online) {
    return {
      state: "online",
      label: "Nayax reported the machine online when this lookup ran",
      checkedAt,
    };
  }
  return {
    state: "unknown",
    label: "Nayax did not provide a clear current machine status",
    checkedAt,
  };
};

const buildAlerts = (payload) =>
  extractRecords(payload, ["data", "Data", "alerts", "Alerts", "items", "Items", "result", "Result"])
    .map((item) => {
      const record = typeof item === "object" && item !== null ? item : {};
      const category = sanitizeText(
        record.AlertTypeName ??
          record.AlertCategoryName ??
          record.Category ??
          record.AlertName ??
          record.Name ??
          record.Description,
        100,
      );
      const occurredAt = parseDate(
        record.AlertDateTimeGMT ??
          record.AlertDateTime ??
          record.StartDateTime ??
          record.CreateDate ??
          record.CreatedAt ??
          record.Timestamp ??
          record.Date,
      );
      return category && occurredAt ? { category, occurredAt: occurredAt.toISOString() } : null;
    })
    .filter(Boolean)
    .slice(0, 200);

export const buildNayaxMachineContext = ({
  productsPayload,
  statusPayload,
  alertsPayload,
  checkedAt,
}) => ({
  checkedAt,
  products: buildProductCatalog(productsPayload),
  status: buildMachineStatus(statusPayload, checkedAt),
  alerts: buildAlerts(alertsPayload),
});

export const buildNayaxCandidateContext = ({ record, machineContext, authorizedAt }) => {
  const providerRecord = typeof record === "object" && record !== null ? record : {};
  const productCode = productCodeFrom(providerRecord);
  const directLabel = productLabelFrom(providerRecord, productCode);
  const transactionPriceCents = productPriceFrom(providerRecord);
  const catalog = Array.isArray(machineContext?.products) ? machineContext.products : [];
  const configuredProduct = productCode
    ? catalog.find((product) => product.code === productCode) ?? null
    : directLabel
    ? catalog.find((product) => product.label.toLowerCase() === directLabel.toLowerCase()) ?? null
    : null;
  const standardPriceCents = configuredProduct?.priceCents ?? null;
  const authorizationDate = parseDate(authorizedAt);
  const alerts = Array.isArray(machineContext?.alerts) ? machineContext.alerts : [];
  const nearbyMachineAlerts = authorizationDate
    ? alerts
        .map((alert) => ({ ...alert, date: parseDate(alert.occurredAt) }))
        .filter((alert) => alert.date && Math.abs(alert.date.getTime() - authorizationDate.getTime()) <= 2 * 60 * 60 * 1000)
        .sort(
          (left, right) =>
            Math.abs(left.date.getTime() - authorizationDate.getTime()) -
            Math.abs(right.date.getTime() - authorizationDate.getTime()),
        )
        .slice(0, 3)
        .map(({ category, occurredAt }) => ({ category, occurredAt }))
    : [];

  return {
    productLabel: configuredProduct?.label || directLabel,
    productCode,
    standardPriceCents,
    priceMatchesMachineConfiguration:
      transactionPriceCents !== null && standardPriceCents !== null
        ? transactionPriceCents === standardPriceCents
        : null,
    machineStatus: machineContext?.status ?? null,
    nearbyMachineAlerts,
  };
};
