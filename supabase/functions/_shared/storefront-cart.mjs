export const SUGAR_SKUS = new Set([
  "sugar-1kg",
  "sugar-white-1kg",
  "sugar-blue-1kg",
  "sugar-orange-1kg",
  "sugar-red-1kg",
]);

export const MICRO_MACHINE_SKU = "micro";
export const MAX_SUGAR_KG_PER_CHECKOUT = 200000;
export const MAX_MICRO_MACHINES_PER_CHECKOUT = 20;

const createEmptySugarBreakdown = () => ({
  white: 0,
  blue: 0,
  orange: 0,
  red: 0,
});

const normalizeSugarSku = (sku) =>
  sku === "sugar-1kg" ? "sugar-white-1kg" : sku;

export const normalizeStorefrontCart = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Cart is empty." };
  }

  const sugarBreakdown = createEmptySugarBreakdown();
  let microMachineQuantity = 0;

  for (const item of items) {
    const sku = String(item?.sku ?? "");
    const quantity = Number(item?.quantity ?? 0);

    if (!SUGAR_SKUS.has(sku) && sku !== MICRO_MACHINE_SKU) {
      return {
        ok: false,
        error: "This cart contains an item that is not available for checkout.",
        invalidSkus: [sku],
      };
    }

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return { ok: false, error: `Invalid quantity for ${sku || "cart item"}.` };
    }

    if (sku === MICRO_MACHINE_SKU) {
      microMachineQuantity += quantity;
      continue;
    }

    switch (normalizeSugarSku(sku)) {
      case "sugar-white-1kg":
        sugarBreakdown.white += quantity;
        break;
      case "sugar-blue-1kg":
        sugarBreakdown.blue += quantity;
        break;
      case "sugar-orange-1kg":
        sugarBreakdown.orange += quantity;
        break;
      case "sugar-red-1kg":
        sugarBreakdown.red += quantity;
        break;
      default:
        break;
    }
  }

  const totalSugarKg = Object.values(sugarBreakdown).reduce(
    (sum, quantity) => sum + quantity,
    0,
  );

  if (totalSugarKg > MAX_SUGAR_KG_PER_CHECKOUT) {
    return {
      ok: false,
      error: `Sugar quantity exceeds max checkout limit (${MAX_SUGAR_KG_PER_CHECKOUT} KG).`,
    };
  }

  if (microMachineQuantity > MAX_MICRO_MACHINES_PER_CHECKOUT) {
    return {
      ok: false,
      error: `Micro Machine quantity exceeds max checkout limit (${MAX_MICRO_MACHINES_PER_CHECKOUT}).`,
    };
  }

  if (!totalSugarKg && !microMachineQuantity) {
    return { ok: false, error: "No valid items in cart." };
  }

  const orderType = totalSugarKg && microMachineQuantity
    ? "mixed"
    : microMachineQuantity
      ? "micro_machine"
      : "sugar";

  return {
    ok: true,
    orderType,
    sugarBreakdown,
    totalSugarKg,
    microMachineQuantity,
  };
};
