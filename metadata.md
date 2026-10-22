Metadata reference table

| Column              | Description                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| series_id           | Unique identifier used to join metadata to data                                                                       |
| show                | TRUE shows the series on the dashboard, FALSE hides                                                                   |
| new_indicator       | TRUE shows the series on the dashboard, FALSE hides                                                                   |
| category            | Section the series will appear under (energy, business, consumer, transport)                                          |
| title               | Card title text                                                                                                       |
| description         | Card subtitle text                                                                                                    |
| data_frequency      | Frequency of the data in the series (used to calculate the change YoY and MoM/WoW)                                    |
| indicator_period    | Whether indicator is weekly (for weekly or daily frequency data) or monthly (for the MoM/WoW indicator text)          |
| seasonal_adjusted   | TRUE = data is seasonally adjusted (not used in dashboard; appears in subtitle instead)                               |
| units               | Whether indicator shows percentage change or percentage point change                                                  |
| units_chart         | Whether the chart shows percentage, plain number values, or GBP currency values (for example `£` / `gbp`)           |
| index               | Whether the chart shows an index (zero-style line at 100)                                                             |
| custom_dp_chart     | Whether custom decimal places are needed on the chart data label (otherwise shows 0dp or 1dp for values under 20)     |
| dp_chart            | If using custom decimal places for the chart data label, sets the number                                              |
| custom_dp_indicator | Whether custom decimal places are needed on the indicator data label (otherwise shows 0dp or 1dp for values under 20) |
| dp_indicator        | If using custom decimal places for the indicator data label, sets the number                                          |
| thousands           | Currently unused\*                                                                                                    |
| thin_line           | Currently unused\*                                                                                                    |
| yMinMode            | Currently unused\*                                                                                                    |
| data_source         | Source to show on the card (not needed if source shown elsewhere)                                                     |
| url                 | URL for data set                                                                                                      |
| _Note_              | _Unused fields kept for future data vis logic_                                                                        |
