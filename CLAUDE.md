# DCF Model Excel Visualizer

A fully client-side browser application that parses Excel DCF (Discounted Cash Flow) models and generates interactive financial dashboards with charts and sensitivity analysis.

## How to Run

Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge). No server or build step required.

## Supported Formats

- `.xlsx` (Excel 2007+)
- `.xls` (legacy Excel)
- `.csv`

## Expected Excel Structure

The parser auto-detects DCF model structure by fuzzy-matching row labels. It works best when:

- **Year headers** appear in a row (e.g., 2024, 2025, 2026 or FY2025, 2025E)
- **Row labels** are in the first column and contain recognizable financial terms:
  - Revenue / Sales
  - COGS / Cost of Goods Sold
  - Gross Profit
  - EBITDA
  - EBIT / Operating Income
  - Net Income
  - Free Cash Flow / FCF / UFCF
  - CapEx
  - Depreciation & Amortization
  - WACC / Discount Rate
  - Terminal Growth Rate
  - Terminal Value
  - Enterprise Value
  - Equity Value / Share Price
- Sheets named "DCF", "Model", "Valuation", "Output", or "Summary" are checked first

## Features

- **Drag & drop** or click-to-upload file input
- **Summary cards**: Enterprise Value, Equity Value/Share, WACC, Terminal Growth Rate, Terminal Value, Implied IRR
- **6 visualizations**:
  1. Revenue & FCF Trend (bar + line combo)
  2. Margin Analysis (gross, EBITDA, net margins over time)
  3. Cash Flow Waterfall (Revenue → EBITDA → EBIT → Net Income → FCF)
  4. DCF Valuation Breakdown (doughnut: PV of FCFs vs Terminal Value)
  5. YoY Growth Rates (revenue, EBITDA, FCF, net income)
  6. Sensitivity Table (Enterprise Value at varying WACC / terminal growth combos)
- **Derived metrics**: Automatically computes margins, growth rates, and missing intermediary values from available data

## Dependencies (loaded via CDN)

- [SheetJS (xlsx)](https://sheetjs.com/) — Excel parsing
- [Chart.js](https://www.chartjs.org/) — Charting
