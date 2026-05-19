// Reference-case verification.
// Run: node tests/verify.js
import {
  mortgagePayment, loanBalance, amortizationSchedule,
  npv, irr, equityMultiple,
  runSingleFamily, runMultifamily, runWaterfall,
} from '../js/finance.js';

const fmt = {
  pct: (x, d = 2) => (x * 100).toFixed(d) + '%',
  usd: (x) => '$' + x.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
  num: (x, d = 4) => x.toFixed(d),
};

let pass = 0, fail = 0;
function check(name, actual, expected, tol = 0.01, formatter = String) {
  const ok = Math.abs(actual - expected) <= tol;
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`  [${status}] ${name}: actual=${formatter(actual)}, expected=${formatter(expected)}, tol=${tol}`);
  return ok;
}

console.log('\n========================================');
console.log('UnderWrite Pro — Calculation Verification');
console.log('========================================\n');

// --- Mortgage primitives ---
console.log('1. Mortgage primitives');
const pmt = mortgagePayment(187500, 0.07, 360);
check('Monthly P&I on $187,500 @ 7% 30yr', pmt, 1247.40, 0.10, x => '$' + x.toFixed(2));
const bal10 = loanBalance(187500, 0.07, 360, 120);
check('Balance after 10yr', bal10, 160928, 200, fmt.usd);

// --- IRR ---
console.log('\n2. IRR (Newton-Raphson)');
check('IRR of [-100, 110] is 10%', irr([-100, 110]), 0.10, 0.0001, x => fmt.pct(x, 4));
// Cross-check NPV at the computed IRR is zero.
const irrA = irr([-100, 20, 30, 40, 50, 60]);
check('NPV at computed IRR ≈ 0', npv(irrA, [-100, 20, 30, 40, 50, 60]), 0, 1e-6, x => x.toExponential(2));
console.log(`  Computed IRR for [-100,20..60]: ${fmt.pct(irrA, 4)}`);
const irrB = irr([-1000, 100, 200, 300, 400, 500]);
check('NPV at computed IRR ≈ 0', npv(irrB, [-1000, 100, 200, 300, 400, 500]), 0, 1e-6, x => x.toExponential(2));
console.log(`  Computed IRR for [-1000,100..500]: ${fmt.pct(irrB, 4)}`);

// --- SF Base Case ---
console.log('\n3. Single-family base case');
const sfBase = {
  purchasePrice: 250000,
  downPct: 0.25,
  closingCostPct: 0.025,
  rehabBudget: 0,
  landPct: 0.20,
  rate: 0.07,
  termYears: 30,
  grossMonthlyRent: 2200,
  otherIncomeAnnual: 0,
  vacancyPct: 0.05,
  propertyTax: 3200,
  insurance: 1400,
  mgmtPct: 0.08,
  maintenancePct: 0.05,
  capexPct: 0.05,
  rentGrowth: 0.03,
  expenseGrowth: 0.02,
  exitCapRate: 0.0675,
  saleCostPct: 0.06,
  ordinaryTaxRate: 0.37,
  ltcgRate: 0.20,
  refiEnabled: false,
};
const sf = runSingleFamily(sfBase);
check('Year-1 NOI', sf.years[0].noi, 15833.60, 5, fmt.usd);
check('Cap rate', sf.capRate, 0.0633, 0.0005, x => fmt.pct(x, 2));
check('Year-1 DSCR', sf.dscr, 1.06, 0.01, x => x.toFixed(3));
check('Year-1 monthly cash flow', sf.monthlyCF, 72, 5, x => '$' + x.toFixed(2));
check('Annual depreciation', sf.annualDepreciation, 7272.73, 1, fmt.usd);
check('Year-1 taxable income (paper loss)', sf.years[0].taxableIncome, -4482, 50, fmt.usd);
console.log(`  Year-1 after-tax cash flow: ${fmt.usd(sf.years[0].cfAfterTax)} (positive due to passive loss shelter)`);

console.log(`  10-yr after-tax IRR: ${fmt.pct(sf.irrAfterTax, 2)}`);
console.log(`  10-yr pre-tax IRR:   ${fmt.pct(sf.irrPreTax, 2)}`);
console.log(`  Equity multiple (AT): ${sf.equityMultipleAfter.toFixed(2)}x`);
check('10-yr after-tax IRR ~9.9%', sf.irrAfterTax, 0.099, 0.015, x => fmt.pct(x, 2));

// --- Multifamily Value-Add Case ---
console.log('\n4. Multifamily value-add case (~$13.85M, 118 units)');
// Build a 118-unit mix. Typical garden-style value-add:
// 30x 1BR @ $1,100 in-place / $1,400 PF
// 70x 2BR @ $1,350 in-place / $1,700 PF
// 18x 3BR @ $1,650 in-place / $2,000 PF
const mfBase = {
  purchasePrice: 13_850_000,
  closingCostPct: 0.02,
  ltv: 0.70,
  unitMix: [
    { type: '1BR', count: 30, inPlaceRent: 1100, proFormaRent: 1550 },
    { type: '2BR', count: 70, inPlaceRent: 1350, proFormaRent: 1850 },
    { type: '3BR', count: 18, inPlaceRent: 1650, proFormaRent: 2200 },
  ],
  vacancyPct: 0.05,
  lossToLeasePct: 0.02,
  concessionsPct: 0.01,
  nonRevenuePct: 0.01,
  otherIncomePerUnitAnnual: 600,
  propertyTaxYr: 200_000,
  insuranceYr: 80_000,
  opexPerUnitYr: 3700,
  replacementReservePerUnitYr: 250,
  mgmtPct: 0.03,
  amFeePct: 0.01,
  rentGrowth: 0.03,
  expenseGrowth: 0.025,
  exitCapRate: 0.0525,
  saleCostPct: 0.015,
  landPct: 0.15,
  ordinaryTaxRate: 0.37,
  ltcgRate: 0.20,
  // Value-add
  renoCostPerUnit: 12_000,
  renoContingency: 0.10,
  constructionMgmtFeePct: 0.03,
  unitsRenovatedPerMonth: 5,
  renoMonthsPerUnit: 1,
  // Debt
  rateMode: 'floating',
  sofrInitial: 0.045,
  sofrCurve: [0.045, 0.045, 0.040, 0.038, 0.035, 0.035, 0.035, 0.035, 0.035, 0.035],
  spread: 0.030,
  fixedRate: 0.075,
  amortYears: 30,
  ioYears: 3,
  capStrike: 0.04,
  rateCapYears: 3,
  rateCapCost: 150_000,
};
const mf = runMultifamily(mfBase);
console.log(`  Total units: ${mf.rentRoll.totalUnits}`);
console.log(`  Annual in-place rent: ${fmt.usd(mf.rentRoll.annualInPlaceRent)}`);
console.log(`  Annual pro-forma rent: ${fmt.usd(mf.rentRoll.annualProFormaRent)}`);
console.log(`  In-place stabilized NOI: ${fmt.usd(mf.inPlaceNOI)}`);
console.log(`  Y1 NOI (with reno disruption): ${fmt.usd(mf.years[0].noi)}`);
console.log(`  Going-in cap: ${fmt.pct(mf.goingInCap, 2)}`);
console.log(`  Qualifying DSCR (in-place NOI / amortizing P+I): ${mf.dscr.toFixed(3)}`);
console.log(`  Y1 cash DSCR (actual): ${mf.cashDSCR.toFixed(3)}`);
console.log(`  Y2 DSCR: ${mf.y2dscr ? mf.y2dscr.toFixed(3) : 'n/a'}`);
console.log(`  Total reno cost: ${fmt.usd(mf.totalRenoCost)}`);
console.log(`  Total cash in: ${fmt.usd(mf.totalCashIn)}`);
console.log(`  Sale value (Y10): ${fmt.usd(mf.saleValue)}`);
console.log(`  10-yr pre-tax IRR:  ${fmt.pct(mf.irrPreTax, 2)}`);
console.log(`  10-yr after-tax IRR:${fmt.pct(mf.irrAfterTax, 2)}`);
console.log(`  Project equity multiple (AT): ${mf.equityMultipleAfter.toFixed(2)}x`);
check('Going-in cap ~7.0%', mf.goingInCap, 0.070, 0.005, x => fmt.pct(x, 2));
check('Y1 DSCR ~1.20', mf.dscr, 1.20, 0.10, x => x.toFixed(3));
check('AT IRR ~22.7%', mf.irrAfterTax, 0.227, 0.03, x => fmt.pct(x, 2));

// --- Waterfall (European) ---
console.log('\n5. European LP/GP waterfall');
const wf = runWaterfall({
  projectCashflows: mf.cfPre,
  lpShare: 0.90,
  prefRate: 0.08,
  tier1Promote: { lp: 0.80, gp: 0.20 },
  tier2Hurdle: 0.15,
  tier2Promote: { lp: 0.70, gp: 0.30 },
});
console.log(`  LP IRR: ${fmt.pct(wf.lpIRR, 2)}`);
console.log(`  GP IRR: ${fmt.pct(wf.gpIRR, 2)}`);
console.log(`  LP eq multiple: ${wf.lpEquityMultiple.toFixed(2)}x`);
console.log(`  GP eq multiple: ${wf.gpEquityMultiple.toFixed(2)}x`);
console.log(`  LP cleared pref: ${wf.lpCleared}`);
check('LP IRR > 8% pref', wf.lpIRR > 0.08 ? 1 : 0, 1, 0, x => x ? 'YES' : 'NO');
check('LP IRR ~24.5%', wf.lpIRR, 0.245, 0.05, x => fmt.pct(x, 2));

console.log('\n========================================');
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log('========================================\n');

if (fail > 0) {
  console.log('Failing details to investigate above.');
  process.exit(1);
}
