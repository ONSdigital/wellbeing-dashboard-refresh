# ---- Setup ----
suppressPackageStartupMessages({
  library(readxl)
  library(tidyverse)
  library(janitor)
  library(glue)
})

# ======================
# ==== Configuration ====
# ======================

# Path to the working directory file (update as needed)
# wd_path  <- "Z:/visualisations/dvc-Dashboards/rti-dashboard/rti-dashboard-r-transformation"
# setwd(wd_path)

 # Path to the Excel file (update as needed)
excel_path  <- "C:/Users/broadp/Office for National Statistics/Real-time Indicators - Wkly_DB_Mar2026_onwards/pipeline2.xlsx"

# We may use sheet name in future; otherwise use sheet_index
sheet_name  <- NULL        # e.g., "Sheet1"
sheet_index <- 1           # used when sheet_name is NULL

# Row indices in the *raw worksheet* (before we promote any header)
header_row  <- 8L          # row whose contents become the column names for the time-series block
flags_row   <- 6L          # row holding Yes/No flags, one per series (excluding the first column)
series_row  <- 8L          # row holding series IDs aligned with flags (usually same as header_row)

# Heuristic header autodetection (searches rows 1:20 for a row whose cells contain "date")
autodetect_header <- TRUE

# Excel date origin (Windows/Office default)
excel_origin <- as.Date("1899-12-30")

# Output files (written in current working directory)
updated_csv_path <- "updated.csv"
data_csv_path    <- "data.csv"

# Metadata workbook (sits alongside pipeline2.xlsx)
metadata_filename   <- "metadata.xlsx"
metadata_path       <- file.path(dirname(excel_path), metadata_filename)
metadata_sheet_name <- NULL
metadata_sheet_index <- 1
metadata_csv_path   <- "metadata.csv"

# Maximum decimal places present in source data (used to snap float noise first)
source_max_dp <- 3L

# Fallback decimal places when a series has no custom dp in metadata
default_dp <- source_max_dp

# Read without column names to avoid "New names: ...2 ...3 ..." noise
col_names_at_read <- FALSE

# ============================
# ==== Helper functions  =====
# ============================

# Single-value coercion for "date last updated" cell:
coerce_excel_date_scalar <- function(x, origin = excel_origin) {
  if (inherits(x, "Date")) {
    return(x)
  } else if (is.numeric(x)) {
    return(as.Date(x, origin = origin))
  } else if (is.character(x)) {
    # numeric-like as character (e.g., "46055")
    if (grepl("^\\s*[-+]?[0-9]+(\\.[0-9]+)?\\s*$", x)) {
      return(as.Date(as.numeric(x), origin = origin))
    } else {
      # try common text date formats
      parsed <- suppressWarnings(as.Date(x, tryFormats = c(
        "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y"
      )))
      return(parsed)
    }
  } else {
    return(as.Date(NA))
  }
}

# Vectorized coercion for a time-series date column (tries Excel serial first, then text formats)
coerce_date_vector <- function(vec, origin = excel_origin) {
  if (inherits(vec, "Date")) {
    return(vec)
  } else if (is.numeric(vec)) {
    return(as.Date(vec, origin = origin))
  } else {
    # Try numeric-like first (Excel serials stored as text)
    maybe_num <- suppressWarnings(as.numeric(vec))
    if (sum(!is.na(maybe_num)) >= sum(!is.na(vec)) / 2) {
      return(as.Date(maybe_num, origin = origin))
    } else {
      return(suppressWarnings(as.Date(
        vec,
        tryFormats = c("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y")
      )))
    }
  }
}

# Normalize "updated this week" flags
parse_flag <- function(x) {
  x <- str_trim(str_to_lower(as.character(x)))
  case_when(
    x %in% c("yes", "y", "true", "1", "updated", "u", "t") ~ TRUE,
    x %in% c("no", "n", "false", "0", "not updated")       ~ FALSE,
    TRUE                                                   ~ NA
  )
}

# Try to autodetect the header row by looking for "date" in the cells (case-insensitive).
detect_header_row <- function(df, search_rows = 1:min(20, nrow(df))) {
  scores <- map_int(search_rows, function(r) {
    vals <- as.character(unlist(df[r, ], use.names = FALSE))
    sum(str_detect(str_to_lower(vals), "date"), na.rm = TRUE)
  })
  if (max(scores, na.rm = TRUE) > 0) {
    which.max(scores)
  } else {
    NA_integer_
  }
}

# ============================
# ==== Read the worksheet  ====
# ============================
if (!file.exists(excel_path)) {
  stop(glue("File not found: {excel_path}"))
}

if (!file.exists(metadata_path)) {
  stop(glue("Metadata file not found: {metadata_path}"))
}

df <- tryCatch(
  {
    if (is.null(sheet_name)) {
      readxl::read_excel(excel_path, sheet = sheet_index, col_names = col_names_at_read)
    } else {
      readxl::read_excel(excel_path, sheet = sheet_name, col_names = col_names_at_read)
    }
  },
  error = function(e) {
    stop("Failed to read the Excel sheet. Check the path and sheet (name/index). Original error: ", e$message)
  }
) %>% as_tibble()

# ======================================
# ==== 0) Metadata: export to CSV   =====
# ======================================
metadata_df <- tryCatch(
  {
    if (is.null(metadata_sheet_name)) {
      readxl::read_excel(metadata_path, sheet = metadata_sheet_index, col_names = TRUE)
    } else {
      readxl::read_excel(metadata_path, sheet = metadata_sheet_name, col_names = TRUE)
    }
  },
  error = function(e) {
    stop(
      "Failed to read metadata workbook. Check the path and sheet (name/index). Original error: ",
      e$message
    )
  }
) %>% as_tibble()

# readr::write_csv writes UTF-8 by default
readr::write_csv(metadata_df, metadata_csv_path, na = "")

if (nrow(df) < max(8, header_row, flags_row, series_row)) {
  stop(glue(
    "Worksheet is too short (rows: {nrow(df)}). Expected at least {max(8, header_row, flags_row, series_row)} rows."
  ))
}
if (ncol(df) < 2) {
  stop("Worksheet has fewer than 2 columns. Expected date/value pairs.")
}

# ===========================================
# ==== 1) Get 'date last updated' cell   ====
# ===========================================
# Row 1, Col 2 in the raw sheet
date_updated_raw <- tryCatch(df %>% slice(2) %>% pull(2), error = function(e) NA)
if (all(is.na(date_updated_raw))) {
  stop("Could not pull the 'date last updated' value from row 1, column 2.")
}
date_updated_as_date <- suppressWarnings(coerce_excel_date_scalar(date_updated_raw, origin = excel_origin))
if (is.na(date_updated_as_date)) {
  stop(glue(
    "Failed to convert 'date last updated' to a Date. Got: {deparse(date_updated_raw)}"
  ))
}

# ===========================================
# ==== 2) Updated flags + series IDs     ====
# ===========================================
# rows = flags_row and series_row; drop the first column; transpose; name the two fields
rows_for_flags <- df[c(flags_row, series_row), -1, drop = FALSE]
t_df <- as.data.frame(t(rows_for_flags), stringsAsFactors = FALSE)
colnames(t_df) <- c("updated_this_week", "series_id")


updated_df <- as_tibble(t_df, .name_repair = "minimal") %>%
  mutate(
    updated_this_week = parse_flag(updated_this_week),
    series_id = str_trim(as.character(series_id))
  ) %>%
  filter(
    !is.na(series_id),
    series_id != "",
    series_id != "date"          
  ) %>%
  mutate(date_updated = date_updated_as_date)


readr::write_csv(updated_df, updated_csv_path, na = "")

# ===========================================
# ==== 3) Time-series: tidy to long       ===
# ===========================================
# Header row = 'header_row' unless autodetect finds a better candidate
header_row_eff <- header_row
if (isTRUE(autodetect_header)) {
  detected <- detect_header_row(df)
  if (!is.na(detected)) {
    message(glue("Autodetected header row at {detected}."))
    header_row_eff <- detected
  } else {
    message(glue("Header autodetection found nothing; using configured header_row = {header_row}."))
  }
}

# Slice from header row to end, make the first row the column names, remove empty columns
rti_clean <- df %>%
  slice(header_row_eff:n()) %>%
  janitor::row_to_names(1) %>%
  janitor::remove_empty("cols")

# Defensive: ensure even columns and at least 2 columns
if (ncol(rti_clean) < 2 || (ncol(rti_clean) %% 2 != 0)) {
  stop(glue(
    "Expected an even number of columns (date/value pairs) after promoting row {header_row_eff} to header. Found {ncol(rti_clean)}."
  ))
}

# Clean column names
names(rti_clean) <- make.names(names(rti_clean), unique = TRUE)

old_names <- names(rti_clean)

# Build (date_col, value_col, series_id) mapping
pairs <- tibble::tibble(
  date_col  = old_names[seq(1, length(old_names), by = 2)],
  value_col = old_names[seq(2, length(old_names), by = 2)]
) %>%
  mutate(
    # Strip leading auto-artefacts like x.1., x2., etc.; make more readable
    series_id = value_col %>%
      str_replace(regex("^x\\.?\\d+\\.?", ignore_case = TRUE), "") %>%
      str_replace_all("\\.+", "_") %>%
      str_trim()
  )

# Assemble long time-series
long_df <- purrr::pmap_dfr(
  pairs,
  function(date_col, value_col, series_id) {
    date_vec <- rti_clean[[date_col]]
    tibble(
      series_id = series_id,
      date      = suppressWarnings(coerce_date_vector(date_vec, origin = excel_origin)),
      value     = suppressWarnings(as.numeric(rti_clean[[value_col]]))
    )
  }
) %>%
  filter(!is.na(date))

# Per-series dp from metadata (chart dp, then fallback)
series_dp <- metadata_df %>%
  transmute(
    series_id = str_trim(as.character(series_id)),
    dp = dplyr::coalesce(
      if_else(
        as.logical(as.character(custom_dp_chart)),
        suppressWarnings(as.integer(dp_chart)),
        NA_integer_
      ),
      default_dp
    )
  ) %>%
  mutate(dp = pmax(dp, 0L) + 1L) %>%
  distinct(series_id, .keep_all = TRUE)

# Final formatting and write CSV
long_df_out <- long_df %>%
  left_join(series_dp, by = "series_id") %>%
  rename(num_uk = value) %>%
  mutate(
    num_uk = purrr::map2_dbl(
      num_uk,
      dp,
      ~ round(round(.x, source_max_dp), .y)
    ),
    date   = format(date, "%d/%m/%Y")
  ) %>%
  select(-dp)

readr::write_csv(long_df_out, data_csv_path, na = "")

# ==========================
# ==== Summary messages ====
# ==========================
date_parsed_min <- suppressWarnings(min(as.Date(long_df_out$date, format = "%d/%m/%Y"), na.rm = TRUE))
date_parsed_max <- suppressWarnings(max(as.Date(long_df_out$date, format = "%d/%m/%Y"), na.rm = TRUE))

message(glue("Done. Wrote: {normalizePath(updated_csv_path)} and {normalizePath(data_csv_path)}"))
message(glue(
  "Series: {dplyr::n_distinct(long_df_out$series_id)} | Rows: {nrow(long_df_out)} | ",
  "Date range: {date_parsed_min} to {date_parsed_max}"
))

message(glue("Metadata: wrote {normalizePath(metadata_csv_path)}"))
