<script>
  import { onDestroy, onMount } from "svelte";
  import * as env from "$env/static/public";
  import {
    Embed,
    Notice,
    Section,
    Twisty,
    Accordion,
    AccordionItem,
    Divider,
    AnalyticsBanner,
    analyticsEvent,
    Button,
  } from "@onsvisual/svelte-components";
  import LineChartSimple from "$lib/LineChartSimple.svelte";
  import ChangeIndicator from "$lib/ChangeIndicator.svelte";
  import insertHeader from "$lib/insert-header.js";
  import { scaleLinear } from "d3-scale";
  import { makeDataFile } from "$lib/dataDownload.js";
  import {
    toBoolean,
    toNonNegativeIntOrNull,
    toNumberOrNaN,
  } from "$lib/coerce.js";
  import { formatChartEndValue } from "$lib/chartValueFormat.js";
  import { formatDateForCsv, formatNumberForCsv, escapeCsv } from "$lib/csv.js";
  import {
    getDatasetTitle,
    getDatasetDisplayTitle,
    getDatasetLinkText,
  } from "$lib/datasetText.js";
  import { parseNoticeLine } from "$lib/noticeLinks.js";
  import {
    getSeriesEntriesByCategory,
    getSummaryTableEntries as getSummaryTableEntriesForCategories,
  } from "$lib/seriesSelectors.js";
  import { getLinkDomainFromUrl } from "$lib/url.js";
  import {
    computeTransformedData,
    computeYDomainFromTransformedData,
  } from "$lib/yAxisDomain.js";
  export let data;

  const { metadataBySeries, updatedBySeries } = data;
  const categorySections = Array.isArray(data?.categorySections)
    ? data.categorySections
    : [];

  const { latestBySeries } = data;
  const dateCurrent = new Date(data.dates.current);
  const dateNext = new Date(data.dates.next);

  const analyticsProps = {
    product: "advanced-content",
    pageTitle: "Real-time indicators dashboard",
    contentType: "visualisations",
    contentSubType: "dashboard",
    outputSeries:
      "economicactivityandsocialchangerealtimeindicatorsukdashboard",
    releaseDate: data.dates.current.replaceAll("-", ""),
    nextReleaseDate: data.dates.next.replaceAll("-", ""),
  };

  const dateOptions2 = {
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  //get header dates from
  onMount(() =>
    insertHeader(
      dateCurrent.toLocaleDateString("en-GB", dateOptions2),
      dateNext.toLocaleDateString("en-GB", dateOptions2),
      dateCurrent.toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      data.dates.email,
      data.dates.emailText
    )
  );

  function isUpdatedThisWeek(seriesId) {
    return toBoolean(updatedBySeries?.[seriesId]);
  }

  function isNewIndicator(seriesId) {
    return toBoolean(metadataBySeries?.[seriesId]?.new_indicator);
  }
  function shouldShowUpdateFlag(seriesId) {
    return isUpdatedThisWeek(seriesId) || isNewIndicator(seriesId);
  }

  function getUpdateFlagText(seriesId) {
    return isNewIndicator(seriesId) ? "New indicator" : "Updated this week";
  }

  function getUpdateFlagSrText(seriesId) {
    return `${getUpdateFlagText(seriesId)}.`;
  }

  function toggleEvent(e, label, sectionTitle, sectionNumber) {
    analyticsEvent({
      event: "interaction",
      interactionType: "accordion",
      interactionValue: e?.detail?.open ? "open" : "close",
      interactionLabel: label,
      sectionTitle,
      sectionNumber,
    });
  }

  // Compute the global max date across all series
  function getGlobalMaxDate() {
    let maxDate = null;
    Object.values(latestBySeries).forEach((row) => {
      if (row.full_series && Array.isArray(row.full_series)) {
        row.full_series.forEach((d) => {
          const date = new Date(d.date);
          if (!Number.isNaN(date.getTime())) {
            if (!maxDate || date > maxDate) maxDate = date;
          }
        });
      }
    });
    return maxDate;
  }
  function getRollingWindowStartDate(endDate, years) {
    if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
      return null;
    }
    return new Date(
      endDate.getFullYear() - years,
      endDate.getMonth(),
      endDate.getDate()
    );
  }

  const globalMaxDate = getGlobalMaxDate();
  const chartStartDate = getRollingWindowStartDate(globalMaxDate, 10);

  function getSeriesColor(seriesId, fallbackColor = "#206095") {
    const rawColor =
      metadataBySeries?.[seriesId]?.series_colour ??
      metadataBySeries?.[seriesId]?.series_color;
    if (typeof rawColor !== "string") return fallbackColor;
    const trimmed = rawColor.trim();
    return trimmed || fallbackColor;
  }

  function renderCards(category) {
    const entries = getSeriesEntriesByCategory(
      latestBySeries,
      metadataBySeries,
      category
    );

    const grouped = new Map();

    for (const [seriesId, row] of entries) {
      const meta = metadataBySeries?.[seriesId] ?? {};
      const rawGroup = String(meta?.card_group ?? "").trim();
      const cardId = rawGroup || seriesId;

      if (!grouped.has(cardId)) {
        grouped.set(cardId, {
          cardId,
          primarySeriesId: seriesId,
          primaryRow: row,
          cardTitle: meta?.card_title || meta?.title || seriesId,
          cardDescription: meta?.card_description || meta?.description || "",
          seriesEntries: [],
        });
      }

      grouped.get(cardId).seriesEntries.push({ seriesId, row });
    }

    return Array.from(grouped.values());
  }

  function formatLatestValue(seriesId, row) {
    const meta = metadataBySeries?.[seriesId] ?? {};
    const transformedData = computeTransformedData(row?.full_series, {
      xKey: "date",
      yKey: "num_uk",
      thousandsBoolean: toBoolean(meta.thousands),
      startDate: chartStartDate,
    });

    if (!Array.isArray(transformedData) || transformedData.length === 0) {
      return "N/A";
    }

    const lastPoint = transformedData[transformedData.length - 1];
    const lastValue = toNumberOrNaN(lastPoint?.num_uk);
    if (Number.isNaN(lastValue)) return "N/A";

    const stats = computeYDomainFromTransformedData({
      transformedData,
      yKey: "num_uk",
      indexBoolean: toBoolean(meta.index),
      yMinMode: meta?.yMinMode ?? "auto",
      yPadding: meta?.yPadding ?? 0.1,
      niceCount: 5,
    });

    const yScale = scaleLinear()
      .domain([stats.paddedMin, stats.niceMax])
      .nice();
    const yTicks = yScale.ticks(5);
    const hasDecimalTicks = yTicks.some((t) => t % 1 !== 0);

    const formatted = formatChartEndValue(lastValue, {
      unitsChart: meta?.units_chart,
      customDpEnabled: toBoolean(meta?.custom_dp_chart ?? meta?.custom_dp),
      dpOverride: toNonNegativeIntOrNull(meta?.dp_chart ?? meta?.dp),
      hasDecimalTicks,
    });

    return formatted || "N/A";
  }

  function formatComparisonValueText(seriesId, row, label) {
    const comparisonDate =
      label === "year"
        ? row?.year_over_year_date
        : row?.period_over_period_date;
    const targetDate =
      comparisonDate instanceof Date
        ? comparisonDate
        : new Date(comparisonDate);
    if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
      return "";
    }

    const meta = metadataBySeries?.[seriesId] ?? {};
    const transformedData = computeTransformedData(row?.full_series, {
      xKey: "date",
      yKey: "num_uk",
      thousandsBoolean: toBoolean(meta.thousands),
      startDate: chartStartDate,
    });

    if (!Array.isArray(transformedData) || transformedData.length === 0) {
      return "";
    }

    const comparisonPoint = transformedData.find((d) => {
      const dDate = d?.date;
      return dDate instanceof Date && dDate.getTime() === targetDate.getTime();
    });

    let comparisonValue = toNumberOrNaN(comparisonPoint?.num_uk);

    // Fallback to latest minus change when the exact comparison point is unavailable.
    if (Number.isNaN(comparisonValue)) {
      const lastPoint = transformedData[transformedData.length - 1];
      const lastValue = toNumberOrNaN(lastPoint?.num_uk);
      const rawChange =
        label === "year"
          ? toNumberOrNaN(row?.year_over_year_change)
          : toNumberOrNaN(row?.period_over_period_change);
      const scaledChange = toBoolean(meta.thousands)
        ? rawChange / 1000
        : rawChange;

      if (!Number.isNaN(lastValue) && !Number.isNaN(scaledChange)) {
        comparisonValue = lastValue - scaledChange;
      }
    }

    if (Number.isNaN(comparisonValue)) return "";

    const stats = computeYDomainFromTransformedData({
      transformedData,
      yKey: "num_uk",
      indexBoolean: toBoolean(meta.index),
      yMinMode: meta?.yMinMode ?? "auto",
      yPadding: meta?.yPadding ?? 0.1,
      niceCount: 5,
    });

    const yScale = scaleLinear()
      .domain([stats.paddedMin, stats.niceMax])
      .nice();
    const yTicks = yScale.ticks(5);
    const hasDecimalTicks = yTicks.some((t) => t % 1 !== 0);

    const formatted = formatChartEndValue(comparisonValue, {
      unitsChart: meta?.units_chart,
      customDpEnabled: toBoolean(meta?.custom_dp_chart ?? meta?.custom_dp),
      dpOverride: toNonNegativeIntOrNull(meta?.dp_chart ?? meta?.dp),
      hasDecimalTicks,
    });

    return formatted || "";
  }

  function isMonthOrQuarterPeriod(period) {
    const p = period?.toLowerCase?.();
    return (
      p === "monthly" || p === "month" || p === "quarterly" || p === "quarter"
    );
  }

  function getQuarterMonthRange(quarterNumber) {
    const quarterRanges = {
      1: "January to March",
      2: "April to June",
      3: "July to September",
      4: "October to December",
    };
    return quarterRanges[quarterNumber] || "";
  }

  function formatExpandedDateLabel(rawLabel, fallbackDate, seriesId) {
    const raw = String(rawLabel ?? "").trim();

    if (/^\d{4}$/.test(raw)) {
      return raw;
    }

    const quarterMatch = raw.match(/^q([1-4])\s+(\d{4})$/i);
    if (quarterMatch) {
      return `Quarter ${quarterMatch[1]} ${quarterMatch[2]}`;
    }

    if (/^\d{4}\s*(?:to|-|–|—)\s*\d{4}$/i.test(raw)) {
      return raw;
    }

    // Preserve source labels for textual ranges such as:
    // "11 to 22 January 2023", "22 March to 2 April 2023"
    if (/\d\s*(?:to|-|–|—)\s*\d/i.test(raw) && /[A-Za-z]/.test(raw)) {
      return raw;
    }

    const d =
      fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      return "";
    }

    if (
      isMonthOrQuarterPeriod(metadataBySeries?.[seriesId]?.indicator_period)
    ) {
      return d.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
      });
    }

    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatExpandedValueDateLabel(rawLabel, fallbackDate, seriesId) {
    const raw = String(rawLabel ?? "").trim();
    const quarterMatch = raw.match(/^q([1-4])\s+(\d{4})$/i);
    if (quarterMatch) {
      const quarter = Number(quarterMatch[1]);
      const quarterRange = getQuarterMonthRange(quarter);
      return quarterRange
        ? `Quarter ${quarter} ${quarterMatch[2]} (${quarterRange})`
        : `Quarter ${quarter} ${quarterMatch[2]}`;
    }

    const indicatorPeriod =
      metadataBySeries?.[seriesId]?.indicator_period?.toLowerCase?.();
    const d =
      fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
    if (
      (indicatorPeriod === "quarterly" || indicatorPeriod === "quarter") &&
      d instanceof Date &&
      !Number.isNaN(d.getTime())
    ) {
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      const quarterRange = getQuarterMonthRange(quarter);
      return quarterRange
        ? `Quarter ${quarter} ${d.getFullYear()} (${quarterRange})`
        : `Quarter ${quarter} ${d.getFullYear()}`;
    }

    return formatExpandedDateLabel(rawLabel, fallbackDate, seriesId);
  }

  function formatLatestTimePeriod(seriesId, row) {
    const latestLabel = formatExpandedValueDateLabel(
      row?.raw_date_label,
      row?.date,
      seriesId
    );
    if (latestLabel) return latestLabel;

    const meta = metadataBySeries?.[seriesId] ?? {};
    const transformedData = computeTransformedData(row?.full_series, {
      xKey: "date",
      yKey: "num_uk",
      thousandsBoolean: toBoolean(meta.thousands),
      startDate: chartStartDate,
    });

    if (!Array.isArray(transformedData) || transformedData.length === 0) {
      return "N/A";
    }

    const lastPoint = transformedData[transformedData.length - 1];
    const lastDate = lastPoint?.date;
    if (!(lastDate instanceof Date) || Number.isNaN(lastDate.getTime())) {
      return "N/A";
    }

    if (isMonthOrQuarterPeriod(meta?.indicator_period)) {
      return lastDate.toLocaleDateString("en-GB", { month: "long" });
    }

    return lastDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  }

  function formatComparisonDateLabel(seriesId, row, label) {
    const rawLabel =
      label === "year"
        ? row?.year_over_year_label
        : row?.period_over_period_label;
    const fallbackDate =
      label === "year"
        ? row?.year_over_year_date
        : row?.period_over_period_date;

    return formatExpandedDateLabel(rawLabel, fallbackDate, seriesId);
  }

  function getTimePeriod(metadata) {
    const indicator_period = metadata?.indicator_period?.toLowerCase?.();
    if (
      indicator_period === "daily" ||
      indicator_period === "day" ||
      indicator_period === "weekly" ||
      indicator_period === "week"
    ) {
      return "week";
    } else if (indicator_period === "monthly" || indicator_period === "month") {
      return "month";
    } else if (
      indicator_period === "quarterly" ||
      indicator_period === "quarter"
    ) {
      return "quarter";
    } else {
      return "period";
    }
  }

  // Track expanded state for each card
  let expandedCards = {};

  const sectionCategories = categorySections.map((section) => section.category);

  $: visibleCardIds = sectionCategories.flatMap((category) =>
    renderCards(category).map((card) => card.primarySeriesId)
  );

  $: anyCardsExpanded = visibleCardIds.some(
    (seriesId) => expandedCards[seriesId]
  );

  function toggleAllCards() {
    const nextState = !anyCardsExpanded;
    const nextExpanded = {};

    visibleCardIds.forEach((seriesId) => {
      nextExpanded[seriesId] = nextState;
    });

    expandedCards = nextExpanded;

    analyticsEvent({
      event: "interaction",
      interactionType: "button",
      interactionValue: nextState ? "open" : "close",
      interactionLabel: nextState ? "Expand all cards" : "Close all cards",
      sectionTitle: "Dashboard cards",
      sectionNumber: "all",
    });
  }

  function toggleCard(seriesId, sectionTitle, sectionNumber) {
    expandedCards = {
      ...expandedCards,
      [seriesId]: !expandedCards[seriesId],
    };

    // Track analytics
    analyticsEvent({
      event: "interaction",
      interactionType: "expandable-card",
      interactionValue: expandedCards[seriesId] ? "open" : "close",
      interactionLabel: metadataBySeries[seriesId]?.title ?? seriesId,
      sectionTitle,
      sectionNumber,
    });
  }

  const destinationTaxonomy = {
    clickContentGroup: "economy",
    clickContentTheme: "economicoutputandproductivity",
    clickContentType: "dataset",
  };

  const getDatasetTitleById = (seriesId) =>
    getDatasetTitle(metadataBySeries, seriesId);
  const getDatasetDisplayTitleById = (seriesId) =>
    getDatasetDisplayTitle(metadataBySeries, seriesId);
  const getDatasetLinkTextById = (seriesId) =>
    getDatasetLinkText(metadataBySeries, seriesId);

  function trackDataLinkClick(seriesId, sectionTitle, sectionNumber) {
    const title = getDatasetTitleById(seriesId);
    const { clickContentGroup, clickContentTheme, clickContentType } =
      destinationTaxonomy;

    analyticsEvent({
      event: "navigation-click",
      interactionType: "link",
      interactionValue: "click",
      label: title,
      sectionTitle,
      sectionNumber,

      navigationType: "to-data-download",
      linkText: getDatasetLinkTextById(seriesId),
      clickContentGroup,
      clickContentType,
      clickContentTheme,
    });
  }

  function getDownloadLinkText() {
    return `Download data (CSV, ${fileSizeKB}KB)`;
  }

  // Persist a Blob URL so it can be used in data-ga-link-url
  let downloadObjectUrl = "";
  let downloadBlob;

  $: downloadFileName = `rti-dashboard-data-${
    dataFile?.publicationDate ?? ""
  }.csv`;

  $: {
    const nextBlob = dataFile?.blob;
    if (nextBlob !== downloadBlob) {
      if (downloadObjectUrl) URL.revokeObjectURL(downloadObjectUrl);
      downloadBlob = nextBlob;
      downloadObjectUrl = nextBlob ? URL.createObjectURL(nextBlob) : "";
    }
  }

  $: downloadLinkDomain = getLinkDomainFromUrl(downloadObjectUrl);

  onDestroy(() => {
    if (downloadObjectUrl) URL.revokeObjectURL(downloadObjectUrl);
  });

  function downloadData() {
    if (!dataFile?.blob) return;

    const link = document.createElement("a");
    const fileName = downloadFileName;

    // Prefer a Blob URL for a manageable `linkUrl` value
    const objectUrl = downloadObjectUrl || URL.createObjectURL(dataFile.blob);
    link.href = objectUrl;
    link.download = fileName;
    link.click();

    // Revoke only if we had to create a one-off URL (normally we reuse downloadObjectUrl)
    if (!downloadObjectUrl && objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    // Track analytics
    analyticsEvent({
      event: "fileDownload",
      fileExtension: "csv",
      fileName,
      linkText: getDownloadLinkText(),
      linkUrl: objectUrl,
      linkDomain: getLinkDomainFromUrl(objectUrl) || undefined,

      interactionType: "button",
      interactionValue: "click",
      label: "Download all data",
      sectionTitle: "Data download",
      sectionNumber: "footer",
    });
  }

  // Calculate data file to get size
  $: dataFile = makeDataFile(latestBySeries, metadataBySeries, data.dates);
  $: fileSizeKB = ((dataFile?.blob?.size || 0) / 1000).toFixed(0);

  $: noticeLines = data?.dates?.notice_text
    ? data.dates.notice_text.split(/\r?\n/)
    : [];

  function getSummaryTableEntries() {
    return getSummaryTableEntriesForCategories(
      latestBySeries,
      metadataBySeries,
      sectionCategories
    );
  }

  function downloadSummaryTableCsv() {
    const headers = [
      "Series",
      "Unit Label",
      "Data frequency",
      "Indicator frequency",
      "Latest Value",
      "Date Last Updated",
      "Date for Latest Change",
      "Date for YoY",
      "Latest Change (Raw)",
      "Latest Change (%)",
      "YoY Change (Raw)",
      "YoY Change (%)",
    ];

    const rows = getSummaryTableEntries().map(([seriesId, row]) => {
      const unitLabel = metadataBySeries[seriesId]?.units ?? "";
      const dataFrequency = metadataBySeries[seriesId]?.data_frequency ?? "";
      const indicatorFrequency =
        metadataBySeries[seriesId]?.indicator_period ?? "";

      // These columns are *relative percent changes* (not percentage-point deltas)
      const percentSuffix = "%";

      return [
        metadataBySeries[seriesId]?.title ?? seriesId,
        unitLabel,
        dataFrequency,
        indicatorFrequency,
        formatNumberForCsv(row.num_uk),
        formatDateForCsv(row.date),
        formatDateForCsv(row.period_over_period_date),
        formatDateForCsv(row.year_over_year_date),
        formatNumberForCsv(row.period_over_period_change),
        row.period_over_period_percent !== null &&
        row.period_over_period_percent !== undefined
          ? `${formatNumberForCsv(
              row.period_over_period_percent
            )}${percentSuffix}`
          : "",
        formatNumberForCsv(row.year_over_year_change),
        row.year_over_year_percent !== null &&
        row.year_over_year_percent !== undefined
          ? `${formatNumberForCsv(row.year_over_year_percent)}${percentSuffix}`
          : "",
      ];
    });

    const csv = [headers, ...rows]
      .map((line) => line.map(escapeCsv).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rti-dashboard-summary-table-${
      data?.dates?.current ?? ""
    }.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const isPreviewEnv = env?.PUBLIC_APP_ENV === "preview";

  function shouldShowQaTable(visibility) {
    // Back-compat: historically these flags were booleans that only rendered in preview.
    if (visibility === true) visibility = "preview";
    if (
      visibility === false ||
      visibility === null ||
      visibility === undefined
    ) {
      visibility = "off";
    }

    const v = String(visibility).trim().toLowerCase();
    if (v === "always") return true;
    if (v === "preview") return isPreviewEnv;
    return false; // "off" or any unrecognized value
  }

  // QA-only table visibility:
  // - "off" (default): never render
  // - "preview": render only when PUBLIC_APP_ENV === "preview"
  // - "always": render in any environment
  const changeQaTableVisibility = "preview";
  const yAxisQaTableVisibility = "preview";

  const showChangeQaTable = shouldShowQaTable(changeQaTableVisibility);
  const showYAxisQaTable = shouldShowQaTable(yAxisQaTableVisibility);

  function formatQaNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
    return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  }

  $: yAxisQaRows = showYAxisQaTable
    ? getSummaryTableEntries().map(([seriesId, row]) => {
        const meta = metadataBySeries?.[seriesId] ?? {};

        const indexBoolean = toBoolean(meta.index);

        const thousandsBoolean = toBoolean(meta.thousands);
        const yMinMode = meta?.yMinMode ?? "auto";
        const yPadding = meta?.yPadding ?? 0.1;

        const transformedData = computeTransformedData(row?.full_series, {
          xKey: "date",
          yKey: "num_uk",
          thousandsBoolean,
          startDate: chartStartDate,
        });

        const stats = computeYDomainFromTransformedData({
          transformedData,
          yKey: "num_uk",
          indexBoolean,
          yMinMode,
          yPadding,
          niceCount: 5,
        });

        return {
          seriesId,
          title: meta?.title ?? seriesId,
          indexBoolean,
          ...stats,
        };
      })
    : [];

  function getEndLabelDecimalPlaces(seriesId, row) {
    const meta = metadataBySeries?.[seriesId] ?? {};
    const hasCustomDp = toBoolean(meta.custom_dp);
    const customDpValue = toNumberOrNaN(meta.dp);
    if (
      hasCustomDp &&
      typeof customDpValue === "number" &&
      Number.isFinite(customDpValue) &&
      !Number.isNaN(customDpValue)
    ) {
      return Math.max(0, Math.trunc(customDpValue));
    }
    const indexBoolean = toBoolean(meta.index);
    const thousandsBoolean = toBoolean(meta.thousands);
    const unitsChart = meta.units_chart;
    const yMinMode = meta.yMinMode ?? "auto";
    const yPadding = meta.yPadding ?? 0.1;

    const series = row?.full_series;
    if (!Array.isArray(series) || series.length === 0) return null;

    const transformedData = series
      .map((d) => {
        const raw = toNumberOrNaN(d?.num_uk);
        const numeric =
          thousandsBoolean && !Number.isNaN(raw) ? raw / 1000 : raw;
        return { ...d, num_uk: numeric };
      })
      .filter((d) => !chartStartDate || d?.date >= chartStartDate);

    if (!transformedData.length) return null;

    const numericValues = transformedData
      .map((d) => toNumberOrNaN(d?.num_uk))
      .filter((v) => typeof v === "number" && !Number.isNaN(v));
    if (!numericValues.length) return null;

    const dataYMin = Math.min(...numericValues);
    const dataYMax = Math.max(...numericValues);
    const topMax = dataYMax;

    const computedYMin = (() => {
      if (indexBoolean && yMinMode === "auto") return dataYMin;

      let baseMin;
      if (yMinMode === "zero") baseMin = 0;
      else if (yMinMode === "data") baseMin = dataYMin;
      else if (yMinMode === "above-zero") baseMin = dataYMin > 0 ? dataYMin : 0;
      else if (yMinMode === "auto") baseMin = 0;
      else baseMin = 0;

      if (yMinMode === "auto" && dataYMin > baseMin) {
        const range = topMax - baseMin;
        const gap = dataYMin - baseMin;
        if (range > 0 && gap / range > 0.5) {
          const frac = 0.3;
          const denom = 1 - frac;
          if (denom > 0) {
            const newBottom = (dataYMin - frac * topMax) / denom;
            if (newBottom < dataYMin) return newBottom;
          }
        }
      }
      return baseMin;
    })();

    const paddedMax = indexBoolean
      ? topMax + 0.2 * (topMax - dataYMin)
      : topMax;
    let paddedMin;
    if (indexBoolean) {
      const finalRange = topMax - dataYMin;
      paddedMin = dataYMin - 0.2 * finalRange;
    } else {
      paddedMin = computedYMin - Math.abs(computedYMin) * yPadding;
    }
    if (!(paddedMin < paddedMax)) paddedMin = paddedMax - Number.EPSILON;

    const yScale = scaleLinear().domain([paddedMin, paddedMax]).nice();
    const yTicks = yScale.ticks(5);
    const hasDecimalTicks = yTicks.some((t) => t % 1 !== 0);

    const lastPoint = transformedData[transformedData.length - 1];
    const lastVal = toNumberOrNaN(lastPoint?.num_uk);
    if (Number.isNaN(lastVal)) return null;

    if (unitsChart === "percentage") {
      return lastVal < 20 ? 1 : hasDecimalTicks ? 1 : 0;
    }
    return lastVal < 20 ? 1 : hasDecimalTicks ? 1 : 0;
  }

  $: endLabelDpBySeries = (() => {
    const out = {};
    for (const [seriesId, row] of getSummaryTableEntries()) {
      out[seriesId] = getEndLabelDecimalPlaces(seriesId, row);
    }
    return out;
  })();
</script>

<svelte:head>
  <title>Real-time Indicators Dashboard</title>
</svelte:head>

<Embed>
  <AnalyticsBanner {analyticsProps} hideBanner />

  {#if data.dates?.notice_enabled && noticeLines.length}
    <Section width="wide">
      <Notice>
        {#each noticeLines as line}
          <p>
            {#each parseNoticeLine(line) as part}
              {#if part.type === "link"}
                <a href={part.href}>{part.text}</a>
              {:else}
                {part.value}
              {/if}
            {/each}
          </p>
        {/each}
      </Notice>
    </Section>
  {/if}

  <Section width="wide">
    <div class="intro-row">
      <p class="intro-text">
        Click on any row to view more detail for that indicator.
        <img src="img/click.svg" alt="" aria-hidden="true" />
      </p>

      <div class="cards-controls">
        <Button
          type="button"
          variant="secondary"
          small={true}
          aria-pressed={anyCardsExpanded ? "true" : "false"}
          on:click={toggleAllCards}
        >
          {anyCardsExpanded ? "Close all cards" : "Expand all cards"}
        </Button>
      </div>
    </div>

    <div class="mobile-legend" aria-hidden="true">
      <span class="updated-dot" aria-hidden="true" />
      <span class="legend-text">Updated this week</span>
    </div>
  </Section>

  <div class="first-divider">
    <Divider hr="full" />
  </div>

  {#each categorySections as section, sectionIndex}
    <Section width="wide">
      <section aria-label="{section.title} section">
        <h2>{section.title}</h2>
        {#if section.description}
          <p class="category-description">{section.description}</p>
        {/if}
        <div class="cards">
          {#each renderCards(section.category) as card}
            {@const seriesId = card.primarySeriesId}
            {@const row = card.primaryRow}
            {@const secondarySeriesId = card.seriesEntries[1]?.seriesId}
            {@const secondaryRow = card.seriesEntries[1]?.row}
            {@const primarySeriesColor = getSeriesColor(seriesId, "#206095")}
            {@const secondarySeriesColor = secondarySeriesId
              ? getSeriesColor(secondarySeriesId, "#27a0cc")
              : ""}
            <button
              class="card {expandedCards[seriesId] ? 'expanded' : 'collapsed'}"
              on:click={() =>
                toggleCard(seriesId, section.title, String(sectionIndex + 1))}
              aria-expanded={expandedCards[seriesId] ? "true" : "false"}
              aria-label="{expandedCards[seriesId]
                ? 'Collapse'
                : 'Expand'} {card.cardTitle ?? seriesId} details"
            >
              <div
                class="card-header"
                class:card-header--top-aligned={!expandedCards[seriesId] &&
                  secondarySeriesId}
              >
                <div class="title-with-arrow">
                  <svg
                    class="expand-icon {expandedCards[seriesId]
                      ? 'expanded'
                      : ''}"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      class="icon-vertical"
                      d="M12 5 L12 19"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    />
                    <path
                      class="icon-horizontal"
                      d="M5 12 L19 12"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    />
                  </svg>
                  <h3 class="card-title">
                    <span class="card-title-text"
                      >{card.cardTitle ??
                        metadataBySeries[seriesId]?.title ??
                        seriesId}</span
                    >
                  </h3>
                </div>
                <div class="card-header-right">
                  {#if !expandedCards[seriesId]}
                    {#if secondarySeriesId}
                      <div class="compact-two-series">
                        <div class="compact-two-series-grid">
                          <span class="compact-grid-empty" aria-hidden="true" />
                          <p class="compact-grid-header">Short term</p>
                          <p class="compact-grid-header">Long term</p>

                          <p
                            class="compact-series-name"
                            style={`color: ${primarySeriesColor};`}
                          >
                            {metadataBySeries[seriesId]?.title ?? seriesId}
                          </p>
                          <div class="compact-two-series-cell">
                            <ChangeIndicator
                              {seriesId}
                              {metadataBySeries}
                              showLabel={false}
                            />
                          </div>
                          <div class="compact-two-series-cell">
                            <ChangeIndicator
                              {seriesId}
                              {metadataBySeries}
                              label="year"
                              showLabel={false}
                            />
                          </div>
                          <p
                            class="compact-series-name"
                            style={`color: ${secondarySeriesColor};`}
                          >
                            {metadataBySeries[secondarySeriesId]?.title ??
                              secondarySeriesId}
                          </p>
                          <div class="compact-two-series-cell">
                            <ChangeIndicator
                              seriesId={secondarySeriesId}
                              {metadataBySeries}
                              showLabel={false}
                            />
                          </div>
                          <div class="compact-two-series-cell">
                            <ChangeIndicator
                              seriesId={secondarySeriesId}
                              {metadataBySeries}
                              label="year"
                              showLabel={false}
                            />
                          </div>
                        </div>
                        <p
                          class="compact-change-date"
                          style="margin:0; font-weight:normal; font-size:14px; color:#666; line-height:1.3;"
                        >
                          Change up to{" "}{formatExpandedDateLabel(
                            row?.raw_date_label,
                            row?.date,
                            seriesId
                          )}
                        </p>
                      </div>
                    {:else}
                      <div class="compact-change">
                        <p
                          style="margin:0; font-weight:normal; font-size:14px; color:#666; line-height:1.3; text-align:right;"
                        >
                          Change up to{" "}<br />{formatExpandedDateLabel(
                            row?.raw_date_label,
                            row?.date,
                            seriesId
                          )}
                        </p>
                        <div class="compact-indicator compact-indicator--short">
                          <ChangeIndicator {seriesId} {metadataBySeries} />
                        </div>
                      </div>
                      <div class="updated-flag-container">
                        <div class="compact-indicator compact-indicator--long">
                          <ChangeIndicator
                            {seriesId}
                            {metadataBySeries}
                            label="year"
                          />
                        </div>
                      </div>
                    {/if}
                  {:else}
                    <div class="header-spacer" />
                  {/if}
                </div>
              </div>
              <div
                class="card-expanded-content"
                class:hidden={!expandedCards[seriesId]}
              >
                <p class="subtitle">
                  {card.cardDescription ||
                    metadataBySeries[seriesId]?.description}
                </p>
                <div
                  class="layout-container"
                  class:layout-container--two-series={secondarySeriesId}
                >
                  <div class="chart">
                    <LineChartSimple
                      data={row.full_series}
                      yKey="num_uk"
                      lineColor={primarySeriesColor}
                      startDate={chartStartDate}
                      endDate={globalMaxDate}
                      title={metadataBySeries[seriesId]?.title}
                      units_chart={metadataBySeries[seriesId]?.units_chart}
                      index={metadataBySeries[seriesId]?.index}
                      thousands={metadataBySeries[seriesId]?.thousands}
                      series_id={seriesId}
                      thinSeries={metadataBySeries[seriesId]?.thin_line ===
                      "TRUE"
                        ? seriesId
                        : null}
                      indicator_period={metadataBySeries[seriesId]
                        ?.indicator_period}
                      meta={{
                        yMinMode:
                          metadataBySeries[seriesId]?.yMinMode ?? "auto",
                        yPadding: metadataBySeries[seriesId]?.yPadding ?? 0.1,
                        custom_dp_chart:
                          metadataBySeries[seriesId]?.custom_dp_chart ??
                          metadataBySeries[seriesId]?.custom_dp,
                        dp_chart:
                          metadataBySeries[seriesId]?.dp_chart ??
                          metadataBySeries[seriesId]?.dp,
                      }}
                      overlaySeries={card.seriesEntries
                        .slice(1)
                        .map(
                          (
                            { seriesId: overlaySeriesId, row: overlayRow },
                            idx
                          ) => ({
                            series_id: overlaySeriesId,
                            data: overlayRow.full_series,
                            lineColor: getSeriesColor(
                              overlaySeriesId,
                              idx % 2 === 0 ? "#27a0cc" : "#118C7B"
                            ),
                            thin:
                              metadataBySeries[overlaySeriesId]?.thin_line ===
                              "TRUE",
                          })
                        )}
                      showYearDividersAtDomainEdges={false}
                    />
                  </div>
                  <div
                    class="indicators-container"
                    class:indicators-container--two-series={secondarySeriesId}
                  >
                    <div class="indicators-header">
                      {#if secondarySeriesId}
                        <p
                          class="latest-value-series-title latest-value-series-title-primary"
                          style={`color: ${primarySeriesColor};`}
                        >
                          {metadataBySeries[seriesId]?.title ?? seriesId}
                        </p>
                      {/if}
                      <p class="latest-value-number">
                        <span style={`color: ${primarySeriesColor};`}
                          >{formatLatestValue(seriesId, row)}</span
                        >
                        {#if secondarySeriesId}
                          <span
                            class="latest-value-marker latest-value-marker-circle"
                            style={`color: ${primarySeriesColor};`}
                            aria-hidden="true"
                          />
                        {/if}
                      </p>
                      {#if secondarySeriesId && secondaryRow}
                        <p
                          class="latest-value-series-title latest-value-series-title-secondary"
                          style={`color: ${secondarySeriesColor};`}
                        >
                          {metadataBySeries[secondarySeriesId]?.title ??
                            secondarySeriesId}
                        </p>
                        <p
                          class="latest-value-number latest-value-number-secondary"
                        >
                          <span style={`color: ${secondarySeriesColor};`}
                            >{formatLatestValue(
                              secondarySeriesId,
                              secondaryRow
                            )}</span
                          >
                          <span
                            class="latest-value-marker latest-value-marker-diamond"
                            style={`color: ${secondarySeriesColor};`}
                            aria-hidden="true"
                          />
                        </p>
                      {/if}
                      <p
                        class="latest-value-period"
                        class:latest-value-period--single={!secondarySeriesId}
                      >
                        {formatLatestTimePeriod(seriesId, row)}
                      </p>
                    </div>
                    {#if secondarySeriesId && secondaryRow}
                      <div class="two-series-indicators-row">
                        <div
                          class="indicators-child two-series-indicators-child two-series-indicators-child-primary"
                        >
                          <p
                            class="two-series-indicators-group-title two-series-indicators-group-title-primary"
                            style={`color: ${primarySeriesColor};`}
                          >
                            {metadataBySeries[seriesId]?.title ?? seriesId}
                          </p>
                          {#each [{ label: undefined }, { label: "year" }] as indicator}
                            <div class="indicator-stack-item">
                              <ChangeIndicator
                                {seriesId}
                                {metadataBySeries}
                                label={indicator.label}
                                showSinceDate={true}
                                comparisonDate={indicator.label === "year"
                                  ? row.year_over_year_date
                                  : row.period_over_period_date}
                                comparisonValueText={formatComparisonValueText(
                                  seriesId,
                                  row,
                                  indicator.label
                                )}
                                comparisonDateText={formatComparisonDateLabel(
                                  seriesId,
                                  row,
                                  indicator.label
                                )}
                              />
                            </div>
                          {/each}
                        </div>
                        <div
                          class="indicators-child two-series-indicators-child two-series-indicators-child-secondary"
                        >
                          <p
                            class="two-series-indicators-group-title two-series-indicators-group-title-secondary"
                            style={`color: ${secondarySeriesColor};`}
                          >
                            {metadataBySeries[secondarySeriesId]?.title ??
                              secondarySeriesId}
                          </p>
                          {#each [{ label: undefined }, { label: "year" }] as indicator}
                            <div class="indicator-stack-item">
                              <ChangeIndicator
                                seriesId={secondarySeriesId}
                                {metadataBySeries}
                                label={indicator.label}
                                showSinceDate={true}
                                comparisonDate={indicator.label === "year"
                                  ? secondaryRow.year_over_year_date
                                  : secondaryRow.period_over_period_date}
                                comparisonValueText={formatComparisonValueText(
                                  secondarySeriesId,
                                  secondaryRow,
                                  indicator.label
                                )}
                                comparisonDateText={formatComparisonDateLabel(
                                  secondarySeriesId,
                                  secondaryRow,
                                  indicator.label
                                )}
                              />
                            </div>
                          {/each}
                        </div>
                      </div>
                    {:else}
                      <div class="indicators-row">
                        {#each [{ label: undefined }, { label: "year" }] as indicator}
                          <div class="indicators-child">
                            <ChangeIndicator
                              {seriesId}
                              {metadataBySeries}
                              label={indicator.label}
                              showSinceDate={true}
                              comparisonDate={indicator.label === "year"
                                ? row.year_over_year_date
                                : row.period_over_period_date}
                              comparisonValueText={formatComparisonValueText(
                                seriesId,
                                row,
                                indicator.label
                              )}
                              comparisonDateText={formatComparisonDateLabel(
                                seriesId,
                                row,
                                indicator.label
                              )}
                            />
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
                <p class="get-data-link">
                  {#if metadataBySeries[seriesId]?.data_source && metadataBySeries[seriesId]?.url}
                    <span class="data-source">Source:{" "}</span>
                    <a
                      href={metadataBySeries[seriesId].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-ga-event="navigation-click"
                      data-ga-navigation-type="to-data-download"
                      data-ga-link-text={getDatasetLinkTextById(seriesId)}
                      data-ga-click-content-group={destinationTaxonomy.clickContentGroup}
                      data-ga-click-content-type={destinationTaxonomy.clickContentType}
                      data-ga-click-content-theme={destinationTaxonomy.clickContentTheme}
                      on:click={() =>
                        trackDataLinkClick(
                          seriesId,
                          section.title,
                          String(sectionIndex + 1)
                        )}
                    >
                      {metadataBySeries[seriesId].data_source}
                      <span class="screen-reader-only">(opens in new tab)</span>
                      <svg
                        class="external-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 8.66667V12.6667C12 13.0203 11.8595 13.3594 11.6095 13.6095C11.3594 13.8595 11.0203 14 10.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V5.33333C2 4.97971 2.14048 4.64057 2.39052 4.39052C2.64057 4.14048 2.97971 4 3.33333 4H7.33333"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M10 2H14V6"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M6.66666 9.33333L14 2"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </a>
                  {:else if metadataBySeries[seriesId]?.data_source}
                    <span class="data-source">
                      Source: {metadataBySeries[seriesId].data_source}
                    </span>
                  {:else if metadataBySeries[seriesId]?.url}
                    <a
                      href={metadataBySeries[seriesId].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-ga-event="navigation-click"
                      data-ga-navigation-type="to-data-download"
                      data-ga-link-text={getDatasetLinkTextById(seriesId)}
                      data-ga-click-content-group={destinationTaxonomy.clickContentGroup}
                      data-ga-click-content-type={destinationTaxonomy.clickContentType}
                      data-ga-click-content-theme={destinationTaxonomy.clickContentTheme}
                      on:click={() =>
                        trackDataLinkClick(
                          seriesId,
                          section.title,
                          String(sectionIndex + 1)
                        )}
                    >
                      Go to the dataset for {getDatasetDisplayTitleById(
                        seriesId
                      )}
                      <span class="screen-reader-only">(opens in new tab)</span>
                      <svg
                        class="external-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 8.66667V12.6667C12 13.0203 11.8595 13.3594 11.6095 13.6095C11.3594 13.8595 11.0203 14 10.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V5.33333C2 4.97971 2.14048 4.64057 2.39052 4.39052C2.64057 4.14048 2.97971 4 3.33333 4H7.33333"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M10 2H14V6"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M6.66666 9.33333L14 2"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </a>
                  {/if}
                </p>
              </div>
            </button>
          {/each}
        </div>
      </section>
    </Section>
    <Divider hr="full" />
  {/each}
  <Section width="wide">
    {#if showChangeQaTable}
      <Twisty title="QA: Year-on-Year Change Table" open={false}>
        <div style="overflow-x:auto; margin-bottom: 2rem;">
          <table
            style="border-collapse: collapse; width: 100%; min-width: 1050px; font-size: 0.92em;"
          >
            <thead>
              <tr style="background: #f4f4f4;">
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: left;"
                  >Series</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Unit Label</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Data frequency</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Indicator frequency</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Latest Value</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >End label d.p.</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Date Last Updated</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Date for Latest Change</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Date for YoY</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Latest Change (Raw)</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Latest Change (%)</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >YoY Change (Raw)</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >YoY Change (%)</th
                >
              </tr>
            </thead>
            <tbody>
              {#each getSummaryTableEntries() as [seriesId, row]}
                <tr>
                  <td style="padding: 8px; border: 1px solid #ccc;"
                    >{metadataBySeries[seriesId]?.title ?? seriesId}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{metadataBySeries[seriesId]?.units || "N/A"}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{metadataBySeries[seriesId]?.data_frequency ?? "N/A"}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{metadataBySeries[seriesId]?.indicator_period ?? "N/A"}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{typeof row.num_uk === "number"
                      ? row.num_uk.toLocaleString(undefined, {
                          maximumFractionDigits: 5,
                        })
                      : row.num_uk}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if typeof endLabelDpBySeries?.[seriesId] === "number"}
                      {endLabelDpBySeries[seriesId]}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.date}
                      {new Date(row.date).toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.period_over_period_date}
                      {new Date(row.period_over_period_date).toLocaleDateString(
                        "en-GB",
                        { year: "numeric", month: "long", day: "numeric" }
                      )}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.year_over_year_date}
                      {new Date(row.year_over_year_date).toLocaleDateString(
                        "en-GB",
                        { year: "numeric", month: "long", day: "numeric" }
                      )}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.period_over_period_change !== null && row.period_over_period_change !== undefined}
                      {typeof row.period_over_period_change === "number"
                        ? row.period_over_period_change.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 5 }
                          )
                        : row.period_over_period_change}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.period_over_period_percent !== null && row.period_over_period_percent !== undefined}
                      {typeof row.period_over_period_percent === "number"
                        ? row.period_over_period_percent.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 5 }
                          )
                        : row.period_over_period_percent}
                      %
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.year_over_year_change !== null && row.year_over_year_change !== undefined}
                      {typeof row.year_over_year_change === "number"
                        ? row.year_over_year_change.toLocaleString(undefined, {
                            maximumFractionDigits: 5,
                          })
                        : row.year_over_year_change}
                    {:else}
                      N/A
                    {/if}
                  </td>
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >
                    {#if row.year_over_year_percent !== null && row.year_over_year_percent !== undefined}
                      {typeof row.year_over_year_percent === "number"
                        ? row.year_over_year_percent.toLocaleString(undefined, {
                            maximumFractionDigits: 5,
                          })
                        : row.year_over_year_percent}
                      %
                    {:else}
                      N/A
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <Button
          type="button"
          variant="secondary"
          icon="download"
          iconPosition="before"
          small={true}
          on:click={downloadSummaryTableCsv}
        >
          Download table (CSV)
        </Button>
      </Twisty>
    {/if}

    {#if showYAxisQaTable}
      <Twisty title="QA: Y-axis domain" open={false}>
        <div style="overflow-x:auto; margin-bottom: 2rem;">
          <table
            style="border-collapse: collapse; width: 100%; min-width: 950px; font-size: 0.92em;"
          >
            <thead>
              <tr style="background: #f4f4f4;">
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: left;"
                  >Series</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Index</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Max data value</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Min data value</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Max y</th
                >
                <th
                  style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                  >Min y</th
                >
              </tr>
            </thead>
            <tbody>
              {#each yAxisQaRows as r}
                <tr>
                  <td style="padding: 8px; border: 1px solid #ccc;"
                    >{r.title}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{r.indexBoolean ? "true" : "false"}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{formatQaNumber(r.dataYMax)}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{formatQaNumber(r.dataYMin)}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{formatQaNumber(r.niceMax)}</td
                  >
                  <td
                    style="padding: 8px; border: 1px solid #ccc; text-align: right;"
                    >{formatQaNumber(r.paddedMin)}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Twisty>

      <Divider hr="full" />
    {/if}

    <div class="download-section">
      <div class="download-content">
        <h2>Download dashboard data</h2>
        <p>
          Download all indicator data in this dashboard in a single CSV file.
        </p>
      </div>
      <div class="download-button-wrapper">
        <Button
          type="button"
          variant="secondary"
          icon="download"
          iconPosition="before"
          small={true}
          on:click={downloadData}
        >
          Download data (CSV, {fileSizeKB}KB)
        </Button>
      </div>
    </div>
  </Section>
</Embed>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }

  @media screen and (max-width: 950px) {
    :global(body),
    :global(#svelte),
    :global(.ons-page),
    :global(.ons-page__container),
    :global(.ons-container) {
      padding-left: 0 !important;
      padding-right: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      max-width: 100% !important;
      width: 100% !important;
    }
  }

  h2 {
    padding: 0px 0 11px 0;
    font-weight: 700;
  }

  .category-description {
    margin: 0 0 16px;
    color: #3d3d3d;
    max-width: 60ch;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  .card {
    /* Button reset */
    border: none;
    font-family: inherit;
    font-size: inherit;
    text-align: left;

    background: #f5f5f5;
    padding: 15px 20px 20px 20px;
    cursor: pointer;
    transition: padding 0.3s ease, background 0.3s ease;
    width: 100%;
    max-width: 950px;
  }

  .card.collapsed {
    padding: 15px 20px 20px 20px;
  }

  .header-spacer {
    height: 45.547px;
    background-color: red;
  }

  @media (hover: hover) {
    .card:hover {
      background: #ebebeb;
    }
  }

  .card:focus {
    outline: none;
  }

  .card:focus-visible {
    outline: 3px solid #222;
    outline-offset: 1px;
  }

  /* Typography inside cards */
  .card h3 {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.3;
    color: #222;
    margin: 0 0 0px 0;
  }

  .card p {
    font-size: 1rem;
    color: #222;
    margin: 0 0 12px 0;
  }

  .subtitle {
    line-height: 1.3;
    padding-top: 10px;
    font-size: 18px !important;
    text-wrap: balance;
  }

  .layout-container {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 40px;
  }

  .chart,
  .indicators-container {
    flex: 1 1 100%;
  }

  .indicators-container {
    display: flex;
    flex-direction: column;
  }

  .indicators-header {
    font-weight: bold;
    padding: 0;
  }

  .card .latest-value-number {
    font-size: 32pt;
    line-height: 1.1;
    color: #206095;
    font-weight: 700;
    margin: 0 0 4px 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
  }

  .card .latest-value-number-secondary {
    font-size: 32pt;
    line-height: 1.1;
    color: #27a0cc;
    margin: 0 0 4px 0;
  }

  .card .latest-value-marker {
    width: 12.8px;
    height: 12.8px;
    background: currentColor;
    flex-shrink: 0;
  }

  .card .latest-value-marker-circle {
    border-radius: 50%;
  }

  .card .latest-value-marker-diamond {
    border-radius: 0;
    transform: rotate(45deg);
  }

  .card .latest-value-period {
    font-size: 0.95rem;
    line-height: 1.2;
    color: #666;
    font-weight: 400;
    margin: 10px 0 8px 0;
  }

  .card .latest-value-period--single {
    color: #206095;
  }

  .card .latest-value-series-title {
    font-size: 0.95rem;
    line-height: 1.2;
    font-weight: 600;
    margin: 4px 0 2px 0;
  }

  .card .latest-value-series-title-primary {
    color: #206095;
  }

  .card .latest-value-series-title-secondary {
    color: #27a0cc;
  }

  .indicators-header p {
    margin: 0;
    margin-top: 4px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 0;
    margin: 0;
    position: relative;
  }

  .card-header--top-aligned {
    align-items: flex-start;
  }

  .card-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    margin-right: 180px;
  }

  .title-with-arrow {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-height: 32px;
  }

  .expand-icon {
    flex-shrink: 0;
    margin-top: 0;
    display: block;
    outline: none;
    border: none;
  }

  .expand-icon path {
    stroke: rgb(55, 55, 55);
    transition: transform 0.2s ease;
    transform-origin: center;
  }

  .expand-icon .icon-vertical {
    transform: rotate(0deg);
  }

  .expand-icon .icon-horizontal {
    transform: rotate(0deg) scaleX(1);
  }

  .expand-icon.expanded .icon-vertical {
    transform: rotate(90deg);
  }

  .expand-icon.expanded .icon-horizontal {
    transform: rotate(90deg) scaleX(0);
  }

  .card-title {
    margin: 0;
    padding: 0;
    font-size: 1.05rem;
    line-height: 1.1;
    font-weight: 700;
    flex: 1;
    color: #206095;
    text-wrap: balance;
  }

  .card-title-text {
    display: inline;
  }

  .card-expanded-content.hidden {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    z-index: -1;
  }

  .card:focus-visible .card-title-text {
    background-color: #fbc900;
    text-decoration: underline;
    text-decoration-color: #000;
    text-underline-offset: 0.25em;
    text-decoration-thickness: 3px;
  }

  .compact-change {
    padding-top: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .compact-two-series {
    --compact-series-col-width: 180px;
    --compact-grid-col-gap: 14px;
    display: grid;
    grid-template-columns: var(--compact-series-col-width) max-content max-content;
    column-gap: var(--compact-grid-col-gap);
    row-gap: 0;
    align-items: center;
    justify-content: start;
  }

  .card.collapsed .compact-two-series {
    row-gap: 6px;
  }

  .compact-two-series-grid {
    display: contents;
  }

  .compact-grid-empty {
    display: block;
  }

  .card .compact-grid-header {
    margin: 10px 0 0 0;
    font-size: 14px;
    line-height: 1.2;
    color: #222;
    font-weight: 700;
    white-space: nowrap;
  }

  .card .compact-series-name {
    margin: 0;
    font-size: 14px;
    line-height: 1.2;
    color: #222;
    font-weight: 600;
    align-self: center;
    white-space: normal;
    text-align: right;
    justify-self: end;
  }

  .compact-two-series-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
  }

  .card .compact-change-date {
    grid-column: 2 / 4;
    justify-self: start;
    margin: 0;
    font-size: 14px;
    color: #666;
    line-height: 1.3;
    transform: none;
    text-align: left;
    white-space: nowrap;
    padding-top: 8px;
  }

  .compact-change p {
    align-self: center;
    transform: translateY(10px);
  }

  .compact-change :global(.indicator-area) {
    align-self: center;
  }

  .compact-indicator {
    display: flex;
    flex-direction: column;
  }

  .compact-indicator--short {
    align-items: flex-start;
  }

  .compact-indicator--long {
    align-items: flex-start;
  }

  .compact-indicator :global(.text-indicator-sm) {
    margin-top: 0;
    margin-bottom: 4px;
    font-size: 14px;
    font-weight: 700;
    color: #666;
    line-height: 1.2;
  }

  .compact-indicator :global(.indicator-area) {
    margin-top: 0;
  }

  .updated-flag-container {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: 0px;
    display: flex;
    justify-content: flex-end;
  }

  .card.collapsed .updated-flag-container {
    position: static;
    top: auto;
    right: auto;
    transform: none;
  }

  .card.collapsed .card-header-right {
    margin-right: 0;
    justify-content: flex-end;
  }

  .updated-flag-container :global(.indicator-area) {
    margin-top: 0;
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

  .indicators-row {
    display: flex;
    gap: 16px;
  }

  .indicators-child {
    flex: 1;
    padding-top: 8px;
    overflow-wrap: break-word;
  }

  .two-series-indicators-row {
    display: grid;
    grid-template-columns:
      minmax(0, var(--two-series-row2-col-a, 1fr))
      minmax(0, var(--two-series-row2-col-b, 1fr));
    gap: 16px;
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .two-series-indicators-child {
    padding-top: 12px;
    display: flex;
    flex-wrap: wrap;
    column-gap: 16px;
    row-gap: 4px;
    align-items: flex-start;
  }

  .card .two-series-indicators-group-title {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.2;
    font-weight: 600;
    color: #3a3a3a;
  }

  .card .two-series-indicators-group-title-primary {
    color: #3a3a3a;
  }

  .card .two-series-indicators-group-title-secondary {
    color: #3a3a3a;
  }

  .two-series-indicators-child :global(.text-indicator-sm) {
    color: #666;
  }

  .two-series-indicators-child .indicator-stack-item {
    flex: 1 1 0;
    min-width: 0;
  }

  .card .get-data-link {
    padding-top: 15px;
    margin-top: 8px;
    font-size: 17px;
    line-height: 1.3;
    overflow-wrap: break-word;
    word-wrap: break-word;
    text-wrap: balance;
  }

  .card .get-data-link a {
    color: #206095;
    text-decoration: underline;
    display: inline;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }

  .card .get-data-link a:hover {
    color: #0f1e2e;
  }

  .card .get-data-link .external-icon {
    display: inline;
    vertical-align: -2px;
    margin-left: 2px;
  }

  .card .get-data-link .data-source {
    font-size: 0.9rem;
    line-height: 1.3;
    color: #666;
  }

  .layout-container,
  .indicators-header,
  .indicators-row,
  .indicators-child,
  .chart {
    border: 0px solid #666;
  }

  svg:not(.external-icon):not(.expand-icon) {
    border: 1px solid #666;
  }

  /* Breakpoint: 720px (mobile/desktop split) */
  @media screen and (min-width: 721px) {
    .chart {
      flex: 1 1 30%;
      min-width: 0;
      order: 2;
    }

    .indicators-container {
      flex: 2 1 0;
      min-width: 0;
      order: 1;
    }

    .layout-container--two-series {
      --two-series-row1-col-a: 1fr;
      --two-series-row1-col-b: 1fr;
      --two-series-row2-col-a: 1fr;
      --two-series-row2-col-b: 1fr;
      display: grid;
      grid-template-columns:
        minmax(0, var(--two-series-row1-col-a))
        minmax(0, var(--two-series-row1-col-b));
      column-gap: 16px;
      row-gap: 16px;
      align-items: start;
    }

    .layout-container--two-series .chart {
      grid-column: 2;
      grid-row: 1;
      min-width: 0;
      order: initial;
    }

    .layout-container--two-series .indicators-container--two-series {
      display: contents;
    }

    .layout-container--two-series .indicators-header {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
    }

    .layout-container--two-series .two-series-indicators-child-primary,
    .layout-container--two-series .two-series-indicators-child-secondary {
      min-width: 0;
    }
  }

  /* Desktop: lock card width */
  @media screen and (min-width: 951px) {
    .card {
      width: 950px !important;
    }
  }

  /* Mobile: full width */
  @media screen and (max-width: 950px) {
    .card {
      width: 100% !important;
      padding: 16px;
    }

    .card.collapsed {
      padding: 16px 16px 16px 16px;
    }

    .subtitle {
      font-size: 16px !important;
    }
  }

  .mobile-legend {
    display: none;
    align-items: center;
    gap: 2px;
    padding: 4px 0;
    font-size: 0.9rem;
    color: #666;
  }

  .intro-row {
    max-width: 950px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .intro-text {
    margin: 0;
    color: #666;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 420px;
  }

  .intro-text img {
    transform: scale(0.8);
  }

  .cards-controls {
    display: flex;
    justify-content: flex-end;
  }

  .legend-text {
    font-weight: 400;
    font-size: 16px;
  }

  /* Mobile breakpoints: below 720px - shared styles */
  @media screen and (max-width: 720px) {
    h2 {
      padding: 0 0 4px 0;
    }

    .cards {
      gap: 20px;
    }

    .card h3 {
      font-size: 1.1rem;
      overflow-wrap: break-word;
    }

    .card-header {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }

    .card-header-right {
      margin-right: 0;
      flex-direction: row;
      align-items: flex-start;
      width: 100%;
      gap: 12px;
      flex-wrap: wrap;
    }

    .card.collapsed .card-header-right {
      justify-content: flex-start;
      margin-right: 0;
    }

    .card.expanded .card-header-right {
      display: none;
    }

    .title-with-arrow {
      flex-direction: row-reverse;
      gap: 8px;
    }

    .card-title {
      font-size: 1.1rem;
    }

    .compact-change {
      display: contents;
    }

    .compact-two-series {
      --compact-series-col-width: 150px;
      --compact-grid-col-gap: 10px;
    }

    .compact-series-name {
      font-size: 13px;
    }

    .compact-change p {
      order: 3;
      flex-basis: 100%;
      text-align: left !important;
      transform: none;
      margin-top: 4px;
      white-space: nowrap;
    }

    .compact-change p br {
      display: none;
    }

    .compact-change :global(.indicator-area),
    .updated-flag-container :global(.indicator-area) {
      align-self: flex-start;
      text-align: left;
    }

    .compact-change-date {
      text-align: left !important;
      transform: none;
    }

    .compact-indicator--short {
      order: 1;
      align-items: flex-start;
    }

    .compact-indicator--long {
      order: 2;
      align-items: flex-start;
    }

    .updated-flag-container {
      display: flex;
      position: static;
      top: auto;
      right: auto;
      transform: none;
      justify-content: flex-start;
      order: 2;
    }

    .subtitle {
      font-size: 16px !important;
      padding-top: 4px;
    }

    .layout-container {
      gap: 24px;
      margin-top: 20px;
    }

    .layout-container--two-series {
      display: flex;
    }

    .layout-container--two-series .two-series-indicators-row {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .layout-container--two-series .two-series-indicators-child {
      padding-top: 6px;
      gap: 12px;
    }

    .indicators-header {
      margin-top: 2px;
    }

    .indicators-header p {
      margin-top: 4px;
    }

    .indicators-row {
      gap: 12px;
    }
  }

  /* Medium mobile: 491-720px */
  @media screen and (min-width: 491px) and (max-width: 720px) {
    .title-with-arrow {
      justify-content: space-between;
    }

    .card-header-right {
      justify-content: flex-start;
    }
  }

  /* Small mobile: below 490px */
  @media screen and (max-width: 490px) {
    .mobile-legend {
      display: flex;
      padding: 12px 4px;
    }

    .intro-row {
      gap: 8px;
    }

    .cards-controls {
      justify-content: flex-start;
    }

    .title-with-arrow {
      justify-content: flex-end;
    }

    .card-header-right {
      justify-content: flex-start;
      gap: 8px;
    }
  }

  .first-divider {
    margin-top: -25px;
  }

  /* Download section styles */
  .download-section {
    padding: 0 0 32px 0;
    max-width: 950px;
    margin: 0 auto;
  }

  .download-content h2 {
    margin-bottom: 0px;
    margin-top: 0;
    padding-bottom: 6px;
  }

  .download-content p {
    color: #666;
    margin-bottom: 0;
    margin-top: 0;
  }

  @media screen and (max-width: 490px) {
    .download-section {
      text-align: left;
    }

    .download-content p {
      margin-bottom: 16px;
    }
  }

  @media screen and (min-width: 491px) {
    .download-section {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: center;
    }

    .download-button-wrapper {
      display: flex;
      align-items: center;
    }
  }
</style>
