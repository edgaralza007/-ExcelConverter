/* ============================================================
   DCF Model Excel Visualizer — app.js
   Fully client-side: SheetJS (xlsx) + Chart.js
   ============================================================ */

(function () {
  'use strict';

  // ── DOM refs ──
  const uploadScreen   = document.getElementById('upload-screen');
  const uploadZone     = document.getElementById('upload-zone');
  const fileInput      = document.getElementById('file-input');
  const uploadError    = document.getElementById('upload-error');
  const dashboard      = document.getElementById('dashboard');
  const fileNameLabel  = document.getElementById('file-name');
  const resetBtn       = document.getElementById('reset-btn');

  // Chart instances (so we can destroy on re-upload)
  let charts = [];

  // ── Upload handling ──
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  resetBtn.addEventListener('click', () => {
    charts.forEach((c) => c.destroy());
    charts = [];
    dashboard.hidden = true;
    uploadScreen.style.display = '';
    fileInput.value = '';
    uploadError.hidden = true;
    document.getElementById('sensitivity-table').innerHTML = '';
  });

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.hidden = false;
  }

  function handleFile(file) {
    uploadError.hidden = true;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      showError('Unsupported file type. Please upload .xlsx, .xls, or .csv');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => showError('Failed to read file.');
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const parsed = parseDCF(workbook);
        if (!parsed) {
          showError('Could not detect DCF model data in this file. Ensure it contains revenue, cash flow, or valuation rows.');
          return;
        }
        renderDashboard(file.name, parsed);
      } catch (err) {
        console.error(err);
        showError('Error parsing file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ────────────────────────────────────────────────
  //  DCF PARSER
  // ────────────────────────────────────────────────

  // Label → canonical key mapping (fuzzy)
  const LABEL_MAP = [
    { key: 'revenue',          patterns: ['revenue', 'total revenue', 'sales', 'total sales', 'net revenue', 'net sales'] },
    { key: 'cogs',             patterns: ['cogs', 'cost of goods', 'cost of revenue', 'cost of sales', 'cos'] },
    { key: 'grossProfit',      patterns: ['gross profit', 'gross income'] },
    { key: 'ebitda',           patterns: ['ebitda', 'adj ebitda', 'adjusted ebitda'] },
    { key: 'da',               patterns: ['depreciation & amortization', 'depreciation and amortization', 'd&a', 'depreciation', 'amortization', 'dep & amort'] },
    { key: 'ebit',             patterns: ['ebit', 'operating income', 'operating profit', 'op income'] },
    { key: 'netIncome',        patterns: ['net income', 'net profit', 'net earnings', 'profit after tax'] },
    { key: 'capex',            patterns: ['capex', 'capital expenditure', 'capital expenditures', 'pp&e purchases', 'purchases of ppe'] },
    { key: 'fcf',              patterns: ['free cash flow', 'fcf', 'unlevered free cash flow', 'ufcf', 'levered free cash flow', 'fcff'] },
    { key: 'wacc',             patterns: ['wacc', 'discount rate', 'weighted average cost of capital', 'cost of capital'] },
    { key: 'terminalGrowth',   patterns: ['terminal growth', 'terminal growth rate', 'perpetuity growth', 'long term growth', 'ltg', 'perpetual growth rate'] },
    { key: 'terminalValue',    patterns: ['terminal value', 'tv', 'continuing value'] },
    { key: 'enterpriseValue',  patterns: ['enterprise value', 'ev', 'total enterprise value', 'firm value'] },
    { key: 'equityValue',      patterns: ['equity value', 'equity value per share', 'share price', 'implied share price', 'price per share', 'target price'] },
    { key: 'sharesOutstanding', patterns: ['shares outstanding', 'diluted shares', 'shares', 'total shares'] },
    { key: 'pvFCF',            patterns: ['pv of fcf', 'pv of free cash flow', 'present value of fcf', 'present value of free cash flows', 'npv of fcf', 'pv fcf'] },
    { key: 'pvTerminal',       patterns: ['pv of terminal', 'pv of tv', 'present value of terminal', 'pv terminal value'] },
    { key: 'tax',              patterns: ['taxes', 'income tax', 'tax expense', 'provision for taxes', 'tax'] },
    { key: 'interestExpense',  patterns: ['interest expense', 'interest'] },
    { key: 'nwc',              patterns: ['change in nwc', 'net working capital', 'changes in working capital', 'nwc', 'working capital'] },
    { key: 'grossMargin',      patterns: ['gross margin'] },
    { key: 'ebitdaMargin',     patterns: ['ebitda margin'] },
    { key: 'netMargin',        patterns: ['net margin', 'net income margin', 'profit margin'] },
  ];

  function normalize(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function matchLabel(raw) {
    const n = normalize(raw);
    for (const entry of LABEL_MAP) {
      for (const p of entry.patterns) {
        // Exact match or starts-with match
        if (n === p || n.startsWith(p + ' ') || n.endsWith(' ' + p)) return entry.key;
        // Contains with word boundaries
        if (n.includes(p) && (n.length - p.length) < 10) return entry.key;
      }
    }
    return null;
  }

  function isYearLike(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 2000 && n <= 2050;
  }

  function pickBestSheet(workbook) {
    const preferred = ['dcf', 'model', 'valuation', 'output', 'summary', 'forecast'];
    const names = workbook.SheetNames;
    for (const pref of preferred) {
      const match = names.find((n) => normalize(n).includes(pref));
      if (match) return match;
    }
    // Fallback: sheet with most rows
    let best = names[0], bestRows = 0;
    for (const name of names) {
      const sheet = workbook.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (json.length > bestRows) { bestRows = json.length; best = name; }
    }
    return best;
  }

  function parseDCF(workbook) {
    // Try the best sheet first, then fall back to scanning all sheets
    const sheetsToTry = [pickBestSheet(workbook), ...workbook.SheetNames];
    const tried = new Set();
    let bestResult = null;
    let bestScore = 0;

    for (const sheetName of sheetsToTry) {
      if (tried.has(sheetName)) continue;
      tried.add(sheetName);

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const result = parseSheet(rows);
      if (!result) continue;

      // Score: count how many keys have data
      const score = Object.keys(result.series).length + Object.keys(result.scalars).length * 2;
      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }

    // If we didn't find enough from a single sheet, try merging across sheets
    if (bestResult && bestScore < 4) return null;
    return bestResult;
  }

  function parseSheet(rows) {
    if (!rows || rows.length < 2) return null;

    // 1. Detect year columns
    let yearRow = null;
    let yearCols = []; // { col, year }
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const row = rows[r];
      if (!row) continue;
      const yrs = [];
      for (let c = 1; c < row.length; c++) {
        if (isYearLike(row[c])) yrs.push({ col: c, year: Number(row[c]) });
      }
      if (yrs.length >= 2) { yearRow = r; yearCols = yrs; break; }
    }

    // Also accept column headers like "FY2025" or "2025E"
    if (!yearCols.length) {
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const row = rows[r];
        if (!row) continue;
        const yrs = [];
        for (let c = 1; c < row.length; c++) {
          const v = String(row[c] || '');
          const m = v.match(/(20\d{2})/);
          if (m) yrs.push({ col: c, year: Number(m[1]) });
        }
        if (yrs.length >= 2) { yearRow = r; yearCols = yrs; break; }
      }
    }

    const years = yearCols.map((y) => y.year);
    const series = {};   // key → [values per year]
    const scalars = {};  // key → single value

    // 2. Scan rows for label matches
    for (let r = 0; r < rows.length; r++) {
      if (r === yearRow) continue;
      const row = rows[r];
      if (!row || !row[0]) continue;

      const key = matchLabel(row[0]);
      if (!key) continue;

      // Check if this is a time-series row or a scalar
      if (yearCols.length) {
        const vals = yearCols.map((yc) => {
          const v = row[yc.col];
          return v != null ? Number(v) : null;
        });
        const hasData = vals.some((v) => v !== null && !isNaN(v));
        if (hasData) {
          series[key] = vals.map((v) => (v !== null && !isNaN(v) ? v : null));
          continue;
        }
      }

      // Scalar: grab the first numeric value in the row
      for (let c = 1; c < row.length; c++) {
        const v = Number(row[c]);
        if (!isNaN(v) && row[c] !== '' && row[c] != null) {
          scalars[key] = v;
          break;
        }
      }
    }

    if (Object.keys(series).length === 0 && Object.keys(scalars).length === 0) return null;

    // 3. Compute derived metrics if missing
    deriveMetrics(series, scalars, years);

    return { years, series, scalars };
  }

  function deriveMetrics(series, scalars, years) {
    const len = years.length;

    // Gross profit = revenue - cogs
    if (!series.grossProfit && series.revenue && series.cogs) {
      series.grossProfit = series.revenue.map((r, i) =>
        r != null && series.cogs[i] != null ? r - Math.abs(series.cogs[i]) : null
      );
    }

    // EBITDA = EBIT + D&A
    if (!series.ebitda && series.ebit && series.da) {
      series.ebitda = series.ebit.map((e, i) =>
        e != null && series.da[i] != null ? e + Math.abs(series.da[i]) : null
      );
    }

    // EBIT = EBITDA - D&A
    if (!series.ebit && series.ebitda && series.da) {
      series.ebit = series.ebitda.map((eb, i) =>
        eb != null && series.da[i] != null ? eb - Math.abs(series.da[i]) : null
      );
    }

    // Margins (as percentages)
    if (series.revenue) {
      if (!series.grossMargin && series.grossProfit) {
        series.grossMargin = series.revenue.map((r, i) =>
          r ? ((series.grossProfit[i] || 0) / r) * 100 : null
        );
      }
      if (!series.ebitdaMargin && series.ebitda) {
        series.ebitdaMargin = series.revenue.map((r, i) =>
          r ? ((series.ebitda[i] || 0) / r) * 100 : null
        );
      }
      if (!series.netMargin && series.netIncome) {
        series.netMargin = series.revenue.map((r, i) =>
          r ? ((series.netIncome[i] || 0) / r) * 100 : null
        );
      }
    }

    // WACC / terminal growth — promote series single values to scalars
    for (const k of ['wacc', 'terminalGrowth']) {
      if (!scalars[k] && series[k]) {
        const v = series[k].find((x) => x != null);
        if (v != null) scalars[k] = v;
      }
    }

    // If WACC looks like a decimal (0.10), convert to percent display
    if (scalars.wacc && scalars.wacc > 0 && scalars.wacc < 1) {
      scalars.wacc = scalars.wacc * 100;
    }
    if (scalars.terminalGrowth && scalars.terminalGrowth > 0 && scalars.terminalGrowth < 1) {
      scalars.terminalGrowth = scalars.terminalGrowth * 100;
    }

    // Enterprise Value from scalars or last series value
    if (!scalars.enterpriseValue && series.enterpriseValue) {
      const v = series.enterpriseValue.filter((x) => x != null).pop();
      if (v != null) scalars.enterpriseValue = v;
    }
    if (!scalars.terminalValue && series.terminalValue) {
      const v = series.terminalValue.filter((x) => x != null).pop();
      if (v != null) scalars.terminalValue = v;
    }
    if (!scalars.equityValue && series.equityValue) {
      const v = series.equityValue.filter((x) => x != null).pop();
      if (v != null) scalars.equityValue = v;
    }

    // Equity value per share
    if (!scalars.equityValue && scalars.enterpriseValue) {
      // rough: EV ≈ equity (no net debt adjustment without data)
      scalars.equityValue = scalars.enterpriseValue;
    }

    // PV of FCF / PV of terminal
    if (!scalars.pvFCF && series.pvFCF) {
      scalars.pvFCF = series.pvFCF.reduce((a, b) => (a || 0) + (b || 0), 0);
    }
    if (!scalars.pvTerminal && series.pvTerminal) {
      const v = series.pvTerminal.filter((x) => x != null).pop();
      if (v != null) scalars.pvTerminal = v;
    }

    // If we have EV and pvTerminal but no pvFCF, derive it
    if (scalars.enterpriseValue && scalars.pvTerminal && !scalars.pvFCF) {
      scalars.pvFCF = scalars.enterpriseValue - scalars.pvTerminal;
    }
    if (scalars.enterpriseValue && scalars.pvFCF && !scalars.pvTerminal) {
      scalars.pvTerminal = scalars.enterpriseValue - scalars.pvFCF;
    }
  }

  // ────────────────────────────────────────────────
  //  RENDER DASHBOARD
  // ────────────────────────────────────────────────

  function renderDashboard(fileName, data) {
    // Destroy old charts
    charts.forEach((c) => c.destroy());
    charts = [];

    uploadScreen.style.display = 'none';
    dashboard.hidden = false;
    fileNameLabel.textContent = fileName;

    renderSummaryCards(data);
    renderRevenueFCF(data);
    renderMargins(data);
    renderWaterfall(data);
    renderValuation(data);
    renderGrowth(data);
    renderSensitivity(data);
  }

  // ── Helpers ──
  function fmt(value, opts = {}) {
    if (value == null || isNaN(value)) return '--';
    const abs = Math.abs(value);
    if (opts.pct) return value.toFixed(1) + '%';
    if (opts.dollar === false) {
      if (abs >= 1e9) return (value / 1e9).toFixed(1) + 'B';
      if (abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
      if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
      return value.toFixed(1);
    }
    if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
    return '$' + value.toFixed(2);
  }

  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: '#8b8fa3', font: { size: 12 } } },
    },
    scales: {
      x: { ticks: { color: '#8b8fa3' }, grid: { color: 'rgba(42,46,61,0.5)' } },
      y: { ticks: { color: '#8b8fa3' }, grid: { color: 'rgba(42,46,61,0.5)' } },
    },
  };

  function makeScales(yLabel) {
    return {
      x: { ...CHART_DEFAULTS.scales.x },
      y: {
        ...CHART_DEFAULTS.scales.y,
        title: { display: !!yLabel, text: yLabel || '', color: '#8b8fa3' },
      },
    };
  }

  // ── Summary Cards ──
  function renderSummaryCards(data) {
    const s = data.scalars;
    document.getElementById('val-ev').textContent = fmt(s.enterpriseValue);
    document.getElementById('val-equity').textContent = fmt(s.equityValue);
    document.getElementById('val-wacc').textContent = s.wacc != null ? s.wacc.toFixed(1) + '%' : '--';
    document.getElementById('val-terminal-growth').textContent = s.terminalGrowth != null ? s.terminalGrowth.toFixed(1) + '%' : '--';
    document.getElementById('val-terminal-value').textContent = fmt(s.terminalValue);

    // IRR estimate: if we have FCFs and EV, compute a rough IRR
    let irr = null;
    if (data.series.fcf && s.enterpriseValue) {
      irr = estimateIRR(data.series.fcf, s.enterpriseValue, s.terminalValue);
    }
    document.getElementById('val-irr').textContent = irr != null ? irr.toFixed(1) + '%' : '--';
  }

  function estimateIRR(fcfs, ev, tv) {
    // Simple IRR: find rate where NPV of FCFs + TV = EV
    const n = fcfs.filter((x) => x != null).length;
    if (n < 2) return null;
    const cashFlows = [-ev, ...fcfs.filter((x) => x != null)];
    if (tv) cashFlows[cashFlows.length - 1] += tv;

    // Newton's method on NPV
    let rate = 0.10;
    for (let iter = 0; iter < 100; iter++) {
      let npv = 0, dnpv = 0;
      for (let t = 0; t < cashFlows.length; t++) {
        const cf = cashFlows[t];
        if (cf == null) continue;
        npv += cf / Math.pow(1 + rate, t);
        dnpv -= t * cf / Math.pow(1 + rate, t + 1);
      }
      if (Math.abs(dnpv) < 1e-10) break;
      const next = rate - npv / dnpv;
      if (Math.abs(next - rate) < 1e-7) { rate = next; break; }
      rate = next;
      if (rate < -0.99 || rate > 10) return null; // diverged
    }
    return rate * 100;
  }

  // ── Chart 1: Revenue & FCF Trend ──
  function renderRevenueFCF(data) {
    const ctx = document.getElementById('chart-revenue-fcf');
    if (!data.series.revenue && !data.series.fcf) {
      hideChart('chart-revenue-fcf-wrap');
      return;
    }

    const datasets = [];
    if (data.series.revenue) {
      datasets.push({
        label: 'Revenue',
        data: data.series.revenue,
        backgroundColor: 'rgba(79, 140, 255, 0.6)',
        borderColor: 'rgba(79, 140, 255, 1)',
        borderWidth: 1,
        type: 'bar',
        order: 2,
      });
    }
    if (data.series.fcf) {
      datasets.push({
        label: 'Free Cash Flow',
        data: data.series.fcf,
        borderColor: '#34d399',
        backgroundColor: 'rgba(52, 211, 153, 0.15)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        type: 'line',
        order: 1,
        yAxisID: data.series.revenue ? 'y1' : 'y',
      });
    }

    const config = {
      type: 'bar',
      data: { labels: data.years.map(String), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: CHART_DEFAULTS.plugins.legend },
        scales: {
          x: CHART_DEFAULTS.scales.x,
          y: { ...CHART_DEFAULTS.scales.y, position: 'left', title: { display: true, text: 'Revenue', color: '#8b8fa3' } },
          ...(data.series.revenue && data.series.fcf ? {
            y1: { ...CHART_DEFAULTS.scales.y, position: 'right', title: { display: true, text: 'FCF', color: '#8b8fa3' }, grid: { drawOnChartArea: false } }
          } : {}),
        },
      },
    };

    charts.push(new Chart(ctx, config));
  }

  // ── Chart 2: Margin Analysis ──
  function renderMargins(data) {
    const ctx = document.getElementById('chart-margins');
    const keys = [
      { key: 'grossMargin', label: 'Gross Margin', color: '#4f8cff' },
      { key: 'ebitdaMargin', label: 'EBITDA Margin', color: '#34d399' },
      { key: 'netMargin', label: 'Net Margin', color: '#a78bfa' },
    ];

    const datasets = keys
      .filter((k) => data.series[k.key])
      .map((k) => ({
        label: k.label,
        data: data.series[k.key],
        borderColor: k.color,
        backgroundColor: k.color + '22',
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointRadius: 4,
      }));

    if (datasets.length === 0) { hideChart('chart-margins-wrap'); return; }

    charts.push(new Chart(ctx, {
      type: 'line',
      data: { labels: data.years.map(String), datasets },
      options: {
        ...CHART_DEFAULTS,
        scales: makeScales('Margin (%)'),
      },
    }));
  }

  // ── Chart 3: Cash Flow Waterfall ──
  function renderWaterfall(data) {
    const ctx = document.getElementById('chart-waterfall');

    // Use the latest year that has data
    const steps = ['revenue', 'ebitda', 'ebit', 'netIncome', 'fcf'];
    const labels = ['Revenue', 'EBITDA', 'EBIT', 'Net Income', 'FCF'];
    const lastIdx = data.years.length - 1;

    const values = steps.map((k) => {
      if (data.series[k]) return data.series[k][lastIdx];
      return null;
    }).filter((v) => v != null);

    const usedLabels = steps
      .map((k, i) => (data.series[k] && data.series[k][lastIdx] != null ? labels[i] : null))
      .filter((l) => l != null);

    if (values.length < 2) { hideChart('chart-waterfall-wrap'); return; }

    // Build waterfall: floating bars
    const bgColors = [];
    const floatingData = [];
    for (let i = 0; i < values.length; i++) {
      if (i === 0) {
        floatingData.push([0, values[0]]);
        bgColors.push('rgba(79, 140, 255, 0.7)');
      } else {
        const prev = values[i - 1];
        const curr = values[i];
        floatingData.push([Math.min(prev, curr), Math.max(prev, curr)]);
        bgColors.push(curr >= prev ? 'rgba(52, 211, 153, 0.7)' : 'rgba(248, 113, 113, 0.7)');
      }
    }

    // Also show the final value as a full bar
    floatingData[floatingData.length - 1] = [0, values[values.length - 1]];
    bgColors[bgColors.length - 1] = 'rgba(167, 139, 250, 0.7)';

    charts.push(new Chart(ctx, {
      type: 'bar',
      data: {
        labels: usedLabels,
        datasets: [{
          label: `Waterfall (${data.years[lastIdx]})`,
          data: floatingData,
          backgroundColor: bgColors,
          borderColor: bgColors.map((c) => c.replace('0.7', '1')),
          borderWidth: 1,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        scales: makeScales(''),
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = Array.isArray(ctx.raw) ? ctx.raw[1] : ctx.raw;
                return fmt(v);
              },
            },
          },
        },
      },
    }));
  }

  // ── Chart 4: DCF Valuation Breakdown (Doughnut) ──
  function renderValuation(data) {
    const ctx = document.getElementById('chart-valuation');
    const pvFCF = data.scalars.pvFCF;
    const pvTV = data.scalars.pvTerminal;

    if (pvFCF == null && pvTV == null) { hideChart('chart-valuation-wrap'); return; }

    const vals = [];
    const labs = [];
    const cols = [];
    if (pvFCF != null)  { vals.push(Math.abs(pvFCF));  labs.push('PV of FCFs');        cols.push('#4f8cff'); }
    if (pvTV != null)   { vals.push(Math.abs(pvTV));    labs.push('PV of Terminal Value'); cols.push('#34d399'); }

    charts.push(new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labs,
        datasets: [{
          data: vals,
          backgroundColor: cols.map((c) => c + 'bb'),
          borderColor: cols,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8b8fa3', padding: 16, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return `${ctx.label}: ${fmt(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    }));
  }

  // ── Chart 5: Growth Rates ──
  function renderGrowth(data) {
    const ctx = document.getElementById('chart-growth');
    const metricsToShow = [
      { key: 'revenue', label: 'Revenue', color: '#4f8cff' },
      { key: 'ebitda', label: 'EBITDA', color: '#34d399' },
      { key: 'fcf', label: 'FCF', color: '#fbbf24' },
      { key: 'netIncome', label: 'Net Income', color: '#a78bfa' },
    ];

    const datasets = [];
    const growthYears = data.years.slice(1);

    for (const m of metricsToShow) {
      if (!data.series[m.key]) continue;
      const vals = data.series[m.key];
      const growth = [];
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i - 1] !== 0) {
          growth.push(((vals[i] - vals[i - 1]) / Math.abs(vals[i - 1])) * 100);
        } else {
          growth.push(null);
        }
      }
      if (growth.some((g) => g !== null)) {
        datasets.push({
          label: m.label + ' Growth',
          data: growth,
          backgroundColor: m.color + '99',
          borderColor: m.color,
          borderWidth: 1,
        });
      }
    }

    if (datasets.length === 0) { hideChart('chart-growth-wrap'); return; }

    charts.push(new Chart(ctx, {
      type: 'bar',
      data: { labels: growthYears.map(String), datasets },
      options: {
        ...CHART_DEFAULTS,
        scales: makeScales('Growth (%)'),
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw.toFixed(1) + '%' : 'N/A'}`,
            },
          },
        },
      },
    }));
  }

  // ── Chart 6: Sensitivity Table ──
  function renderSensitivity(data) {
    const container = document.getElementById('sensitivity-table');
    container.innerHTML = '';

    const baseWACC = data.scalars.wacc;
    const baseTG = data.scalars.terminalGrowth;
    const baseEV = data.scalars.enterpriseValue;
    const lastFCF = data.series.fcf
      ? data.series.fcf.filter((x) => x != null).pop()
      : null;

    if (baseWACC == null || baseTG == null || (baseEV == null && lastFCF == null)) {
      hideChart('sensitivity-wrap');
      return;
    }

    // Generate grid: WACC variations x Terminal Growth variations
    const waccBase = baseWACC; // already in %
    const tgBase = baseTG;     // already in %
    const waccRange = [-2.0, -1.0, -0.5, 0, 0.5, 1.0, 2.0].map((d) => waccBase + d);
    const tgRange = [-1.0, -0.5, 0, 0.5, 1.0].map((d) => tgBase + d);

    // Compute EV using Gordon Growth: TV = FCF*(1+g) / (WACC-g), then approximate EV
    function computeEV(wacc, tg) {
      const w = wacc / 100;
      const g = tg / 100;
      if (w <= g) return null;
      if (lastFCF && lastFCF > 0) {
        return (lastFCF * (1 + g)) / (w - g);
      }
      // Scale from base EV
      if (baseEV) {
        const baseW = baseWACC / 100;
        const baseG = baseTG / 100;
        if (baseW <= baseG) return baseEV;
        const ratio = ((1 + g) / (w - g)) / ((1 + baseG) / (baseW - baseG));
        return baseEV * ratio;
      }
      return null;
    }

    let html = '<table><thead><tr><th>WACC \\ TGR</th>';
    for (const tg of tgRange) html += `<th>${tg.toFixed(1)}%</th>`;
    html += '</tr></thead><tbody>';

    for (const wacc of waccRange) {
      html += `<tr><th>${wacc.toFixed(1)}%</th>`;
      for (const tg of tgRange) {
        const ev = computeEV(wacc, tg);
        const isBase = Math.abs(wacc - waccBase) < 0.01 && Math.abs(tg - tgBase) < 0.01;
        html += `<td class="${isBase ? 'cell-highlight' : ''}">${ev != null ? fmt(ev) : '--'}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function hideChart(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

})();
