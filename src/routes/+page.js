import { base } from "$app/paths";
import { csvParse, autoType } from "d3-dsv";

const dataUrl = `${base}/data/data.csv`;
const datesUrl = `${base}/data/header-details.json`;
const metadataUrl = `${base}/data/metadata.csv`;
const updatedUrl = `${base}/data/updated.csv`;
const categoryDetailsUrl = `${base}/data/category-details.json`;

function isShownInMetadata(meta) {
  return (
    String(meta?.show ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

function toHumanReadableCategoryName(category) {
  return String(category ?? "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCategorySections(metadataArray, categoryDetailsArray) {
  const categoryConfigByKey = new Map();

  for (const item of categoryDetailsArray ?? []) {
    const key = String(item?.category ?? "").trim();
    if (!key) continue;

    const order = Number(item?.order);
    categoryConfigByKey.set(key, {
      title: String(item?.title ?? "").trim(),
      description: String(item?.description ?? "").trim(),
      order: Number.isFinite(order) ? order : Number.POSITIVE_INFINITY,
    });
  }

  const categoriesInMetadata = [];
  const seen = new Set();

  for (const meta of metadataArray ?? []) {
    if (!isShownInMetadata(meta)) continue;
    const key = String(meta?.category ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    categoriesInMetadata.push(key);
  }

  return categoriesInMetadata
    .map((category, metadataIndex) => {
      const config = categoryConfigByKey.get(category);
      return {
        category,
        metadataIndex,
        order: config?.order ?? Number.POSITIVE_INFINITY,
        title: config?.title || toHumanReadableCategoryName(category),
        description: config?.description || "",
      };
    })
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.metadataIndex - b.metadataIndex;
    })
    .map(({ category, title, description }) => ({
      category,
      title,
      description,
    }));
}

function getDateYearsBack(date, yearsBack) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(
    date.getFullYear() - yearsBack,
    date.getMonth(),
    date.getDate()
  );
}

function getCadenceApproxDays(cadence) {
  const c = cadence?.toLowerCase?.();
  if (c === "daily" || c === "day") return 1;
  if (c === "weekly" || c === "week") return 7;
  if (c === "monthly" || c === "month") return 31;
  if (c === "quarterly" || c === "quarter") return 92;
  if (
    c === "annual" ||
    c === "annually" ||
    c === "yearly" ||
    c === "year"
  ) {
    return 366;
  }
  return 31;
}

function getClosestEntryToDate(entries, targetDate, maxDiffDays = Infinity) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
    return null;
  }

  let bestEntry = null;
  let bestDiffDays = Infinity;

  for (const entry of entries) {
    const d = entry?.date;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;

    const diffDays = Math.abs(d.getTime() - targetDate.getTime()) /
      (24 * 60 * 60 * 1000);

    if (diffDays < bestDiffDays) {
      bestDiffDays = diffDays;
      bestEntry = entry;
    }
  }

  if (bestDiffDays <= maxDiffDays) return bestEntry;
  return null;
}

// Infer underlying data cadence from the time series itself.
// This helps when indicator_period is quarterly but the series is actually monthly (etc.).
function inferCadenceFromEntries(entries) {
  if (!entries || entries.length < 3) return null;

  const diffsDays = [];
  const start = Math.max(1, entries.length - 10);
  for (let i = start; i < entries.length; i++) {
    const prev = entries[i - 1]?.date;
    const curr = entries[i]?.date;
    if (!(prev instanceof Date) || !(curr instanceof Date)) continue;
    const diff = (curr - prev) / (24 * 60 * 60 * 1000);
    if (Number.isFinite(diff) && diff > 0) diffsDays.push(diff);
  }
  if (!diffsDays.length) return null;

  diffsDays.sort((a, b) => a - b);
  const mid = Math.floor(diffsDays.length / 2);
  const median =
    diffsDays.length % 2 === 0
      ? (diffsDays[mid - 1] + diffsDays[mid]) / 2
      : diffsDays[mid];

  if (median <= 2) return "daily";
  if (median <= 10) return "weekly";
  if (median <= 45) return "monthly";
  if (median <= 120) return "quarterly";
  if (median <= 420) return "annual";
  return "monthly";
}

function getMedianGapDays(entries) {
  if (!Array.isArray(entries) || entries.length < 3) return null;

  const gaps = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]?.date;
    const curr = entries[i]?.date;
    if (!(prev instanceof Date) || Number.isNaN(prev.getTime())) continue;
    if (!(curr instanceof Date) || Number.isNaN(curr.getTime())) continue;

    const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
    if (Number.isFinite(diffDays) && diffDays > 0) {
      gaps.push(diffDays);
    }
  }

  if (!gaps.length) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0
    ? (gaps[mid - 1] + gaps[mid]) / 2
    : gaps[mid];
}

function isMonthlyCadence(cadence) {
  const c = cadence?.toLowerCase?.();
  return c === "monthly" || c === "month";
}

function getMidpointDate(startDate, endDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return new Date(NaN);
  }
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    return new Date(NaN);
  }
  if (endDate < startDate) return new Date(NaN);

  const midpointMs =
    startDate.getTime() + (endDate.getTime() - startDate.getTime()) / 2;
  return new Date(midpointMs);
}

export async function load({ fetch }) {
  let dates = await (await fetch(datesUrl)).json();

  let categoryDetailsArray = [];
  try {
    const categoryDetailsRes = await fetch(categoryDetailsUrl);
    if (categoryDetailsRes.ok) {
      const parsed = await categoryDetailsRes.json();
      if (Array.isArray(parsed)) {
        categoryDetailsArray = parsed;
      }
    }
  } catch {
    categoryDetailsArray = [];
  }

  const metadataStr = await (await fetch(metadataUrl)).text();
  const metadataArray = csvParse(metadataStr, autoType);
  const categorySections = getCategorySections(
    metadataArray,
    categoryDetailsArray
  );

  // Convert to a lookup object
  const metadataBySeries = {};
  for (const meta of metadataArray) {
    const rawKey = meta?.series_id;
    if (rawKey === null || rawKey === undefined) continue;
    const key = String(rawKey).trim();
    if (!key) continue;
    metadataBySeries[key] = meta;
  }

  // Load updated_this_week separately
  const updatedStr = await (await fetch(updatedUrl)).text();
  const updatedArray = csvParse(updatedStr, autoType);

  // Handle "auto" dates by finding the most recent update date from updated.csv
  if (dates.current === "auto" || dates.next === "auto") {
    // Parse dates from updated.csv (format: YYYY-MM-DD)
    const updateDates = updatedArray
      .map((row) => {
        // Column name in updated.csv is `date_updated` (older files used `date_of_update`)
        const rawDate = row.date_updated ?? row.date_of_update;
        if (!rawDate) return null;
        const dateStr = String(rawDate);
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? null : parsed;
      })
      .filter((d) => d !== null);

    // Find the most recent date
    const mostRecentDate =
      updateDates.length > 0 ? new Date(Math.max(...updateDates)) : new Date();

    // Calculate next update date (7 days later)
    const nextUpdateDate = new Date(mostRecentDate);
    nextUpdateDate.setDate(nextUpdateDate.getDate() + 7);

    // Format dates as YYYY-MM-DD
    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    if (dates.current === "auto") {
      dates.current = formatDate(mostRecentDate);
    }
    if (dates.next === "auto") {
      dates.next = formatDate(nextUpdateDate);
    }
  }

  const updatedBySeries = {};
  for (const item of updatedArray) {
    const rawKey = item?.series_id;
    if (rawKey === null || rawKey === undefined) continue;
    const key = String(rawKey).trim();
    if (!key) continue;
    updatedBySeries[key] = item.updated_this_week;
  }

  const str = await (await fetch(dataUrl)).text();
  const array = csvParse(str, autoType);

  const parseDate = (value) => {
    if (value === null || value === undefined) return new Date(NaN);

    const str = String(value).trim();
    if (!str) return new Date(NaN);

    // Quarterly format: Q1 2016, q3 2020
    const quarterMatch = str.match(/^q([1-4])\s+(\d{4})$/i);
    if (quarterMatch) {
      const quarter = Number(quarterMatch[1]);
      const year = Number(quarterMatch[2]);
      const month = (quarter - 1) * 3;
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 3, 0);
      return getMidpointDate(start, end);
    }

    // Annual format: 2016
    if (/^\d{4}$/.test(str)) {
      const year = Number(str);
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      return getMidpointDate(start, end);
    }

    // Year range format: 2011 to 2013, 2011-2013
    const yearRangeMatch = str.match(/^(\d{4})\s*(?:to|-|–|—)\s*(\d{4})$/i);
    if (yearRangeMatch) {
      const startYear = Number(yearRangeMatch[1]);
      const endYear = Number(yearRangeMatch[2]);
      if (endYear < startYear) return new Date(NaN);
      const start = new Date(startYear, 0, 1);
      const end = new Date(endYear, 11, 31);
      return getMidpointDate(start, end);
    }

    const monthIndexByName = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    const buildCheckedDate = (year, monthIndex, day) => {
      if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
        return null;
      }
      const d = new Date(year, monthIndex, day);
      if (
        d.getFullYear() !== year ||
        d.getMonth() !== monthIndex ||
        d.getDate() !== day
      ) {
        return null;
      }
      return d;
    };

    const parseDayMonthYear = (input) => {
      const match = String(input)
        .trim()
        .match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      if (!match) return null;
      const day = Number(match[1]);
      const monthIndex = monthIndexByName[match[2].toLowerCase()];
      const year = Number(match[3]);
      if (monthIndex === undefined) return null;
      return { day, monthIndex, year };
    };

    const parseDayMonth = (input) => {
      const match = String(input)
        .trim()
        .match(/^(\d{1,2})\s+([A-Za-z]+)$/);
      if (!match) return null;
      const day = Number(match[1]);
      const monthIndex = monthIndexByName[match[2].toLowerCase()];
      if (monthIndex === undefined) return null;
      return { day, monthIndex };
    };

    const parseDayOnly = (input) => {
      const match = String(input)
        .trim()
        .match(/^(\d{1,2})$/);
      if (!match) return null;
      return { day: Number(match[1]) };
    };

    // Text range formats:
    // - D Month YYYY to D Month YYYY
    // - D Month to D Month YYYY
    // - D to D Month YYYY
    const textRangeMatch = str.match(/^(.+?)\s*(?:to|-|–|—)\s*(.+)$/i);
    if (textRangeMatch) {
      const leftRaw = textRangeMatch[1].trim();
      const rightRaw = textRangeMatch[2].trim();

      const rightDmy = parseDayMonthYear(rightRaw);
      if (rightDmy) {
        const rightDate = buildCheckedDate(
          rightDmy.year,
          rightDmy.monthIndex,
          rightDmy.day
        );
        if (!rightDate) return new Date(NaN);

        // Validate the left side where possible while allowing omitted month/year.
        const leftDmy = parseDayMonthYear(leftRaw);
        if (leftDmy) {
          const leftDate = buildCheckedDate(
            leftDmy.year,
            leftDmy.monthIndex,
            leftDmy.day
          );
          if (!leftDate || leftDate > rightDate) return new Date(NaN);
          return getMidpointDate(leftDate, rightDate);
        }

        const leftDm = parseDayMonth(leftRaw);
        if (leftDm) {
          const inferredLeftDate = buildCheckedDate(
            rightDmy.year,
            leftDm.monthIndex,
            leftDm.day
          );
          if (!inferredLeftDate || inferredLeftDate > rightDate) return new Date(NaN);
          return getMidpointDate(inferredLeftDate, rightDate);
        }

        const leftD = parseDayOnly(leftRaw);
        if (leftD) {
          const inferredLeftDate = buildCheckedDate(
            rightDmy.year,
            rightDmy.monthIndex,
            leftD.day
          );
          if (!inferredLeftDate || inferredLeftDate > rightDate) return new Date(NaN);
          return getMidpointDate(inferredLeftDate, rightDate);
        }
      }
    }

    // Single text date format: D Month YYYY
    const textDate = parseDayMonthYear(str);
    if (textDate) {
      const d = buildCheckedDate(textDate.year, textDate.monthIndex, textDate.day);
      if (d) return d;
      return new Date(NaN);
    }

    // Legacy format: dd/mm/yyyy
    const slashDateMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashDateMatch) {
      const day = Number(slashDateMatch[1]);
      const month = Number(slashDateMatch[2]);
      const year = Number(slashDateMatch[3]);
      return new Date(year, month - 1, day);
    }

    return new Date(NaN);
  };

  const grouped = {};

  for (const row of array) {
    const date = parseDate(row.date);
    const key = row.series_id;
    const rawDateLabel = String(row?.date ?? "").trim();

    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...row, raw_date_label: rawDateLabel, date, gapDate: date });
  }

  const result = {};

  for (const [series_id, entries] of Object.entries(grouped)) {
    entries.sort((a, b) => a.date - b.date); // oldest to newest

    const latest = entries[entries.length - 1];

    const meta = metadataBySeries[series_id] ?? {};
    const dataFrequency = meta?.data_frequency;
    // If the underlying data is monthly, shift points from the 1st to the 15th
    // so they plot mid-month on the chart.
    const inferredCadence = inferCadenceFromEntries(entries);
    const cadenceForPlot = dataFrequency ?? inferredCadence;
    if (isMonthlyCadence(cadenceForPlot)) {
      for (const entry of entries) {
        const d = entry?.date;
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;
        if (d.getDate() !== 1) continue;

        // Keep the original (1st-of-month) date for grey-band calculations,
        // but plot the point at mid-month.
        entry.gapDate = entry.gapDate instanceof Date ? entry.gapDate : d;
        entry.date = new Date(d.getFullYear(), d.getMonth(), 15);
      }
    }

    // Short term = 1 calendar year back; long term = 5 calendar years back.
    // Use the larger of metadata cadence and observed spacing to support
    // irregular custom period series where metadata cadence can be too strict.
    const cadenceForLookback = dataFrequency ?? inferredCadence;
    const cadenceToleranceDays = getCadenceApproxDays(cadenceForLookback) * 2;
    const inferredToleranceDays = getCadenceApproxDays(inferredCadence) * 2;
    const observedMedianGapDays = getMedianGapDays(entries);
    const observedToleranceDays = Number.isFinite(observedMedianGapDays)
      ? observedMedianGapDays * 1.5
      : 0;
    const maxDiffDays = Math.max(
      cadenceToleranceDays,
      inferredToleranceDays,
      observedToleranceDays
    );

    const prevPeriod = getClosestEntryToDate(
      entries,
      getDateYearsBack(latest.date, 1),
      maxDiffDays
    );
    const prevYear = getClosestEntryToDate(
      entries,
      getDateYearsBack(latest.date, 5),
      maxDiffDays
    );

    const pop = prevPeriod ? latest.num_uk - prevPeriod.num_uk : null;
    const yoy = prevYear ? latest.num_uk - prevYear.num_uk : null;

    const pop_percent = prevPeriod
      ? 100 * ((latest.num_uk - prevPeriod.num_uk) / prevPeriod.num_uk)
      : null;

    const yoy_percent = prevYear
      ? 100 * ((latest.num_uk - prevYear.num_uk) / prevYear.num_uk)
      : null;

    result[series_id] = {
      ...latest,
      period_over_period_change: pop,
      period_over_period_percent: pop_percent,
      period_over_period_date: prevPeriod ? prevPeriod.date : null,
      period_over_period_label: prevPeriod ? prevPeriod.raw_date_label : null,
      year_over_year_change: yoy,
      year_over_year_percent: yoy_percent,
      year_over_year_date: prevYear ? prevYear.date : null,
      year_over_year_label: prevYear ? prevYear.raw_date_label : null,
      full_series: entries,
    };
  }

  return {
    array,
    latestBySeries: result,
    metadataBySeries,
    updatedBySeries,
    categorySections,
    dates,
  };
}
