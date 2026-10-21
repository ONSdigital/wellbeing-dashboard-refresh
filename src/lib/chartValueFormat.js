import { format } from "d3-format";

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

  if (customDpEnabled && dpOverride !== null) {
    if (unitsChart === "percentage") {
      const dp = dpOverride;
      const rounded = Math.round(numeric * 10 ** dp) / 10 ** dp;
      return format(`.${dp}%`)(rounded / 100);
    }
    return format(`,.${dpOverride}f`)(numeric);
  }

  if (unitsChart === "percentage") {
    const dp = numeric < 20 ? 1 : hasDecimalTicks ? 1 : 0;
    const rounded = Math.round(numeric * 10 ** dp) / 10 ** dp;
    return format(`.${dp}%`)(rounded / 100);
  }

  return numeric < 20
    ? format(",.1f")(numeric)
    : format(hasDecimalTicks ? ",.1f" : ",.0f")(numeric);
}