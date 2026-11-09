# Metadata Reference

This table describes the current columns in [static/data/metadata.csv](static/data/metadata.csv), in CSV order. Identical values across rows do not mean a field is unused.

| Column | Status | Current Behaviour |
| --- | --- | --- |
| series_id | Active | Unique identifier joining metadata to observations in data.csv |
| show | Active | TRUE includes the series on the dashboard; FALSE hides it. |
| new_indicator | Active | TRUE displays the "New indicator" flag. Does not control visibility. |
| headline | Active | TRUE marks the series as a headline indicator (default collection). FALSE marks it as additional/supporting. |
| category | Active | Section containing the series, currently headline or health. Section titles, descriptions, images, and ordering are configured in category-details.json. |
| title | Active | Series title; also the fallback card title when card_title is blank. |
| description | Active | Series description; also the fallback card description when card_description is blank. |
| assessment_st | Active | Manually supplied short-term assessment: Improved, Worsened, No change, or Not assessed. No change is displayed as "Stable". |
| assessment_lt | Active | Manually supplied long-term assessment, using the same values as assessment_st. |
| units | Active | Unit text included in data tables and downloads. Does not determine the assessment badges or chart number formatting. |
| units_chart | Active | Number format for chart and card values: percentage, number, or GBP currency, for example gbp or £. |
| unit_suffix | Active | Text appended to latest and comparison values, for example " years". Include a leading space when needed. |
| index | Active | Set TRUE when data is indexed at 100. Affects chart axis limits. |
| custom_dp_chart | Active but currently unused | TRUE enables the decimal-place override in dp_chart for chart and card value labels. Otherwise precision is automatic. |
| dp_chart | Active When Enabled | Sets number of decimal places when custom_dp_chart is TRUE.  |
| thousands | Active but currently unused | TRUE divides displayed chart and card values by 1,000 and adds a thousands label to the chart. |
| yMinMode | Active but currently unused | Chart lower-axis mode: auto (default), zero (baseline), data (data minimum), or above-zero (data minimum when positive, otherwise baseline). For index charts the baseline is 100. |
| data_source | Active | Source text shown beneath the chart |
| url | Active | Dataset URL used for the card's source link. |
| period_st | Planned | Intended to override the default short-term comparison lookback if needed in future (currently fixed at 1 year). Not yet implemented. Does not currently control assessments or comparison lookbacks. |
| period_lt | Planned | Intended to override the default long-term comparison lookback if needed in future (currently fixed at 5 years). Not yet implemented. Does not currently control assessments or comparison lookbacks. |
| card_group | Active, Optional | Shared identifier combining series into one card within a category. Blank leaves the series in its own card. Currently groups male and female healthy life expectancy. |
| card_title | Active, Optional | Card heading for grouped series. For a group, the first encountered series supplies the heading. |
| card_description | Active, Optional | Card description  for grouped series |
| series_colour | Active, Optional | CSS colour for a series' chart line, value labels, and markers. |

## Assessments And Comparisons

Assessment badges come directly from assessment_st and assessment_lt, not from numeric changes. Blank or unrecognised assessments display "Not available".

Expanded-card comparison values and dates still come from the time series: short term looks back approximately one calendar year and long term five calendar years. Matching tolerance uses both metadata cadence and observed spacing. Neither period_st nor period_lt changes these lookbacks.

data_frequency and indicator_period are currently monthly for every row, but neither requires the source data to be monthly. Dates are parsed independently. Those settings can still affect point positioning, labels, and missing-data shading, so identical values are not necessarily appropriate for every series.

## Export Precision

custom_dp_indicator and dp_indicator have been removed. The R transformation now uses enabled chart precision, otherwise source_max_dp, and retains one additional decimal place after selecting that precision. Display formatting remains separate from export rounding.
