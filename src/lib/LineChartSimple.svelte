<script>
  import { scaleLinear, scaleTime } from "d3-scale";
  import { area, line, curveLinear } from "d3-shape";
  import { format } from "d3-format";
  import { timeYear } from "d3-time";
  import { timeFormat } from "d3-time-format";
  import {
    computeTransformedData,
    computeYDomainFromTransformedData,
  } from "$lib/yAxisDomain.js";
  import { toBoolean, toNonNegativeIntOrNull } from "$lib/coerce.js";

  function normalizeUnitsChart(unitsChart) {
    return String(unitsChart ?? "")
      .trim()
      .toLowerCase();
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

  // Props (existing)
  export let data = [];
  export let yKey = "value";
  export let yMax = undefined;
  export let lineColor = "#27a0cc";
  export let title;
  export let units_chart; // e.g., "percentage", "number", "£"
  export let index = false;
  export let thousands = false;
  export let series_id = null; // identifier for this series
  export let thinSeries = null; // which series_id should be thinner
  export let indicator_period = null; // frequency for date formatting (e.g., "monthly", "weekly")
  export let overlaySeries = []; // optional additional series to draw on the same chart

  // Normalize `index` prop so strings like "false"/"0" don't evaluate truthy
  $: indexBoolean = toBoolean(index);

  // Fixed time window
  export let startDate = null; // e.g., new Date(2022, 0, 1)
  export let endDate = null; // e.g., new Date(2025, 11, 31)

  // NEW: metadata object to drive axis options (and anything else)
  export let meta = {};

  // Internals
  // Determine stroke width based on series_id
  let baseStrokeWidth;
  $: baseStrokeWidth = thinSeries && series_id === thinSeries ? 2 : 3;
  $: strokeWidth =
    width && +width < 500 ? baseStrokeWidth - 0.5 : baseStrokeWidth;
  $: thousandsBoolean = toBoolean(thousands);
  let width;
  $: height = +width < 500 ? width * 0.5 : width * 0.4;

  const margin = { left: 58, top: 0, bottom: 30, right: 60 };
  const xKey = "date"; // data[xKey] should be Date objects

  // Transform values to thousands if requested
  $: transformedData = computeTransformedData(data, {
    xKey,
    yKey,
    thousandsBoolean,
    startDate,
  });

  $: overlaySeriesResolved = (Array.isArray(overlaySeries) ? overlaySeries : [])
    .map((series, idx) => {
      const transformed = computeTransformedData(series?.data, {
        xKey,
        yKey,
        thousandsBoolean,
        startDate,
      });

      return {
        series_id: series?.series_id ?? `overlay-${idx}`,
        lineColor: series?.lineColor ?? "#27a0cc",
        thin: !!series?.thin,
        transformed,
      };
    })
    .filter((series) => series.transformed.length > 0);

  $: domainInputData = [
    ...transformedData,
    ...overlaySeriesResolved.flatMap((series) => series.transformed),
  ];

  function toFiniteNumberOrNaN(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      if (!cleaned) return NaN;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  // Optional confidence interval support (ci_lower/ci_upper).
  // Blank or invalid CI values are ignored per row.
  $: ciData = transformedData.map((d) => {
    const rawLower = toFiniteNumberOrNaN(d?.ci_lower);
    const rawUpper = toFiniteNumberOrNaN(d?.ci_upper);
    const lower =
      thousandsBoolean && Number.isFinite(rawLower)
        ? rawLower / 1000
        : rawLower;
    const upper =
      thousandsBoolean && Number.isFinite(rawUpper)
        ? rawUpper / 1000
        : rawUpper;

    return {
      ...d,
      ciLower: Math.min(lower, upper),
      ciUpper: Math.max(lower, upper),
      hasCi: Number.isFinite(lower) && Number.isFinite(upper),
    };
  });

  $: ciValues = ciData.flatMap((d) => (d.hasCi ? [d.ciLower, d.ciUpper] : []));
  $: hasAnyCi = ciValues.length > 0;
  $: ciMin = hasAnyCi ? Math.min(...ciValues) : NaN;
  $: ciMax = hasAnyCi ? Math.max(...ciValues) : NaN;

  // Fallback to data extent if no start/end provided
  $: dataMinDate = transformedData.length
    ? new Date(Math.min(...transformedData.map((d) => +d[xKey])))
    : null;
  $: dataMaxDate = transformedData.length
    ? new Date(Math.max(...transformedData.map((d) => +d[xKey])))
    : null;

  $: effectiveStart = startDate ?? dataMinDate ?? new Date(2000, 0, 1);
  $: effectiveEnd = endDate ?? dataMaxDate ?? new Date(2000, 11, 31);

  // Avoid zero-length domain
  $: [domainStart, domainEnd] =
    +effectiveStart === +effectiveEnd
      ? [
          new Date(effectiveStart.getTime() - 24 * 3600 * 1000),
          new Date(effectiveEnd.getTime() + 24 * 3600 * 1000),
        ]
      : [effectiveStart, effectiveEnd];

  $: x = scaleTime()
    .domain([domainStart, domainEnd])
    .range([margin.left, width - margin.right])
    .clamp(true);

  // --- Y domain calculations driven by metadata ---
  // Pull axis settings from metadata (with sensible defaults)
  $: yMinMode = meta?.yMinMode ?? "auto"; // "zero" | "data" | "above-zero" | "auto"
  $: yPadding = meta?.yPadding ?? 0.1; // 10% padding

  const yTickCount = 5;

  // Optional decimal place override for the last-point label (from metadata.csv)
  $: customDpEnabled = toBoolean(meta?.custom_dp_chart ?? meta?.custom_dp);
  $: dpOverride = toNonNegativeIntOrNull(meta?.dp_chart ?? meta?.dp);

  // Data min/max
  let dataYMin = 0;
  let dataYMax = 100;
  let topMax = 100;
  let computedYMin = 0;
  let paddedMin = 0;
  let paddedMax = 100;
  let niceMin = 0;
  let niceMax = 100;

  $: ({
    dataYMin,
    dataYMax,
    topMax,
    computedYMin,
    paddedMin,
    paddedMax,
    niceMin,
    niceMax,
  } = computeYDomainFromTransformedData({
    transformedData: domainInputData,
    yKey,
    yMax,
    indexBoolean,
    yMinMode,
    yPadding,
    niceCount: yTickCount,
  }));

  $: [yDomainMin, yDomainMax] = (() => {
    let min = paddedMin;
    let max = niceMax;

    if (hasAnyCi) {
      min = Math.min(min, ciMin);
      max = Math.max(max, ciMax);
    }

    if (!(min < max)) max = min + Number.EPSILON;

    return scaleLinear().domain([min, max]).nice(yTickCount).domain();
  })();

  $: y = scaleLinear()
    .domain([yDomainMin, yDomainMax])
    .range([height - margin.bottom, margin.top]);

  $: baselineValue = indexBoolean ? 100 : 0;
  $: baselineInDomain =
    yDomainMin <= baselineValue && baselineValue <= yDomainMax;

  $: yTicks = (() => {
    const ticks = y.ticks(yTickCount);
    if (
      baselineInDomain &&
      !ticks.some((t) => Math.abs(t - baselineValue) < 1e-9)
    ) {
      ticks.push(baselineValue);
      ticks.sort((a, b) => a - b);
    }
    return ticks;
  })();

  $: formatValue = (() => {
    const hasDecimal = yTicks.some((t) => t % 1 !== 0);
    return format(hasDecimal ? ",.1f" : ",.0f");
  })();

  $: formatPercent = (() => {
    const hasDecimal = yTicks.some((t) => t % 1 !== 0);
    return format(hasDecimal ? ".1%" : ".0%");
  })();

  $: formatCurrency = (() => {
    const hasDecimal = yTicks.some((t) => t % 1 !== 0);
    const dp = hasDecimal ? 1 : 0;
    return (value) => formatGbp(value, dp);
  })();

  $: isPercentageChart = isPercentageUnits(units_chart);
  $: isCurrencyChart = isCurrencyUnits(units_chart);

  function isMonthOrQuarterPeriod(period) {
    const p = period?.toLowerCase?.();
    return (
      p === "monthly" || p === "month" || p === "quarterly" || p === "quarter"
    );
  }

  function getQuarterFromDate(date) {
    return Math.floor(date.getMonth() / 3) + 1;
  }

  function isQ3Start(date) {
    return date.getMonth() === 6; // July
  }

  // New prop: showYearDividersAtDomainEdges (default true for backward compatibility)
  export let showYearDividersAtDomainEdges = false;

  function getDateChangesFromDomain(domainStart, domainEnd) {
    const changes = {
      years: [], // year boundary markers (Jan 1)
      yearLabels: [], // { date: Jul 1, year: YYYY }
    };
    if (!domainStart || !domainEnd) return changes;

    // Year starts (Jan 1)
    // Add 1 day to domainEnd to ensure the final year boundary is included
    const yearStarts = timeYear.range(
      timeYear.floor(domainStart),
      timeYear.offset(timeYear.ceil(domainEnd), 1)
    );

    // If not showing dividers at domain edges, remove any divider at or outside the domainStart/domainEnd
    let filteredYearStarts = yearStarts;
    if (!showYearDividersAtDomainEdges && yearStarts.length > 0) {
      filteredYearStarts = yearStarts.filter((d) => {
        // Remove if at or before domainStart, or at or after domainEnd
        if (d <= domainStart) return false;
        if (d >= domainEnd) return false;
        return true;
      });
    }

    for (const ys of filteredYearStarts) {
      changes.years.push(ys);
      // Mid-year label (Jul 1) to replicate Q3 labeling
      const mid = new Date(ys.getFullYear(), 5, 1);
      if (mid >= domainStart && mid <= domainEnd) {
        changes.yearLabels.push({ date: mid, year: mid.getFullYear() });
      }
    }

    return changes;
  }

  $: dateChanges = getDateChangesFromDomain(domainStart, domainEnd);

  // Line generator
  $: lineFn = line()
    .curve(curveLinear)
    .defined((d) => !isMissingValue(d[yKey]))
    .x((d) => x(d[xKey]))
    .y((d) => y(d[yKey]));

  $: ciAreaFn = area()
    .curve(curveLinear)
    .defined((d) => d.hasCi)
    .x((d) => x(d[xKey]))
    .y0((d) => y(d.ciLower))
    .y1((d) => y(d.ciUpper));

  function isTooCloseToEdge(xPos, w) {
    return xPos < 20 || w - xPos < 20;
  }

  const NO_DATA_GAP_THRESHOLD_DAYS = 30;

  function isMissingValue(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === "string") return val.trim() === "";
    if (typeof val === "number") return Number.isNaN(val);
    return false;
  }

  function getLastDefinedPoint(points, key) {
    if (!Array.isArray(points)) return null;
    for (let i = points.length - 1; i >= 0; i--) {
      const point = points[i];
      if (!isMissingValue(point?.[key])) return point;
    }
    return null;
  }

  // Grey bands:
  // 1) Start-of-series band when the series begins well after the axis start
  // 2) Internal bands for contiguous rows where the value is missing
  $: dataGaps = (() => {
    if (!transformedData.length) return [];

    const sorted = [...transformedData].sort((a, b) => a[xKey] - b[xKey]);
    const gaps = [];

    const firstRowDate = sorted[0]?.[xKey];
    if (effectiveStart && firstRowDate) {
      const daysDiff = (firstRowDate - effectiveStart) / (1000 * 60 * 60 * 24);
      if (daysDiff > NO_DATA_GAP_THRESHOLD_DAYS) {
        gaps.push({ start: effectiveStart, end: firstRowDate });
      }
    }

    const getGapDate = (row) => {
      const gd = row?.gapDate;
      if (gd instanceof Date && !Number.isNaN(gd.getTime())) return gd;
      return row?.[xKey];
    };

    let gapStart = null;
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const missing = isMissingValue(d[yKey]);
      const gapDate = getGapDate(d);
      if (missing) {
        if (!gapStart) gapStart = gapDate;
      } else {
        if (gapStart) {
          gaps.push({ start: gapStart, end: gapDate });
          gapStart = null;
        }
      }
    }

    if (gapStart) {
      gaps.push({
        start: gapStart,
        end: getGapDate(sorted[sorted.length - 1]),
      });
    }

    return gaps;
  })();

  // Screenreader text calculations
  $: firstDataPoint = data?.length ? data[0] : null;
  $: lastDataPoint = data?.length ? data[data.length - 1] : null;
  $: maxDataPoint = data?.length
    ? data.reduce((max, d) => (d[yKey] > max[yKey] ? d : max), data[0])
    : null;
  $: minDataPoint = data?.length
    ? data.reduce((min, d) => (d[yKey] < min[yKey] ? d : min), data[0])
    : null;

  $: formatSRValue = (val) => {
    const numeric = typeof val === "number" ? val : Number(val);
    const isPercentage = isPercentageUnits(units_chart);
    const isCurrency = isCurrencyUnits(units_chart);

    if (customDpEnabled && dpOverride !== null) {
      if (isPercentage) {
        return Number.isFinite(numeric)
          ? format(`.${dpOverride}%`)(numeric / 100)
          : "";
      } else if (isCurrency) {
        return Number.isFinite(numeric) ? formatGbp(numeric, dpOverride) : "";
      } else if (thousandsBoolean) {
        return Number.isFinite(numeric)
          ? format(`,.${dpOverride}f`)(numeric) + " thousand"
          : "";
      }
      return Number.isFinite(numeric)
        ? format(`,.${dpOverride}f`)(numeric)
        : "";
    }

    if (isPercentage) {
      return format(numeric < 20 ? ".1%" : ".0%")(numeric / 100);
    } else if (isCurrency) {
      return formatGbp(numeric, numeric < 20 ? 1 : 0);
    } else if (thousandsBoolean) {
      return format(numeric < 20 ? ",.1f" : ",.0f")(numeric) + " thousand";
    } else {
      return format(numeric < 20 ? ",.1f" : ",.0f")(numeric);
    }
  };

  $: firstDate = firstDataPoint
    ? isMonthOrQuarterPeriod(indicator_period)
      ? firstDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
        })
      : firstDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
    : "";

  $: lastDate = lastDataPoint
    ? isMonthOrQuarterPeriod(indicator_period)
      ? lastDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
        })
      : lastDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
    : "";

  $: maxDate = maxDataPoint
    ? isMonthOrQuarterPeriod(indicator_period)
      ? maxDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
        })
      : maxDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
    : "";

  $: minDate = minDataPoint
    ? isMonthOrQuarterPeriod(indicator_period)
      ? minDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
        })
      : minDataPoint.date.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
    : "";

  $: formattedValue = lastDataPoint ? formatSRValue(lastDataPoint[yKey]) : "";
  $: formattedMaxValue = maxDataPoint ? formatSRValue(maxDataPoint[yKey]) : "";
  $: formattedMinValue = minDataPoint ? formatSRValue(minDataPoint[yKey]) : "";

  $: datePreposition = isMonthOrQuarterPeriod(indicator_period) ? "in" : "on";

  $: latestIsHighest =
    lastDataPoint && maxDataPoint
      ? lastDataPoint[yKey] === maxDataPoint[yKey] &&
        lastDataPoint.date.getTime() === maxDataPoint.date.getTime()
      : false;
  $: latestIsLowest =
    lastDataPoint && minDataPoint
      ? lastDataPoint[yKey] === minDataPoint[yKey] &&
        lastDataPoint.date.getTime() === minDataPoint.date.getTime()
      : false;
</script>

<div style="padding:0px; margin-top:0px; margin-bottom:0px">
  <div
    class="chart-container"
    bind:clientWidth={width}
    style:height="{height}px"
  >
    {#if width}
      {#if transformedData.length > 0}
        <svg {width} {height} class="chart" aria-hidden="true">
          <!-- Thousands label -->
          {#if thousandsBoolean}
            <text x={margin.left + 5} y="15" class="small"> thousands </text>
          {/if}

          <!-- Y grid/ticks -->
          <g class="y-ticks">
            {#each yTicks as tick (tick)}
              <g class="y-tick" transform="translate(0 {y(tick)})">
                <line
                  class="tick-line"
                  class:tick-line-0={baselineInDomain &&
                    Math.abs(tick - baselineValue) < 1e-9}
                  x1={margin.left}
                  x2={width - margin.right}
                />
                <text
                  style="text-anchor:end;"
                  x={margin.left - 5}
                  y="6"
                  class="small"
                >
                  {isPercentageChart
                    ? formatPercent(tick / 100)
                    : isCurrencyChart
                    ? formatCurrency(tick)
                    : formatValue(tick)}
                </text>
              </g>
            {/each}
          </g>

          <!-- Date dividers + mid-year labels -->
          <g class="date-dividers">
            {#each dateChanges.years as date}
              <line
                class="year-divider"
                x1={x(date)}
                y1={height - margin.bottom}
                x2={x(date)}
                y2={height - margin.bottom + 18}
              />
            {/each}

            {#each dateChanges.yearLabels as { date, year }}
              {#if !isTooCloseToEdge(x(date), width)}
                <text
                  class="year-label"
                  x={x(date)}
                  y={height - margin.bottom + 20}
                  text-anchor="middle"
                >
                  {year}
                </text>
              {/if}
            {/each}
          </g>

          <!-- No data period indicator for all gaps -->
          {#each dataGaps as gap}
            <rect
              class="no-data-rect"
              x={x(gap.start)}
              y={margin.top}
              width={Math.max(0, x(gap.end) - x(gap.start))}
              height={height - margin.bottom - margin.top}
              fill="rgba(200, 200, 200, 0.3)"
              stroke="none"
            />
          {/each}

          <!-- Line series -->
          <g class="plot">
            {#if hasAnyCi}
              <path class="ci-band" d={ciAreaFn(ciData)} />
            {/if}

            <path
              class="line"
              d={lineFn(transformedData)}
              stroke={lineColor}
              stroke-width="{strokeWidth}px"
            />

            {#each overlaySeriesResolved as series (series.series_id)}
              <path
                class="line"
                d={lineFn(series.transformed)}
                stroke={series.lineColor}
                stroke-width="{strokeWidth}px"
              />
            {/each}

            {#if transformedData.length}
              {@const lastPoint = transformedData[transformedData.length - 1]}
              <circle
                class="line-point"
                cx={x(lastPoint[xKey])}
                cy={y(lastPoint[yKey])}
                r="4"
                fill={lineColor}
              />

              {@const secondarySeries = overlaySeriesResolved[0]}
              {@const secondaryLastPoint = getLastDefinedPoint(
                secondarySeries?.transformed,
                yKey
              )}
              {#if secondaryLastPoint}
                {@const secondaryLastX = x(secondaryLastPoint[xKey])}
                {@const secondaryLastY = y(secondaryLastPoint[yKey])}
                <rect
                  class="line-point line-point-diamond"
                  x={secondaryLastX - 4}
                  y={secondaryLastY - 4}
                  width="8"
                  height="8"
                  transform={`rotate(45 ${secondaryLastX} ${secondaryLastY})`}
                  fill={secondarySeries.lineColor}
                />
              {/if}
            {/if}
          </g>
        </svg>
      {:else}
        <div
          style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;"
        >
          No data available
        </div>
      {/if}
    {/if}

    {#if data?.length}
      <p class="screen-reader-only">
        A line chart showing the trend in {title ?? "the data"} since {firstDate}.
        The latest value is {formattedValue}
        {datePreposition}
        {lastDate}{#if latestIsHighest && latestIsLowest}. This was both the
          highest and lowest data value.{:else if latestIsHighest}. This was the
          highest data value.{:else if latestIsLowest}. This was the lowest data
          value.{:else}.{/if}
        {#if !latestIsHighest && !latestIsLowest}The highest data value was {formattedMaxValue}
          {datePreposition}
          {maxDate}. The lowest data value was {formattedMinValue}
          {datePreposition}
          {minDate}.{:else if latestIsLowest}The highest data value was {formattedMaxValue}
          {datePreposition}
          {maxDate}.{:else if latestIsHighest}The lowest data value was {formattedMinValue}
          {datePreposition}
          {minDate}.{/if} The data for the charts is available to download at the
        end of this dashboard.
      </p>
    {/if}
  </div>
</div>

<style>
  .chart-container {
    display: block;
    min-height: 200px;
  }

  .chart {
    display: block;
    overflow: visible;
    width: 100%;
    height: 100%;
  }

  .line {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .ci-band {
    fill: rgba(32, 96, 149, 0.45);
    stroke: none;
  }

  .tick-line {
    stroke: #ccc;
    stroke-width: 1;
  }

  .tick-line-0 {
    stroke: #b3b3b3;
    stroke-width: 2px;
  }

  .year-divider {
    stroke: #a0a0a0;
    stroke-width: 2px;
  }

  text {
    font-size: 14px;
    fill: #333;
  }

  .year-label {
    font-size: 14px;
    fill: #666;
  }

  svg {
    padding: 0px;
    margin: 0;
  }

  .screen-reader-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
