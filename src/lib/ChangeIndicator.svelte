<script>
  //  identify the series and provide the metadata lookup
  export let seriesId = "";
  export let metadataBySeries = {}; // passed from +page.svelte via data.metadataBySeries

  // Optional label prop for year-over-year indicator
  export let label = "";

  // Control whether to show the label text
  export let showLabel = true;

  // Use a fixed assessment when displaying the indicator outside a data card
  export let assessmentOverride = null;
  export let compact = false;

  // Show comparison date text under the indicator when needed
  export let showSinceDate = false;
  export let comparisonDate = null;
  export let comparisonValueText = "";
  export let comparisonDateText = "";

  // Colours
  export let noChangeBackground = "#E2E6ED";
  export let noChangeTextColor = "#364C60";
  export let decreaseBackground = "#FAD9CB";
  export let increaseBackground = "#D2E2CB";
  export let increaseArrowColor = "#195000";
  export let decreaseArrowColor = "#AD001F";
  export let notAssessedTextColor = "#656565";
  export let notAssessedBorderColor = "#DADADA";
  function normalizeAssessment(value) {
    const v = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!v) return null;
    if (v === "improved") return "improved";
    if (v === "worsened") return "worsened";
    if (v === "no change") return "no change";
    if (v === "not assessed" || v === "not-assessed") return "not assessed";
    return null;
  }

  // 🔎 Determine the label text
  let changeContextLabel;

  if (label === "year") {
    changeContextLabel = "Long term";
  } else {
    changeContextLabel = "Short term";
  }

  const indicatorMeta = metadataBySeries?.[seriesId] ?? {};
  const assessmentValue =
    label === "year"
      ? indicatorMeta?.assessment_lt
      : indicatorMeta?.assessment_st;
  const assessment = normalizeAssessment(assessmentOverride ?? assessmentValue);

  function formatComparisonDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function includesMonthOrQuarter(value) {
    const text = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!text) return false;

    if (/\bquarter\b|\bq[1-4]\b/.test(text)) {
      return true;
    }

    return /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(
      text
    );
  }

  function isCustomDateRange(value) {
    const text = String(value ?? "").trim();
    if (!text) return false;

    // Treat textual or numeric ranges as custom labels and avoid forced split.
    return /\bto\b|[-–—]/i.test(text);
  }

  const sinceDateText =
    comparisonDateText || formatComparisonDate(comparisonDate);
  const shouldBreakSinceDateLine =
    includesMonthOrQuarter(sinceDateText) && !isCustomDateRange(sinceDateText);

  const comparisonPrefix =
    assessment === "improved"
      ? "Up from"
      : assessment === "worsened"
      ? "Down from"
      : "From";
</script>

{#if showLabel}
  <p class="text-indicator-sm">
    {changeContextLabel}
  </p>
{/if}

{#if !assessment}
  <div
    class="indicator-area no-change"
    class:compact
    style="background:{noChangeBackground}"
  >
    <span class="indicator-label">Not available</span>
  </div>
{:else if assessment === "no change"}
  <div
    class="indicator-area no-change"
    class:compact
    style="background:{noChangeBackground}; color:{noChangeTextColor}"
  >
    <span class="indicator-label">Stable</span>
  </div>
{:else if assessment === "improved"}
  <div
    class="indicator-area increase"
    class:compact
    style="background:{increaseBackground}; color:{increaseArrowColor}"
  >
    <span class="indicator-label">Improved</span>
  </div>
{:else if assessment === "not assessed"}
  <div
    class="indicator-area not-assessed"
    class:compact
    style="color:{notAssessedTextColor}; --not-assessed-border-color:{notAssessedBorderColor}"
  >
    <span class="indicator-label">Not assessed</span>
  </div>
{:else}
  <div
    class="indicator-area decrease"
    class:compact
    style="background:{decreaseBackground}; color:{decreaseArrowColor}"
  >
    <span class="indicator-label">Worsened</span>
  </div>
{/if}

{#if showSinceDate && comparisonValueText && sinceDateText}
  <p class="text-indicator-period">
    {#if shouldBreakSinceDateLine}
      <span class="text-indicator-period-line"
        >{comparisonPrefix} {comparisonValueText} in</span
      >
      <span class="text-indicator-period-line text-indicator-period-date"
        >{sinceDateText}</span
      >
    {:else}
      <span class="text-indicator-period-balanced"
        >{comparisonPrefix} {comparisonValueText} in {sinceDateText}</span
      >
    {/if}
  </p>
{/if}

<style>
  .text-indicator-sm {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 0;
    margin-top: 10px;
  }

  .indicator-area {
    font-size: 17px;
    font-weight: 700;
    padding: 10px 13px 10px 10px;
    margin-top: 6px;
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
    box-sizing: border-box;
  }

  .indicator-area.compact {
    padding: 4px 8px;
    margin-top: 0;
  }

  .indicator-area::before {
    content: "Not assessed";
    grid-area: 1 / 1;
    visibility: hidden;
    white-space: nowrap;
  }

  .indicator-label {
    grid-area: 1 / 1;
    white-space: nowrap;
  }

  .not-assessed {
    position: relative;
    background: transparent;
  }

  .not-assessed::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid var(--not-assessed-border-color, #dadada);
    pointer-events: none;
    box-sizing: border-box;
  }

  .text-indicator-period {
    font-size: 14px;
    margin: 6px 0 0;
    line-height: 1.35;
  }

  .text-indicator-period-line {
    display: block;
  }

  .text-indicator-period-balanced {
    display: block;
    text-wrap: balance;
  }
</style>
