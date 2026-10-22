import { format } from "d3-format";

function normalizeUnitsChart(unitsChart) {
  return String(unitsChart ?? "").trim().toLowerCase();
}

function isPercentageUnits(unitsChart) {
  const normalized = normalizeUnitsChart(unitsChart);
  return normalized === "percentage" || normalized === "percent";
}

function isCurrencyUnits(unitsChart) {
  const normalized = normalizeUnitsChart(unitsChart);
  return (
    normalized === "currency" ||
    normalized === "gbp" ||
    normalized === "pound" ||
    normalized === "pounds" ||
    normalized === "sterling" ||
    normalized === "\u00a3"
  );
}

function formatGbp(value, dp) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value);
}

export function formatChartEndValue(
  value,
  {
    unitsChart,
    customDpEnabled = false,
    dpOverride = null,
    hasDecimalTicks = false,
  } = {}
) {
  if (value === null || value === undefined) return "";

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "";

  const isPercentage = isPercentageUnits(unitsChart);
  const isCurrency = isCurrencyUnits(unitsChart);

  if (customDpEnabled && dpOverride !== null) {
    if (isPercentage) {
      const dp = dpOverride;
      const rounded = Math.round(numeric * 10 ** dp) / 10 ** dp;
      return format(`.${dp}%`)(rounded / 100);
    }
    if (isCurrency) {
      return formatGbp(numeric, dpOverride);
    }
    return format(`,.${dpOverride}f`)(numeric);
  }

  if (isPercentage) {
    const dp = 1;
    const rounded = Math.round(numeric * 10 ** dp) / 10 ** dp;
    return format(`.${dp}%`)(rounded / 100);
  }

  if (isCurrency) {
    const dp = numeric < 20 ? 1 : hasDecimalTicks ? 1 : 0;
    return formatGbp(numeric, dp);
  }

  return numeric < 20
    ? format(",.1f")(numeric)
    : format(hasDecimalTicks ? ",.1f" : ",.0f")(numeric);
}