// UI rendering. Pure functions of state → DOM strings/elements; event wiring in app.js.

import { runSingleFamily, runMultifamily, runWaterfall, mortgagePayment, irr, equityMultiple } from './finance.js';
import { drawLineChart, drawBarChart, drawHeatmap, colors } from './charts.js';

// === formatters ===
export const fmt = {
  usd: (x, d = 0) => {
    if (x == null || !isFinite(x)) return '—';
    const sign = x < 0 ? '-' : '';
    const a = Math.abs(x);
    return sign + '$' + a.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },
  usdK: (x) => {
    if (x == null || !isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1_000_000) return (x < 0 ? '-' : '') + '$' + (a / 1_000_000).toFixed(2) + 'M';
    if (a >= 1000) return (x < 0 ? '-' : '') + '$' + (a / 1000).toFixed(0) + 'k';
    return fmt.usd(x);
  },
  pct: (x, d = 2) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%',
  num: (x, d = 2) => x == null || !isFinite(x) ? '—' : x.toFixed(d),
  ratio: (x) => x == null || !isFinite(x) ? '—' : x.toFixed(2) + 'x',
};

// === computation cache ===
export function compute(state) {
  if (state.mode === 'sf') {
    return { kind: 'sf', result: runSingleFamily(state.sf) };
  } else {
    const mfRes = runMultifamily(state.mf);
    const w = state.mf.waterfall;
    const wf = runWaterfall({
      projectCashflows: mfRes.cfPre,
      lpShare: w.lpShare,
      prefRate: w.prefRate,
      tier1Promote: { lp: w.tier1LP, gp: w.tier1GP },
      tier2Hurdle: w.tier2Hurdle,
      tier2Promote: { lp: w.tier2LP, gp: w.tier2GP },
    });
    return { kind: 'mf', result: mfRes, waterfall: wf };
  }
}

// === verdict logic ===
function sfVerdict(r) {
  const flags = [];
  let pass = true, warn = false;
  if (r.dscr < 1.0) { flags.push({ level: 'fail', label: 'DSCR', body: `DSCR ${r.dscr.toFixed(2)} is below 1.0 — debt service exceeds NOI.` }); pass = false; }
  else if (r.dscr < 1.20) { flags.push({ level: 'warn', label: 'DSCR', body: `DSCR ${r.dscr.toFixed(2)} below typical lender minimum (1.20).` }); warn = true; }
  else { flags.push({ level: 'pass', label: 'DSCR', body: `DSCR ${r.dscr.toFixed(2)} clears the typical 1.20 lender threshold.` }); }

  if (r.onePctRatio >= 0.01) flags.push({ level: 'pass', label: '1% rule', body: `Monthly rent ${fmt.pct(r.onePctRatio, 2)} of price — passes the 1% rule.` });
  else flags.push({ level: 'warn', label: '1% rule', body: `Monthly rent ${fmt.pct(r.onePctRatio, 2)} of price — below the 1% rule benchmark.` });

  if (r.irrAfterTax !== null) {
    if (r.irrAfterTax < 0.05) { flags.push({ level: 'fail', label: 'IRR', body: `10-year after-tax IRR ${fmt.pct(r.irrAfterTax)} is below 5%.` }); pass = false; }
    else if (r.irrAfterTax < 0.10) { flags.push({ level: 'warn', label: 'IRR', body: `10-year after-tax IRR ${fmt.pct(r.irrAfterTax)} is modest.` }); warn = true; }
  }

  if (r.refiMetrics) {
    const rm = r.refiMetrics;
    if (!rm.passesLenderDSCR) {
      flags.push({ level: 'fail', label: 'Refi DSCR', body: `Post-refi DSCR ${rm.refiDSCR.toFixed(2)} fails ${(r.inputs.refiMinDSCR || 1.20).toFixed(2)} minimum.` });
      pass = false;
    } else {
      flags.push({ level: 'pass', label: 'Refi', body: `Cash-out refi pulls out ${fmt.usdK(rm.cashOut)}; cash-left-in ${fmt.usdK(rm.cashLeftIn)}.` });
    }
  }
  return { pass, warn, flags };
}

function mfVerdict(r, w) {
  const flags = [];
  let pass = true, warn = false;
  if (r.dscr < 1.0) { flags.push({ level: 'fail', label: 'DSCR', body: `Qualifying DSCR ${r.dscr.toFixed(2)} below 1.0.` }); pass = false; }
  else if (r.dscr < 1.20) { flags.push({ level: 'warn', label: 'DSCR', body: `Qualifying DSCR ${r.dscr.toFixed(2)} below typical 1.20.` }); warn = true; }
  else flags.push({ level: 'pass', label: 'DSCR', body: `Qualifying DSCR ${r.dscr.toFixed(2)} clears 1.20.` });

  if (r.stressDSCR < 1.0) { flags.push({ level: 'warn', label: 'Stress', body: `+200bps stress DSCR ${r.stressDSCR.toFixed(2)} dips below 1.0.` }); warn = true; }
  else flags.push({ level: 'pass', label: 'Stress', body: `Holds DSCR ${r.stressDSCR.toFixed(2)} under +200bps rate shock.` });

  const rentGap = (r.rentRoll.annualProFormaRent / r.rentRoll.annualInPlaceRent) - 1;
  flags.push({ level: 'pass', label: 'Rent gap', body: `Pro-forma rents ${fmt.pct(rentGap, 1)} above in-place — captured via value-add.` });

  if (w) {
    if (!w.lpCleared) {
      flags.push({ level: 'fail', label: 'LP pref', body: `LP fails to clear the ${fmt.pct(r.inputs.waterfall.prefRate, 0)} preferred return.` });
      pass = false;
    } else {
      flags.push({ level: 'pass', label: 'LP pref', body: `LP clears ${fmt.pct(r.inputs.waterfall.prefRate, 0)} pref; LP IRR ${fmt.pct(w.lpIRR)}.` });
    }
  }
  return { pass, warn, flags };
}

// === DASHBOARD ===
export function renderDashboard(state) {
  const c = compute(state);
  const r = c.result;
  const isMF = c.kind === 'mf';
  const w = isMF ? c.waterfall : null;
  const verdict = isMF ? mfVerdict(r, w) : sfVerdict(r);
  const verdictClass = verdict.pass ? (verdict.warn ? 'warn' : 'pass') : 'fail';
  const verdictText = verdict.pass
    ? (verdict.warn ? 'PROCEED WITH CAUTION' : 'UNDERWRITE PASSES')
    : 'DO NOT UNDERWRITE';

  let primaryNum, primaryLabel;
  if (isMF) { primaryNum = fmt.pct(r.irrAfterTax); primaryLabel = '10-YR LEVERED AT IRR'; }
  else { primaryNum = fmt.pct(r.irrAfterTax); primaryLabel = '10-YR LEVERED AT IRR'; }

  const kpis = isMF ? mfKPIs(r, w) : sfKPIs(r);

  return `
    <section class="verdict ${verdictClass}">
      <div class="verdict-mark">${verdict.pass ? (verdict.warn ? '⚠' : '✓') : '✗'}</div>
      <div class="verdict-body">
        <div class="verdict-headline">${verdictText}</div>
        <div class="verdict-detail">${
          isMF ? `${r.rentRoll.totalUnits}-unit value-add · ${fmt.usdK(r.inputs.purchasePrice)} · ${fmt.pct(r.goingInCap)} going-in cap`
               : `${fmt.usdK(r.inputs.purchasePrice)} acquisition · ${fmt.pct(r.capRate)} cap · ${r.dscr.toFixed(2)} DSCR`
        }</div>
      </div>
      <div style="text-align:right">
        <div class="kpi-label">${primaryLabel}</div>
        <div class="kpi-value" style="font-size:32px;margin-top:4px">${primaryNum}</div>
      </div>
    </section>

    <div class="kpi-grid">${kpis}</div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">10-Year cash flow <span class="meta">${state.proFormaView === 'pre' ? 'pre-tax' : 'after-tax'}</span></div>
      <div class="chart-box"><canvas class="chart" id="chart-cf" height="200"></canvas></div>
    </div>

    <div class="card">
      <div class="card-title">${isMF ? 'NOI growth' : 'NOI vs debt service'}</div>
      <div class="chart-box"><canvas class="chart" id="chart-noi" height="200"></canvas></div>
    </div>

    <div class="card">
      <div class="card-title">Flags &amp; checks</div>
      <div class="flags">${verdict.flags.map((f) => `
        <div class="flag ${f.level}">
          <span class="flag-mark">${f.label}</span>
          <span class="flag-body">${f.body}</span>
        </div>
      `).join('')}</div>
    </div>
  `;
}

function sfKPIs(r) {
  const tiles = [
    { label: 'Monthly cash flow', value: fmt.usd(r.monthlyCF, 0), cls: r.monthlyCF >= 0 ? '' : 'negative' },
    { label: 'Cash-on-cash', value: fmt.pct(r.cashOnCash), sub: `Y1 pre-tax` },
    { label: 'Going-in cap', value: fmt.pct(r.capRate), sub: 'unlevered' },
    { label: 'DSCR (Y1)', value: r.dscr.toFixed(2), cls: r.dscr >= 1.20 ? '' : (r.dscr >= 1.0 ? 'warning' : 'negative') },
    { label: 'AT levered IRR', value: fmt.pct(r.irrAfterTax), sub: '10-yr' },
    { label: 'Equity multiple', value: fmt.ratio(r.equityMultipleAfter), sub: 'after-tax' },
    { label: 'Cash invested', value: fmt.usdK(r.totalCashIn), sub: 'down + closing + rehab' },
    { label: 'Break-even occ.', value: fmt.pct(r.breakEvenOcc), sub: 'OpEx + debt ÷ PGI' },
  ];
  return tiles.map(kpiTile).join('');
}

function mfKPIs(r, w) {
  const tiles = [
    { label: 'Y1 cash flow', value: fmt.usdK(r.years[0].cfBeforeTax), cls: r.years[0].cfBeforeTax >= 0 ? '' : 'negative' },
    { label: 'Cash-on-cash (Y1)', value: fmt.pct(r.cashOnCash) },
    { label: 'Going-in cap', value: fmt.pct(r.goingInCap), sub: 'in-place' },
    { label: 'Stabilized cap', value: fmt.pct(r.stabilizedCap), sub: 'exit' },
    { label: 'AT levered IRR', value: fmt.pct(r.irrAfterTax), sub: '10-yr project' },
    { label: 'Equity multiple', value: fmt.ratio(r.equityMultipleAfter), sub: 'project AT' },
    { label: 'Qualifying DSCR', value: r.dscr.toFixed(2), cls: r.dscr >= 1.20 ? '' : 'warning' },
    { label: 'LP IRR', value: w && w.lpIRR != null ? fmt.pct(w.lpIRR) : '—', sub: 'European waterfall' },
  ];
  return tiles.map(kpiTile).join('');
}

function kpiTile({ label, value, sub = '', cls = '' }) {
  return `
    <div class="kpi ${cls}">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${value.length > 8 ? 'tight' : ''}">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>
  `;
}

// === INPUTS ===
export function renderInputs(state) {
  if (state.mode === 'sf') return renderSFInputs(state.sf);
  return renderMFInputs(state.mf);
}

function input(name, label, value, opts = {}) {
  const fmtVal = opts.fmt === 'pct' ? (value * 100).toString() : value;
  const hint = opts.fmt === 'pct' ? '%' : opts.fmt === 'usd' ? '$' : (opts.hint || '');
  const step = opts.step || (opts.fmt === 'pct' ? '0.01' : '1');
  return `
    <div class="field">
      <label class="field-label" for="i_${name}">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</label>
      <input class="field-input" type="number" step="${step}" id="i_${name}" name="${name}" data-fmt="${opts.fmt || ''}" value="${fmtVal}" />
    </div>
  `;
}

function section(title, content) {
  return `<div class="form-section">
    <h3 class="section-title">${title}</h3>
    <div class="form-grid">${content}</div>
  </div>`;
}

function renderSFInputs(s) {
  return `
    ${section('Acquisition', `
      ${input('purchasePrice', 'Purchase price', s.purchasePrice, { fmt: 'usd' })}
      ${input('downPct', 'Down payment', s.downPct, { fmt: 'pct' })}
      ${input('closingCostPct', 'Closing costs', s.closingCostPct, { fmt: 'pct' })}
      ${input('rehabBudget', 'Rehab budget', s.rehabBudget, { fmt: 'usd' })}
      ${input('rehabMonths', 'Rehab months', s.rehabMonths, { hint: 'mo' })}
      ${input('landPct', 'Land allocation', s.landPct, { fmt: 'pct' })}
    `)}
    ${section('Financing (Acquisition)', `
      ${input('rate', 'Interest rate', s.rate, { fmt: 'pct' })}
      ${input('termYears', 'Term', s.termYears, { hint: 'yr' })}
    `)}
    ${section('Revenue', `
      ${input('grossMonthlyRent', 'Gross monthly rent', s.grossMonthlyRent, { fmt: 'usd' })}
      ${input('otherIncomeAnnual', 'Other annual income', s.otherIncomeAnnual, { fmt: 'usd' })}
      ${input('vacancyPct', 'Vacancy', s.vacancyPct, { fmt: 'pct' })}
    `)}
    ${section('Operating expenses', `
      ${input('propertyTax', 'Property tax (annual)', s.propertyTax, { fmt: 'usd' })}
      ${input('insurance', 'Insurance (annual)', s.insurance, { fmt: 'usd' })}
      ${input('mgmtPct', 'Management', s.mgmtPct, { fmt: 'pct', hint: '% of EGI' })}
      ${input('maintenancePct', 'Maintenance', s.maintenancePct, { fmt: 'pct', hint: '% of GPR' })}
      ${input('capexPct', 'CapEx reserve', s.capexPct, { fmt: 'pct', hint: '% of GPR' })}
    `)}
    ${section('Growth & exit', `
      ${input('rentGrowth', 'Rent growth', s.rentGrowth, { fmt: 'pct' })}
      ${input('expenseGrowth', 'Expense growth', s.expenseGrowth, { fmt: 'pct' })}
      ${input('exitCapRate', 'Exit cap rate', s.exitCapRate, { fmt: 'pct' })}
      ${input('saleCostPct', 'Sale costs', s.saleCostPct, { fmt: 'pct' })}
    `)}
    ${section('Tax', `
      ${input('ordinaryTaxRate', 'Ordinary income rate', s.ordinaryTaxRate, { fmt: 'pct' })}
      ${input('ltcgRate', 'Long-term cap-gains rate', s.ltcgRate, { fmt: 'pct' })}
    `)}
    <div class="form-section">
      <h3 class="section-title">BRRRR refinance</h3>
      <div style="margin-bottom:10px">
        <label class="toggle">
          <input type="checkbox" id="i_refiEnabled" name="refiEnabled" ${s.refiEnabled ? 'checked' : ''} />
          <span class="switch"></span>
          <span class="toggle-label">Enable cash-out refinance</span>
        </label>
      </div>
      <div class="form-grid" id="refi-fields" style="${s.refiEnabled ? '' : 'opacity:0.5; pointer-events:none'}">
        ${input('refiYear', 'Refi at end of year', s.refiYear, { hint: 'yr' })}
        ${input('afterRepairValue', 'ARV (appraised value)', s.afterRepairValue, { fmt: 'usd' })}
        ${input('refiLTV', 'New loan LTV', s.refiLTV, { fmt: 'pct' })}
        ${input('refiRate', 'New rate', s.refiRate, { fmt: 'pct' })}
        ${input('refiTermYears', 'New term', s.refiTermYears, { hint: 'yr' })}
        ${input('refiClosingCostPct', 'Refi closing costs', s.refiClosingCostPct, { fmt: 'pct' })}
        ${input('refiMinDSCR', 'Lender min DSCR', s.refiMinDSCR, { hint: 'ratio', step: '0.01' })}
      </div>
    </div>
  `;
}

function renderMFInputs(s) {
  return `
    ${section('Acquisition', `
      ${input('purchasePrice', 'Purchase price', s.purchasePrice, { fmt: 'usd' })}
      ${input('closingCostPct', 'Closing costs', s.closingCostPct, { fmt: 'pct' })}
      ${input('ltv', 'Loan-to-value', s.ltv, { fmt: 'pct' })}
      ${input('initialCapReserve', 'Initial cap reserve', s.initialCapReserve, { fmt: 'usd' })}
      ${input('landPct', 'Land allocation', s.landPct, { fmt: 'pct' })}
    `)}
    <div class="form-section">
      <h3 class="section-title">Rent roll &amp; unit mix</h3>
      <div id="unit-mix">
        <div class="unit-row header">
          <div>Unit type</div><div>Count</div><div>In-place $/mo</div><div>Pro-forma $/mo</div><div></div>
        </div>
        ${s.unitMix.map((u, idx) => `
          <div class="unit-row" data-idx="${idx}">
            <input class="field-input unit-field" data-key="type" type="text" value="${u.type}" />
            <input class="field-input unit-field" data-key="count" type="number" min="0" value="${u.count}" />
            <input class="field-input unit-field" data-key="inPlaceRent" type="number" min="0" value="${u.inPlaceRent}" />
            <input class="field-input unit-field" data-key="proFormaRent" type="number" min="0" value="${u.proFormaRent}" />
            <button class="icon-btn" data-action="remove-unit" data-idx="${idx}" title="Remove">×</button>
          </div>
        `).join('')}
      </div>
      <button class="btn" id="add-unit-row" style="margin-top:8px">+ Add unit type</button>
    </div>
    ${section('Revenue adjustments', `
      ${input('vacancyPct', 'Base vacancy', s.vacancyPct, { fmt: 'pct' })}
      ${input('lossToLeasePct', 'Loss-to-lease', s.lossToLeasePct, { fmt: 'pct' })}
      ${input('concessionsPct', 'Concessions', s.concessionsPct, { fmt: 'pct' })}
      ${input('nonRevenuePct', 'Non-revenue / model units', s.nonRevenuePct, { fmt: 'pct' })}
      ${input('otherIncomePerUnitAnnual', 'Other income per unit', s.otherIncomePerUnitAnnual, { fmt: 'usd', hint: '$/unit/yr' })}
    `)}
    ${section('Operating expenses', `
      ${input('propertyTaxYr', 'Property tax (annual)', s.propertyTaxYr, { fmt: 'usd' })}
      ${input('insuranceYr', 'Insurance (annual)', s.insuranceYr, { fmt: 'usd' })}
      ${input('opexPerUnitYr', 'OpEx', s.opexPerUnitYr, { fmt: 'usd', hint: '$/unit/yr' })}
      ${input('replacementReservePerUnitYr', 'Replacement reserve', s.replacementReservePerUnitYr, { fmt: 'usd', hint: '$/unit/yr' })}
      ${input('mgmtPct', 'Property management', s.mgmtPct, { fmt: 'pct', hint: '% of EGI' })}
      ${input('amFeePct', 'Asset management', s.amFeePct, { fmt: 'pct', hint: '% of EGI' })}
    `)}
    ${section('Value-add CapEx', `
      ${input('renoCostPerUnit', 'Reno cost per unit', s.renoCostPerUnit, { fmt: 'usd' })}
      ${input('renoContingency', 'Contingency', s.renoContingency, { fmt: 'pct' })}
      ${input('constructionMgmtFeePct', 'Construction mgmt fee', s.constructionMgmtFeePct, { fmt: 'pct' })}
      ${input('unitsRenovatedPerMonth', 'Units renovated / month', s.unitsRenovatedPerMonth, { hint: 'units' })}
      ${input('renoMonthsPerUnit', 'Months per unit reno', s.renoMonthsPerUnit, { hint: 'mo' })}
    `)}
    <div class="form-section">
      <h3 class="section-title">Debt</h3>
      <div class="form-grid" style="margin-bottom:8px">
        <div class="field">
          <label class="field-label">Rate mode</label>
          <select class="field-input" id="i_rateMode" name="rateMode">
            <option value="floating" ${s.rateMode === 'floating' ? 'selected' : ''}>Floating SOFR + spread</option>
            <option value="fixed" ${s.rateMode === 'fixed' ? 'selected' : ''}>Fixed rate</option>
          </select>
        </div>
        ${input('amortYears', 'Amortization', s.amortYears, { hint: 'yr' })}
        ${input('ioYears', 'Interest-only period', s.ioYears, { hint: 'yr' })}
      </div>
      <div class="form-grid" id="floating-fields" style="${s.rateMode === 'floating' ? '' : 'display:none'}">
        ${input('sofrInitial', 'SOFR (initial)', s.sofrInitial, { fmt: 'pct' })}
        ${input('spread', 'Spread over SOFR', s.spread, { fmt: 'pct' })}
        ${input('capStrike', 'Rate cap strike (SOFR)', s.capStrike, { fmt: 'pct' })}
        ${input('rateCapYears', 'Cap term', s.rateCapYears, { hint: 'yr' })}
        ${input('rateCapCost', 'Rate cap cost', s.rateCapCost, { fmt: 'usd' })}
      </div>
      <div class="form-grid" id="fixed-fields" style="${s.rateMode === 'fixed' ? '' : 'display:none'}">
        ${input('fixedRate', 'Fixed rate', s.fixedRate, { fmt: 'pct' })}
      </div>
    </div>
    ${section('Growth & exit', `
      ${input('rentGrowth', 'Rent growth', s.rentGrowth, { fmt: 'pct' })}
      ${input('expenseGrowth', 'Expense growth', s.expenseGrowth, { fmt: 'pct' })}
      ${input('exitCapRate', 'Exit cap rate', s.exitCapRate, { fmt: 'pct' })}
      ${input('saleCostPct', 'Sale costs', s.saleCostPct, { fmt: 'pct' })}
    `)}
    ${section('Tax', `
      ${input('ordinaryTaxRate', 'Ordinary income rate', s.ordinaryTaxRate, { fmt: 'pct' })}
      ${input('ltcgRate', 'Long-term cap-gains rate', s.ltcgRate, { fmt: 'pct' })}
    `)}
  `;
}

// === PRO FORMA ===
export function renderProForma(state) {
  const c = compute(state);
  const r = c.result;
  const yrs = r.years;
  const isMF = c.kind === 'mf';
  const pre = state.proFormaView === 'pre';

  const rows = [];
  if (isMF) {
    rows.push({ section: 'Revenue' });
    rows.push({ label: 'Gross potential rent', vals: yrs.map((y) => y.gpr) });
    rows.push({ label: 'Less: loss-to-lease', vals: yrs.map((y) => -y.lossToLease) });
    rows.push({ label: 'Less: concessions', vals: yrs.map((y) => -y.concessions) });
    rows.push({ label: 'Less: non-revenue', vals: yrs.map((y) => -y.nonRevenue) });
    rows.push({ label: 'Less: base vacancy', vals: yrs.map((y) => -y.baseVacancy) });
    rows.push({ label: 'Less: reno vacancy', vals: yrs.map((y) => -y.renoVacancy) });
    rows.push({ label: 'Plus: other income', vals: yrs.map((y) => y.otherIncome) });
    rows.push({ label: 'Effective gross income', vals: yrs.map((y) => y.egi), total: true });
    rows.push({ section: 'Operating expenses' });
    rows.push({ label: 'Property tax', vals: yrs.map((y) => -y.taxes) });
    rows.push({ label: 'Insurance', vals: yrs.map((y) => -y.insurance) });
    rows.push({ label: 'OpEx (per-unit)', vals: yrs.map((y) => -y.opexFixed) });
    rows.push({ label: 'Management', vals: yrs.map((y) => -y.mgmt) });
    rows.push({ label: 'Asset management', vals: yrs.map((y) => -y.amFee) });
    rows.push({ label: 'Replacement reserve', vals: yrs.map((y) => -y.replacementReserve) });
    rows.push({ label: 'Total OpEx', vals: yrs.map((y) => -y.opex), total: true });
    rows.push({ section: 'Net operating income' });
    rows.push({ label: 'NOI', vals: yrs.map((y) => y.noi), total: true });
    rows.push({ section: 'Debt service' });
    rows.push({ label: 'Interest', vals: yrs.map((y) => -y.interest) });
    rows.push({ label: 'Principal', vals: yrs.map((y) => -y.principalPaid) });
    rows.push({ label: 'Debt service', vals: yrs.map((y) => -y.debtService), total: true });
    rows.push({ label: 'Reno CapEx', vals: yrs.map((y) => -y.renoCapEx) });
    rows.push({ label: 'Cash flow before tax', vals: yrs.map((y) => y.cfBeforeTax), total: true, emphasized: true });
    if (!pre) {
      rows.push({ section: 'Tax' });
      rows.push({ label: 'Depreciation', vals: yrs.map((y) => -y.depreciation) });
      rows.push({ label: 'Taxable income', vals: yrs.map((y) => y.taxableIncome) });
      rows.push({ label: 'Income tax', vals: yrs.map((y) => -y.incomeTax) });
      rows.push({ label: 'Cash flow after tax', vals: yrs.map((y) => y.cfAfterTax), total: true, emphasized: true });
    }
  } else {
    rows.push({ section: 'Revenue' });
    rows.push({ label: 'Gross potential rent', vals: yrs.map((y) => y.gpr) });
    rows.push({ label: 'Less: vacancy', vals: yrs.map((y) => -y.vacancy) });
    rows.push({ label: 'Plus: other income', vals: yrs.map((y) => y.otherIncome) });
    rows.push({ label: 'Effective gross income', vals: yrs.map((y) => y.egi), total: true });
    rows.push({ section: 'Operating expenses' });
    rows.push({ label: 'Property tax', vals: yrs.map((y) => -y.tax) });
    rows.push({ label: 'Insurance', vals: yrs.map((y) => -y.insurance) });
    rows.push({ label: 'Management', vals: yrs.map((y) => -y.mgmt) });
    rows.push({ label: 'Maintenance', vals: yrs.map((y) => -y.maintenance) });
    rows.push({ label: 'CapEx reserve', vals: yrs.map((y) => -y.capex) });
    rows.push({ label: 'Total OpEx', vals: yrs.map((y) => -y.opex), total: true });
    rows.push({ section: 'Net operating income' });
    rows.push({ label: 'NOI', vals: yrs.map((y) => y.noi), total: true });
    rows.push({ section: 'Debt service' });
    rows.push({ label: 'Interest', vals: yrs.map((y) => -y.interest) });
    rows.push({ label: 'Principal', vals: yrs.map((y) => -y.principalPaid) });
    rows.push({ label: 'Debt service', vals: yrs.map((y) => -y.debtService), total: true });
    if (r.refiMetrics) {
      rows.push({ label: 'Refi cash-out', vals: yrs.map((y) => y.cashOutEvent || 0) });
    }
    rows.push({ label: 'Cash flow before tax', vals: yrs.map((y) => y.cfBeforeTax), total: true, emphasized: true });
    if (!pre) {
      rows.push({ section: 'Tax' });
      rows.push({ label: 'Depreciation', vals: yrs.map((y) => -y.depreciation) });
      rows.push({ label: 'Taxable income', vals: yrs.map((y) => y.taxableIncome) });
      rows.push({ label: 'Income tax', vals: yrs.map((y) => -y.incomeTax) });
      rows.push({ label: 'Cash flow after tax', vals: yrs.map((y) => y.cfAfterTax), total: true, emphasized: true });
    }
  }

  const headers = ['Line item', ...yrs.map((y) => 'Y' + y.year)];
  const tableHTML = `
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((row) => {
            if (row.section) {
              return `<tr class="section-row"><td colspan="${headers.length}">${row.section}</td></tr>`;
            }
            const cls = row.total ? 'total' : '';
            return `<tr class="${cls}">
              <td>${row.label}</td>
              ${row.vals.map((v) => {
                const negCls = v < 0 && !row.total ? 'neg' : '';
                return `<td class="${negCls}">${fmt.usd(v)}</td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  return `
    <div class="card">
      <div class="card-title">
        Pro forma
        <div class="row-flex">
          <label class="toggle">
            <input type="checkbox" id="proforma-toggle" ${pre ? '' : 'checked'} />
            <span class="switch"></span>
            <span class="toggle-label">${pre ? 'Pre-tax' : 'After-tax'}</span>
          </label>
        </div>
      </div>
      ${tableHTML}
    </div>
    <div class="card">
      <div class="card-title">${pre ? 'Pre-tax cash flow' : 'After-tax cash flow'}</div>
      <div class="chart-box"><canvas class="chart" id="chart-pf" height="220"></canvas></div>
    </div>
  `;
}

// === WATERFALL (multifamily only) ===
export function renderWaterfall(state) {
  if (state.mode !== 'mf') {
    return `<div class="card"><div class="card-title">Waterfall</div>
      <p class="muted">The waterfall view is only available in multifamily mode. Switch modes in the header.</p>
    </div>`;
  }
  const c = compute(state);
  const r = c.result;
  const w = c.waterfall;
  const wInputs = state.mf.waterfall;

  const headers = ['', ...r.years.map((y) => 'Y' + y.year)];
  // Build LP / GP distribution rows
  const distRows = w.rows.slice(1); // skip year 0
  const lpDist = distRows.map((d) => d.lpTotal);
  const gpDist = distRows.map((d) => d.gpTotal);
  const prefAcc = distRows.map((d) => d.prefAccrued);
  const lpPrefPaid = distRows.map((d) => d.lpPref);
  const lpROC = distRows.map((d) => d.lpROC);
  const tier1LP = distRows.map((d) => d.tier1LP);
  const tier1GP = distRows.map((d) => d.tier1GP);
  const tier2LP = distRows.map((d) => d.tier2LP);
  const tier2GP = distRows.map((d) => d.tier2GP);

  return `
    <div class="card">
      <div class="card-title">Waterfall structure <span class="meta">European</span></div>
      <div class="form-grid">
        ${input('lpShare', 'LP equity share', wInputs.lpShare, { fmt: 'pct' })}
        <div class="field">
          <label class="field-label">Total equity</label>
          <input class="field-input" type="text" disabled value="${fmt.usd(r.totalCashIn)}" />
        </div>
        ${input('prefRate', 'Preferred return', wInputs.prefRate, { fmt: 'pct' })}
        ${input('tier1LP', 'Tier-1 LP split', wInputs.tier1LP, { fmt: 'pct' })}
        ${input('tier1GP', 'Tier-1 GP split (promote)', wInputs.tier1GP, { fmt: 'pct' })}
        ${input('tier2Hurdle', 'Tier-2 IRR hurdle', wInputs.tier2Hurdle, { fmt: 'pct' })}
        ${input('tier2LP', 'Tier-2 LP split', wInputs.tier2LP, { fmt: 'pct' })}
        ${input('tier2GP', 'Tier-2 GP split (promote)', wInputs.tier2GP, { fmt: 'pct' })}
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiTile({ label: 'LP IRR', value: fmt.pct(w.lpIRR), sub: w.lpCleared ? 'Cleared pref' : 'Did NOT clear pref', cls: w.lpCleared ? '' : 'negative' })}
      ${kpiTile({ label: 'GP IRR', value: fmt.pct(w.gpIRR), sub: 'Carry + co-invest' })}
      ${kpiTile({ label: 'LP equity multiple', value: fmt.ratio(w.lpEquityMultiple) })}
      ${kpiTile({ label: 'GP equity multiple', value: fmt.ratio(w.gpEquityMultiple) })}
    </div>

    <div class="card">
      <div class="card-title">Year-by-year distributions</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>
            <tr class="section-row"><td colspan="${headers.length}">Pref &amp; capital</td></tr>
            <tr><td>Pref accrued</td>${prefAcc.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr><td>LP pref paid</td>${lpPrefPaid.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr><td>LP return of capital</td>${lpROC.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr class="section-row"><td colspan="${headers.length}">Tier 1 (below ${fmt.pct(wInputs.tier2Hurdle)} hurdle)</td></tr>
            <tr><td>LP tier-1 split</td>${tier1LP.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr><td>GP tier-1 promote</td>${tier1GP.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr class="section-row"><td colspan="${headers.length}">Tier 2 (above ${fmt.pct(wInputs.tier2Hurdle)} hurdle)</td></tr>
            <tr><td>LP tier-2 split</td>${tier2LP.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr><td>GP tier-2 promote</td>${tier2GP.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr class="total"><td>LP total distribution</td>${lpDist.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
            <tr class="total"><td>GP total distribution</td>${gpDist.map((v) => `<td>${fmt.usd(v)}</td>`).join('')}</tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">LP vs GP cumulative</div>
      <div class="chart-box"><canvas class="chart" id="chart-wf" height="220"></canvas></div>
    </div>
  `;
}

// === SENSITIVITY ===
export function renderSensitivity(state) {
  const c = compute(state);
  const r = c.result;
  const isMF = c.kind === 'mf';

  // Build rent-by-price grid of Y1 CFbT
  let basePrice, baseRent, priceVar, rentVar;
  if (isMF) {
    basePrice = state.mf.purchasePrice;
    baseRent = 1; // we vary "rent multiplier"
  } else {
    basePrice = state.sf.purchasePrice;
    baseRent = state.sf.grossMonthlyRent;
  }
  const priceSteps = [-0.10, -0.05, 0, 0.05, 0.10];
  const rentSteps = [-0.10, -0.05, 0, 0.05, 0.10];

  const data = [];
  const rowLabels = rentSteps.map((s) => (s >= 0 ? '+' : '') + (s * 100).toFixed(0) + '% rent');
  const colLabels = priceSteps.map((s) => (s >= 0 ? '+' : '') + (s * 100).toFixed(0) + '% price');

  for (const rs of rentSteps) {
    const row = [];
    for (const ps of priceSteps) {
      let cf;
      if (isMF) {
        const inputs = structuredClone(state.mf);
        inputs.purchasePrice = basePrice * (1 + ps);
        inputs.unitMix = inputs.unitMix.map((u) => ({
          ...u,
          inPlaceRent: u.inPlaceRent * (1 + rs),
          proFormaRent: u.proFormaRent * (1 + rs),
        }));
        cf = runMultifamily(inputs).years[0].cfBeforeTax;
      } else {
        const inputs = structuredClone(state.sf);
        inputs.purchasePrice = basePrice * (1 + ps);
        inputs.grossMonthlyRent = baseRent * (1 + rs);
        cf = runSingleFamily(inputs).years[0].cfBeforeTax;
      }
      row.push(cf);
    }
    data.push(row);
  }

  // DSCR vs interest-rate chart
  const initialRate = isMF
    ? (state.mf.rateMode === 'floating' ? state.mf.sofrInitial + state.mf.spread : state.mf.fixedRate)
    : state.sf.rate;
  const rateOffsets = Array.from({ length: 13 }, (_, i) => -0.02 + i * 0.0050);
  const dscrSeries = rateOffsets.map((dr) => {
    const newRate = Math.max(0.01, initialRate + dr);
    let pmt, noi, loan, term;
    if (isMF) {
      loan = state.mf.purchasePrice * state.mf.ltv;
      term = state.mf.amortYears * 12;
      noi = r.inPlaceNOI;
      pmt = mortgagePayment(loan, newRate, term) * 12;
    } else {
      loan = state.sf.purchasePrice * (1 - state.sf.downPct);
      term = state.sf.termYears * 12;
      noi = r.years[0].noi;
      pmt = mortgagePayment(loan, newRate, term) * 12;
    }
    return { rate: newRate, dscr: noi / pmt };
  });

  return `
    <div class="card">
      <div class="card-title">Year-1 cash flow — rent × price stress</div>
      <div id="sens-heatmap"></div>
      <p class="small muted" style="margin-top:10px">Green = surplus, red = deficit. Center cell = base case.</p>
    </div>

    <div class="kpi-grid">
      ${kpiTile({ label: 'Break-even occupancy', value: fmt.pct(isMF ? r.breakEvenOcc : r.breakEvenOcc), sub: '(OpEx + debt) ÷ PGI' })}
      ${kpiTile({ label: '+200 bps stress DSCR', value: (isMF ? r.stressDSCR : (r.years[0].noi / (mortgagePayment(r.loanAmount, state.sf.rate + 0.02, state.sf.termYears * 12) * 12))).toFixed(2), cls: (isMF ? r.stressDSCR : 99) >= 1.0 ? '' : 'negative', sub: 'On NOI' })}
      ${kpiTile({ label: '1% rule (SF) / Rent gap (MF)', value: isMF ? fmt.pct((r.rentRoll.annualProFormaRent / r.rentRoll.annualInPlaceRent) - 1, 1) : fmt.pct(r.onePctRatio, 2) })}
      ${kpiTile({ label: 'GRM', value: isMF ? (r.inputs.purchasePrice / r.rentRoll.annualInPlaceRent).toFixed(1) + 'x' : r.grm.toFixed(1) + 'x' })}
    </div>

    <div class="card">
      <div class="card-title">DSCR vs interest rate</div>
      <div class="chart-box"><canvas class="chart" id="chart-dscr" height="200"></canvas></div>
      <div class="chart-legend">
        <span><span class="dot" style="background:${colors.gold}"></span>DSCR at varied rate</span>
        <span><span class="dot" style="background:${colors.red}"></span>1.20 lender threshold</span>
      </div>
    </div>
  `;
}

// === SAVED DEALS ===
export function renderSaved(state) {
  if (!state.savedDeals || state.savedDeals.length === 0) {
    return `<div class="card">
      <div class="card-title">Saved deals</div>
      <p class="muted">No deals saved yet. Save the current underwriting from the header.</p>
    </div>`;
  }
  return `
    <div class="card">
      <div class="card-title">Saved deals <span class="meta">${state.savedDeals.length} stored locally</span></div>
      <div class="saved-list">
        ${state.savedDeals.map((d) => {
          // compute quick stats from snapshot
          let stats = '';
          try {
            if (d.mode === 'sf') {
              const r = runSingleFamily(d.inputs);
              stats = `${fmt.pct(r.capRate)} cap · ${r.dscr.toFixed(2)} DSCR · ${fmt.pct(r.irrAfterTax)} AT IRR`;
            } else {
              const r = runMultifamily(d.inputs);
              stats = `${fmt.pct(r.goingInCap)} cap · ${r.dscr.toFixed(2)} DSCR · ${fmt.pct(r.irrAfterTax)} AT IRR`;
            }
          } catch (e) { stats = 'compute error'; }
          const dt = new Date(d.savedAt);
          return `
            <div class="saved-item" data-id="${d.id}">
              <div class="body">
                <div class="title">${escapeHTML(d.name)}</div>
                <div class="meta">${d.mode === 'sf' ? 'Single-family' : 'Multifamily'} · ${dt.toLocaleString()}</div>
                <div class="stats">${stats}</div>
              </div>
              <button class="btn" data-action="load-deal" data-id="${d.id}">Load</button>
              <button class="btn danger" data-action="delete-deal" data-id="${d.id}">Delete</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// === post-render chart drawing ===
export function drawCharts(state, view) {
  const c = compute(state);
  const r = c.result;
  const isMF = c.kind === 'mf';

  if (view === 'dashboard') {
    const cfCanvas = document.getElementById('chart-cf');
    if (cfCanvas) {
      const labels = r.years.map((y) => 'Y' + y.year);
      const values = r.years.map((y) => state.proFormaView === 'pre' ? y.cfBeforeTax : y.cfAfterTax);
      drawBarChart(cfCanvas, { labels, values });
    }
    const noiCanvas = document.getElementById('chart-noi');
    if (noiCanvas) {
      const labels = r.years.map((y) => 'Y' + y.year);
      const noiSeries = { name: 'NOI', color: colors.gold, values: r.years.map((y) => y.noi) };
      const dsSeries = { name: 'Debt service', color: colors.red, values: r.years.map((y) => y.debtService) };
      drawLineChart(noiCanvas, { labels, series: [noiSeries, dsSeries] });
    }
  }
  if (view === 'proforma') {
    const c2 = document.getElementById('chart-pf');
    if (c2) {
      const labels = r.years.map((y) => 'Y' + y.year);
      const values = r.years.map((y) => state.proFormaView === 'pre' ? y.cfBeforeTax : y.cfAfterTax);
      drawBarChart(c2, { labels, values });
    }
  }
  if (view === 'waterfall' && c.kind === 'mf') {
    const w = c.waterfall;
    const labels = ['Y0', ...r.years.map((y) => 'Y' + y.year)];
    let lpCum = 0, gpCum = 0;
    const lpVals = w.lpCF.map((v) => (lpCum += v));
    gpCum = 0;
    const gpVals = w.gpCF.map((v) => (gpCum += v));
    const c2 = document.getElementById('chart-wf');
    if (c2) {
      drawLineChart(c2, {
        labels,
        series: [
          { name: 'LP cumulative', color: colors.gold, values: lpVals },
          { name: 'GP cumulative', color: colors.blue, values: gpVals },
        ],
        fillFirst: false,
      });
    }
  }
  if (view === 'sensitivity') {
    // Heatmap
    const heatParent = document.getElementById('sens-heatmap');
    if (heatParent) {
      const basePrice = isMF ? state.mf.purchasePrice : state.sf.purchasePrice;
      const baseRent = isMF ? 1 : state.sf.grossMonthlyRent;
      const priceSteps = [-0.10, -0.05, 0, 0.05, 0.10];
      const rentSteps = [-0.10, -0.05, 0, 0.05, 0.10];
      const data = [];
      const rowLabels = rentSteps.map((s) => (s >= 0 ? '+' : '') + (s * 100).toFixed(0) + '%');
      const colLabels = priceSteps.map((s) => (s >= 0 ? '+' : '') + (s * 100).toFixed(0) + '%');
      for (const rs of rentSteps) {
        const row = [];
        for (const ps of priceSteps) {
          let cf;
          if (isMF) {
            const inputs = structuredClone(state.mf);
            inputs.purchasePrice = basePrice * (1 + ps);
            inputs.unitMix = inputs.unitMix.map((u) => ({
              ...u,
              inPlaceRent: u.inPlaceRent * (1 + rs),
              proFormaRent: u.proFormaRent * (1 + rs),
            }));
            cf = runMultifamily(inputs).years[0].cfBeforeTax;
          } else {
            const inputs = structuredClone(state.sf);
            inputs.purchasePrice = basePrice * (1 + ps);
            inputs.grossMonthlyRent = baseRent * (1 + rs);
            cf = runSingleFamily(inputs).years[0].cfBeforeTax;
          }
          row.push(cf);
        }
        data.push(row);
      }
      drawHeatmap(heatParent, { data, rowLabels, colLabels, fmtFn: fmt.usdK, centerAtZero: true });
    }

    // DSCR vs rate chart
    const dscrCanvas = document.getElementById('chart-dscr');
    if (dscrCanvas) {
      const initialRate = isMF
        ? (state.mf.rateMode === 'floating' ? state.mf.sofrInitial + state.mf.spread : state.mf.fixedRate)
        : state.sf.rate;
      const rateOffsets = Array.from({ length: 13 }, (_, i) => -0.02 + i * 0.0050);
      const dscrVals = rateOffsets.map((dr) => {
        const newRate = Math.max(0.01, initialRate + dr);
        let pmt, noi, loan, term;
        if (isMF) {
          loan = state.mf.purchasePrice * state.mf.ltv;
          term = state.mf.amortYears * 12;
          noi = r.inPlaceNOI;
        } else {
          loan = state.sf.purchasePrice * (1 - state.sf.downPct);
          term = state.sf.termYears * 12;
          noi = r.years[0].noi;
        }
        pmt = mortgagePayment(loan, newRate, term) * 12;
        return noi / pmt;
      });
      const labels = rateOffsets.map((dr) => fmt.pct(initialRate + dr, 1));
      drawLineChart(dscrCanvas, {
        labels,
        series: [
          { name: 'DSCR', color: colors.gold, values: dscrVals },
          { name: 'Threshold 1.20', color: colors.red, values: Array(labels.length).fill(1.20) },
        ],
        yFormat: (v) => v.toFixed(2),
        fillFirst: false,
      });
    }
  }
}
