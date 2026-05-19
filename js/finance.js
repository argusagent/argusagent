// UnderWrite Pro — financial calculation engine.
// Every formula is standard finance. See README/conventions doc for sources.

export const EPS = 1e-9;

// Mortgage payment for a fully-amortizing fixed-rate loan.
// principal: loan amount; annualRate: decimal (0.07 = 7%); termMonths: months.
export function mortgagePayment(principal, annualRate, termMonths) {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  if (r < EPS) return principal / termMonths;
  return principal * r * Math.pow(1 + r, termMonths) /
    (Math.pow(1 + r, termMonths) - 1);
}

// Remaining loan balance after `monthsPaid` months on a fixed amortizing loan.
export function loanBalance(principal, annualRate, termMonths, monthsPaid) {
  if (monthsPaid <= 0) return principal;
  if (monthsPaid >= termMonths) return 0;
  const r = annualRate / 12;
  if (r < EPS) return principal * (1 - monthsPaid / termMonths);
  const pmt = mortgagePayment(principal, annualRate, termMonths);
  const f = Math.pow(1 + r, monthsPaid);
  return principal * f - pmt * (f - 1) / r;
}

// Year-by-year amortization. Supports:
//   - interest-only period (ioMonths, payment is interest only, no principal paid)
//   - floating rate via per-year rates array (one entry per loan year, length >= years)
//   - rate cap: cap strike is on the all-in rate (already includes spread when caller
//     pre-applied it). The caller is responsible for capping the index before computing
//     the all-in rate if convention requires.
// After IO, the loan re-amortizes over the remaining term on the remaining balance.
// Returns an array of length `years`: [{interest, principal, payment, endingBalance}].
export function amortizationSchedule({
  principal, annualRate, termMonths, ioMonths = 0,
  years, ratesByYear = null,
}) {
  const out = [];
  let bal = principal;
  let totalMonths = years * 12;
  for (let y = 0; y < years; y++) {
    let yearInterest = 0;
    let yearPrincipal = 0;
    let yearPayment = 0;
    for (let m = 0; m < 12; m++) {
      const monthIndex = y * 12 + m;
      if (monthIndex >= totalMonths) break;
      let r = ratesByYear ? ratesByYear[Math.min(y, ratesByYear.length - 1)] : annualRate;
      const mr = r / 12;
      const inIO = monthIndex < ioMonths;
      let payment, interest, principalPaid;
      if (inIO) {
        interest = bal * mr;
        principalPaid = 0;
        payment = interest;
      } else {
        // Re-amortize remaining balance over remaining amortization term.
        const remainingTerm = termMonths - monthIndex;
        payment = mortgagePayment(bal, r, remainingTerm);
        interest = bal * mr;
        principalPaid = payment - interest;
        if (principalPaid > bal) { principalPaid = bal; payment = interest + principalPaid; }
        bal -= principalPaid;
      }
      yearInterest += interest;
      yearPrincipal += principalPaid;
      yearPayment += payment;
    }
    out.push({
      interest: yearInterest,
      principal: yearPrincipal,
      payment: yearPayment,
      endingBalance: bal,
    });
  }
  return out;
}

// Net Present Value of cash flows (index 0 = today).
export function npv(rate, cashflows) {
  let s = 0;
  for (let t = 0; t < cashflows.length; t++) {
    s += cashflows[t] / Math.pow(1 + rate, t);
  }
  return s;
}

// IRR via Newton-Raphson with bisection fallback.
// Returns null if no real IRR exists (e.g., all-positive or all-negative flows).
export function irr(cashflows, guess = 0.1) {
  if (!cashflows || cashflows.length < 2) return null;
  let hasPos = false, hasNeg = false;
  for (const cf of cashflows) {
    if (cf > 0) hasPos = true;
    if (cf < 0) hasNeg = true;
  }
  if (!hasPos || !hasNeg) return null;

  // Newton-Raphson
  let r = guess;
  for (let i = 0; i < 100; i++) {
    let f = 0, df = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const disc = Math.pow(1 + r, t);
      f += cashflows[t] / disc;
      if (t > 0) df += -t * cashflows[t] / (disc * (1 + r));
    }
    if (Math.abs(f) < 1e-9) return r;
    if (Math.abs(df) < 1e-12) break;
    const rNew = r - f / df;
    if (!isFinite(rNew) || rNew <= -0.999) break;
    if (Math.abs(rNew - r) < 1e-10) return rNew;
    r = rNew;
  }

  // Bisection fallback on [-0.999, 10]
  let lo = -0.999, hi = 10;
  let fLo = npv(lo, cashflows);
  let fHi = npv(hi, cashflows);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashflows);
    if (Math.abs(fMid) < 1e-9 || (hi - lo) < 1e-10) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

// Equity Multiple = sum(positive distributions) / sum(|negative contributions|).
export function equityMultiple(cashflows) {
  let dist = 0, contrib = 0;
  for (const cf of cashflows) {
    if (cf > 0) dist += cf;
    else contrib += -cf;
  }
  return contrib > 0 ? dist / contrib : 0;
}

// =====================
// Single-family / small rental engine
// =====================

// Build full SF pro forma given normalized inputs.
export function runSingleFamily(input) {
  const i = input;
  const closingCosts = i.purchasePrice * i.closingCostPct;
  const rehabCost = i.rehabBudget || 0;
  // Initial equity in the deal (cash invested up front).
  const downPayment = i.purchasePrice * i.downPct;
  const loanAmount = i.purchasePrice - downPayment;
  const totalCashIn = downPayment + closingCosts + rehabCost;

  // Pre-refi mortgage
  const acqPayment = mortgagePayment(loanAmount, i.rate, i.termYears * 12);
  const annualAcqDS = acqPayment * 12;

  // Acquisition amortization (10-year horizon at most)
  const acqAmort = amortizationSchedule({
    principal: loanAmount,
    annualRate: i.rate,
    termMonths: i.termYears * 12,
    years: 10,
  });

  // Optional refi at end of `refiYear` (BRRRR)
  let refiLoan = null;
  let refiAmort = null;
  let cashOut = 0;
  let arv = 0;
  let refiPayment = 0;
  if (i.refiEnabled) {
    arv = i.afterRepairValue || i.purchasePrice;
    const newLoan = arv * (i.refiLTV || 0.75);
    const balanceAtRefi = loanBalance(loanAmount, i.rate, i.termYears * 12, i.refiYear * 12);
    const refiClosing = arv * (i.refiClosingCostPct || 0.02);
    cashOut = newLoan - balanceAtRefi - refiClosing;
    refiLoan = newLoan;
    refiPayment = mortgagePayment(newLoan, i.refiRate, (i.refiTermYears || 30) * 12);
    refiAmort = amortizationSchedule({
      principal: newLoan,
      annualRate: i.rate, // overridden below
      termMonths: (i.refiTermYears || 30) * 12,
      years: 10 - i.refiYear,
      ratesByYear: Array(10).fill(i.refiRate),
    });
  }

  const years = [];
  const depreciableBasis = i.purchasePrice * (1 - i.landPct) + rehabCost * (1 - i.landPct);
  const annualDepreciation = depreciableBasis / 27.5;

  let accumDepreciation = 0;
  for (let y = 1; y <= 10; y++) {
    const growthYrs = y - 1;
    const gpr = i.grossMonthlyRent * 12 * Math.pow(1 + i.rentGrowth, growthYrs);
    const otherIncome = (i.otherIncomeAnnual || 0) * Math.pow(1 + i.rentGrowth, growthYrs);
    const vacancy = gpr * i.vacancyPct;
    const egi = gpr - vacancy + otherIncome;
    const tax = i.propertyTax * Math.pow(1 + i.expenseGrowth, growthYrs);
    const insurance = i.insurance * Math.pow(1 + i.expenseGrowth, growthYrs);
    const mgmt = i.mgmtPct * egi;
    const maintenance = i.maintenancePct * gpr;
    const capex = i.capexPct * gpr;
    const opex = tax + insurance + mgmt + maintenance + capex;
    const noi = egi - opex;

    let interest, principalPaid, debtService, endingBalance;
    if (i.refiEnabled && y > i.refiYear) {
      const rIdx = y - i.refiYear - 1;
      const row = refiAmort[rIdx];
      interest = row.interest;
      principalPaid = row.principal;
      debtService = row.payment;
      endingBalance = row.endingBalance;
    } else if (i.refiEnabled && y === i.refiYear) {
      // Pre-refi for the year, then refi happens at year end.
      const row = acqAmort[y - 1];
      interest = row.interest;
      principalPaid = row.principal;
      debtService = row.payment;
      endingBalance = refiLoan; // post-refi balance
    } else {
      const row = acqAmort[y - 1];
      interest = row.interest;
      principalPaid = row.principal;
      debtService = row.payment;
      endingBalance = row.endingBalance;
    }

    const cfBeforeTax = noi - debtService;
    const taxableIncome = noi - interest - annualDepreciation;
    accumDepreciation += annualDepreciation;
    const incomeTax = taxableIncome * i.ordinaryTaxRate;
    const cfAfterTax = cfBeforeTax - incomeTax;

    years.push({
      year: y,
      gpr, vacancy, otherIncome, egi,
      tax, insurance, mgmt, maintenance, capex, opex,
      noi, interest, principalPaid, debtService, endingBalance,
      depreciation: annualDepreciation, taxableIncome, incomeTax,
      cfBeforeTax, cfAfterTax,
      cashOutEvent: (i.refiEnabled && y === i.refiYear) ? cashOut : 0,
    });
  }

  // Year-11 forward NOI for exit valuation.
  const fwd = (() => {
    const gpr11 = i.grossMonthlyRent * 12 * Math.pow(1 + i.rentGrowth, 10);
    const other11 = (i.otherIncomeAnnual || 0) * Math.pow(1 + i.rentGrowth, 10);
    const vac11 = gpr11 * i.vacancyPct;
    const egi11 = gpr11 - vac11 + other11;
    const tax11 = i.propertyTax * Math.pow(1 + i.expenseGrowth, 10);
    const ins11 = i.insurance * Math.pow(1 + i.expenseGrowth, 10);
    const mgmt11 = i.mgmtPct * egi11;
    const maint11 = i.maintenancePct * gpr11;
    const capex11 = i.capexPct * gpr11;
    return egi11 - tax11 - ins11 - mgmt11 - maint11 - capex11;
  })();

  const saleValue = fwd / i.exitCapRate;
  const saleCosts = saleValue * (i.saleCostPct || 0.06);
  const netSale = saleValue - saleCosts;
  const finalBalance = years[9].endingBalance;
  const adjustedBasis = i.purchasePrice + rehabCost - accumDepreciation;
  const totalGain = netSale - adjustedBasis;
  const recaptureGain = Math.min(accumDepreciation, Math.max(0, totalGain));
  const ltcgGain = Math.max(0, totalGain - recaptureGain);
  const recaptureTax = recaptureGain * 0.25;
  const ltcgTax = ltcgGain * i.ltcgRate;
  const totalSaleTax = recaptureTax + ltcgTax;
  const netSaleProceedsPretax = netSale - finalBalance;
  const netSaleProceedsAfterTax = netSaleProceedsPretax - totalSaleTax;

  // Pre-tax IRR cash flows: -totalCashIn at t0, CFbT years 1..10, sale proceeds at t10.
  const cfPre = [-totalCashIn];
  const cfAft = [-totalCashIn];
  for (let y = 0; y < 10; y++) {
    let pre = years[y].cfBeforeTax;
    let aft = years[y].cfAfterTax;
    if (years[y].cashOutEvent) {
      pre += years[y].cashOutEvent;
      aft += years[y].cashOutEvent; // cash-out refi proceeds are tax-free
    }
    if (y === 9) {
      pre += netSaleProceedsPretax;
      aft += netSaleProceedsAfterTax;
    }
    cfPre.push(pre);
    cfAft.push(aft);
  }

  // Y1 metrics
  const y1 = years[0];
  const capRate = y1.noi / i.purchasePrice;
  const cashOnCash = y1.cfBeforeTax / totalCashIn;
  const dscr = y1.noi / y1.debtService;
  const monthlyCF = y1.cfBeforeTax / 12;
  const grm = i.purchasePrice / (i.grossMonthlyRent * 12);
  const onePctRatio = (i.grossMonthlyRent) / i.purchasePrice;
  const breakEvenOcc = (y1.opex + y1.debtService) / y1.gpr;

  // Refi metrics
  let refiMetrics = null;
  if (i.refiEnabled) {
    const balanceAtRefi = loanBalance(loanAmount, i.rate, i.termYears * 12, i.refiYear * 12);
    const refiClosing = arv * (i.refiClosingCostPct || 0.02);
    const newDS = refiPayment * 12;
    // DSCR at refi using year-(refiYear+1) NOI for forward look
    const yIdx = Math.min(i.refiYear, 9);
    const fwdNOI = years[yIdx].noi;
    refiMetrics = {
      arv,
      newLoan: refiLoan,
      balanceAtRefi,
      closingCosts: refiClosing,
      cashOut,
      cashLeftIn: Math.max(0, totalCashIn - cashOut),
      refiDSCR: fwdNOI / newDS,
      passesLenderDSCR: (fwdNOI / newDS) >= (i.refiMinDSCR || 1.20),
    };
  }

  return {
    inputs: i, years,
    totalCashIn, downPayment, loanAmount, closingCosts, rehabCost,
    acqPayment, annualAcqDS,
    capRate, cashOnCash, dscr, monthlyCF, grm, onePctRatio, breakEvenOcc,
    annualDepreciation, accumDepreciation,
    saleValue, saleCosts, finalBalance, adjustedBasis, totalGain,
    recaptureGain, ltcgGain, recaptureTax, ltcgTax,
    netSaleProceedsPretax, netSaleProceedsAfterTax,
    cfPre, cfAft,
    irrPreTax: irr(cfPre),
    irrAfterTax: irr(cfAft),
    equityMultiplePre: equityMultiple(cfPre),
    equityMultipleAfter: equityMultiple(cfAft),
    refiMetrics,
  };
}

// =====================
// Multifamily / value-add engine
// =====================

// Build the unit-mix derived rent (in-place and pro forma) and revenue items.
// unitMix: [{ type, count, inPlaceRent, proFormaRent }] where rents are $/unit/month.
function computeRentRoll(unitMix) {
  let units = 0, inPlaceMo = 0, proFormaMo = 0;
  for (const u of unitMix) {
    units += u.count;
    inPlaceMo += u.count * u.inPlaceRent;
    proFormaMo += u.count * u.proFormaRent;
  }
  return {
    totalUnits: units,
    monthlyInPlaceRent: inPlaceMo,
    monthlyProFormaRent: proFormaMo,
    annualInPlaceRent: inPlaceMo * 12,
    annualProFormaRent: proFormaMo * 12,
  };
}

export function runMultifamily(input) {
  const i = input;
  const rr = computeRentRoll(i.unitMix);

  // Renovation schedule: units renovated per month, starting month 1 of hold.
  // Each renovated unit transitions from in-place to pro-forma rent after `i.renoMonths` extra vacancy.
  // We model effective rent each year by tracking renovated-unit-months.
  const totalUnits = rr.totalUnits;
  const renoPerMonth = i.unitsRenovatedPerMonth || 0;
  const renoCostPerUnit = i.renoCostPerUnit || 0;
  const renoContingency = i.renoContingency || 0;
  const cmFee = i.constructionMgmtFeePct || 0;
  const renoMonthsPerUnit = i.renoMonthsPerUnit || 1;
  const totalRenoCost = totalUnits * renoCostPerUnit * (1 + renoContingency) * (1 + cmFee);

  // Acquisition costs
  const closingCosts = i.purchasePrice * i.closingCostPct;
  const rateCapCost = i.rateCapCost || 0;
  // Loan
  const loanAmount = i.purchasePrice * i.ltv;
  const downPayment = i.purchasePrice - loanAmount;
  // Reno capex is drawn over time (modeled as negative CF in years 1-2), so it is
  // NOT in initial cash invested at t=0. Initial cash = down + closing + rate cap + reserve.
  const initialCapReserve = (i.initialCapReserve || 0);
  const totalCashIn = downPayment + closingCosts + rateCapCost + initialCapReserve;

  // Debt sizing
  const termMonths = (i.amortYears || 30) * 12;
  const ioMonths = i.ioYears ? i.ioYears * 12 : 0;
  // Floating rate forward curve: SOFR per year (capped at strike during cap term) + spread.
  // Cap strike is on the SOFR index. After cap term expires, no cap applies.
  let ratesByYear;
  if (i.rateMode === 'floating') {
    ratesByYear = [];
    for (let y = 0; y < 10; y++) {
      const sofr = (i.sofrCurve && i.sofrCurve[y] !== undefined) ? i.sofrCurve[y] : i.sofrInitial;
      const effectiveSofr = (i.capStrike !== undefined && i.capStrike !== null && y < (i.rateCapYears || 0))
        ? Math.min(sofr, i.capStrike) : sofr;
      ratesByYear.push(effectiveSofr + i.spread);
    }
  } else {
    ratesByYear = Array(10).fill(i.fixedRate);
  }

  const amort = amortizationSchedule({
    principal: loanAmount,
    annualRate: ratesByYear[0],
    termMonths,
    ioMonths,
    years: 10,
    ratesByYear,
  });

  // Year-by-year revenue model
  const years = [];
  const depreciableBasis = i.purchasePrice * (1 - i.landPct) + totalRenoCost * (1 - i.landPct);
  const annualDepreciation = depreciableBasis / 27.5;
  let accumDepreciation = 0;
  let unitsRenovatedToDate = 0;

  for (let y = 1; y <= 10; y++) {
    const growthYrs = y - 1;
    // For each month in this year, determine how many units are at pro-forma rent.
    let monthlyPotentialRent = 0;
    let monthlyExtraVacancy = 0;
    for (let m = 0; m < 12; m++) {
      const monthIdx = (y - 1) * 12 + m;
      // Units fully renovated and re-leased by start of this month (assume re-lease immediately after reno):
      const unitsRenovated = Math.min(
        Math.max(0, Math.floor(renoPerMonth * monthIdx)),
        totalUnits,
      );
      const unitsInRenovation = Math.min(
        renoPerMonth * renoMonthsPerUnit,
        Math.max(0, totalUnits - unitsRenovated),
      );
      const unitsInPlace = totalUnits - unitsRenovated - unitsInRenovation;
      const inPlaceRentMo = (rr.monthlyInPlaceRent / totalUnits) * Math.pow(1 + i.rentGrowth, growthYrs);
      const proFormaRentMo = (rr.monthlyProFormaRent / totalUnits) * Math.pow(1 + i.rentGrowth, growthYrs);
      monthlyPotentialRent += (
        unitsInPlace * inPlaceRentMo +
        unitsInRenovation * inPlaceRentMo +
        unitsRenovated * proFormaRentMo
      );
      monthlyExtraVacancy += unitsInRenovation * inPlaceRentMo; // 100% vacancy during reno
    }
    const gpr = monthlyPotentialRent;
    const lossToLease = gpr * (i.lossToLeasePct || 0);
    const concessions = gpr * (i.concessionsPct || 0);
    const nonRevenue = gpr * (i.nonRevenuePct || 0);
    const baseVacancy = gpr * (i.vacancyPct || 0);
    const renoVacancy = monthlyExtraVacancy;
    const otherIncome = (i.otherIncomePerUnitAnnual || 0) * totalUnits * Math.pow(1 + i.rentGrowth, growthYrs);
    const egi = gpr - baseVacancy - renoVacancy - lossToLease - concessions - nonRevenue + otherIncome;

    // OpEx — modeled as $/unit/yr line items plus % of EGI for mgmt & AM.
    const opexPerUnit = (i.opexPerUnitYr || 0) * Math.pow(1 + i.expenseGrowth, growthYrs);
    const opexFixed = opexPerUnit * totalUnits;
    const taxes = i.propertyTaxYr * Math.pow(1 + i.expenseGrowth, growthYrs);
    const insurance = i.insuranceYr * Math.pow(1 + i.expenseGrowth, growthYrs);
    const mgmt = (i.mgmtPct || 0) * egi;
    const amFee = (i.amFeePct || 0) * egi;
    const replacementReserve = (i.replacementReservePerUnitYr || 0) * totalUnits * Math.pow(1 + i.expenseGrowth, growthYrs);
    const opex = opexFixed + taxes + insurance + mgmt + amFee + replacementReserve;
    const noi = egi - opex;

    const row = amort[y - 1];
    const debtService = row.payment;
    const interest = row.interest;
    const principalPaid = row.principal;
    const endingBalance = row.endingBalance;

    // CapEx draws (value-add): evenly distributed across the renovation period.
    // Months of renovation activity falling inside this year:
    const renoMonthsTotal = renoPerMonth > 0 ? totalUnits / renoPerMonth : 0;
    const yearStartMonth = (y - 1) * 12;
    const yearEndMonth = y * 12;
    const monthsInYear = renoMonthsTotal <= 0
      ? 0
      : Math.max(0, Math.min(renoMonthsTotal, yearEndMonth) - Math.max(0, yearStartMonth));
    const renoFracThisYear = renoMonthsTotal > 0 ? monthsInYear / renoMonthsTotal : 0;
    const renoCapEx = totalRenoCost * renoFracThisYear;

    const cfBeforeTax = noi - debtService - renoCapEx;
    const taxableIncome = noi - interest - annualDepreciation - renoCapEx * 0; // capex capitalized, not expensed
    accumDepreciation += annualDepreciation;
    const incomeTax = taxableIncome * (i.ordinaryTaxRate || 0.37);
    const cfAfterTax = cfBeforeTax - incomeTax;

    years.push({
      year: y, gpr, lossToLease, concessions, nonRevenue, baseVacancy, renoVacancy,
      otherIncome, egi, opexFixed, taxes, insurance, mgmt, amFee, replacementReserve,
      opex, noi, interest, principalPaid, debtService, endingBalance,
      depreciation: annualDepreciation, taxableIncome, incomeTax,
      renoCapEx, cfBeforeTax, cfAfterTax,
    });
  }

  // Exit: Year-11 forward NOI (stabilized) / exit cap
  const y10 = years[9];
  // Build Year-11 stabilized NOI (all units at pro forma, base vacancy only)
  const gpr11 = (rr.monthlyProFormaRent * 12) * Math.pow(1 + i.rentGrowth, 10);
  const lossToLease11 = gpr11 * (i.lossToLeasePct || 0);
  const concessions11 = gpr11 * (i.concessionsPct || 0);
  const nonRev11 = gpr11 * (i.nonRevenuePct || 0);
  const baseVac11 = gpr11 * (i.vacancyPct || 0);
  const otherInc11 = (i.otherIncomePerUnitAnnual || 0) * totalUnits * Math.pow(1 + i.rentGrowth, 10);
  const egi11 = gpr11 - baseVac11 - lossToLease11 - concessions11 - nonRev11 + otherInc11;
  const opexPerUnit11 = (i.opexPerUnitYr || 0) * Math.pow(1 + i.expenseGrowth, 10);
  const taxes11 = i.propertyTaxYr * Math.pow(1 + i.expenseGrowth, 10);
  const ins11 = i.insuranceYr * Math.pow(1 + i.expenseGrowth, 10);
  const mgmt11 = (i.mgmtPct || 0) * egi11;
  const am11 = (i.amFeePct || 0) * egi11;
  const rr11 = (i.replacementReservePerUnitYr || 0) * totalUnits * Math.pow(1 + i.expenseGrowth, 10);
  const opex11 = opexPerUnit11 * totalUnits + taxes11 + ins11 + mgmt11 + am11 + rr11;
  const noi11 = egi11 - opex11;

  const saleValue = noi11 / i.exitCapRate;
  const saleCosts = saleValue * (i.saleCostPct || 0.02);
  const netSale = saleValue - saleCosts;
  const finalBalance = y10.endingBalance;
  const adjustedBasis = i.purchasePrice + totalRenoCost - accumDepreciation;
  const totalGain = netSale - adjustedBasis;
  const recaptureGain = Math.min(accumDepreciation, Math.max(0, totalGain));
  const ltcgGain = Math.max(0, totalGain - recaptureGain);
  const recaptureTax = recaptureGain * 0.25;
  const ltcgTax = ltcgGain * (i.ltcgRate || 0.20);
  const totalSaleTax = recaptureTax + ltcgTax;
  const netSaleProceedsPretax = netSale - finalBalance;
  const netSaleProceedsAfterTax = netSaleProceedsPretax - totalSaleTax;

  // Project-level cash flows
  const cfPre = [-totalCashIn];
  const cfAft = [-totalCashIn];
  for (let y = 0; y < 10; y++) {
    let pre = years[y].cfBeforeTax;
    let aft = years[y].cfAfterTax;
    if (y === 9) {
      pre += netSaleProceedsPretax;
      aft += netSaleProceedsAfterTax;
    }
    cfPre.push(pre);
    cfAft.push(aft);
  }

  // In-place stabilized NOI (no reno disruption, Y1 expense levels).
  // This is what underwriters & lenders treat as the going-in number.
  const inPlaceGPR = rr.annualInPlaceRent;
  const inPlaceLTL = inPlaceGPR * (i.lossToLeasePct || 0);
  const inPlaceConcessions = inPlaceGPR * (i.concessionsPct || 0);
  const inPlaceNonRev = inPlaceGPR * (i.nonRevenuePct || 0);
  const inPlaceVacancy = inPlaceGPR * (i.vacancyPct || 0);
  const inPlaceOtherInc = (i.otherIncomePerUnitAnnual || 0) * totalUnits;
  const inPlaceEGI = inPlaceGPR - inPlaceVacancy - inPlaceLTL - inPlaceConcessions - inPlaceNonRev + inPlaceOtherInc;
  const inPlaceMgmt = (i.mgmtPct || 0) * inPlaceEGI;
  const inPlaceAM = (i.amFeePct || 0) * inPlaceEGI;
  const inPlaceOpex = (i.opexPerUnitYr || 0) * totalUnits +
    i.propertyTaxYr + i.insuranceYr + inPlaceMgmt + inPlaceAM +
    (i.replacementReservePerUnitYr || 0) * totalUnits;
  const inPlaceNOI = inPlaceEGI - inPlaceOpex;

  // Going-in & stabilized caps
  const goingInCap = inPlaceNOI / i.purchasePrice;
  const stabilizedCap = noi11 / saleValue; // == exitCapRate by construction
  const y1 = years[0];
  const cashOnCash = y1.cfBeforeTax / totalCashIn;
  // Lender-qualifying DSCR: in-place NOI / fully-amortizing P+I at initial all-in rate
  // measured uncapped (lenders size to the worst case, not the capped rate).
  const uncappedInitialRate = i.rateMode === 'floating'
    ? i.sofrInitial + i.spread
    : i.fixedRate;
  const qualifyingDS = mortgagePayment(loanAmount, uncappedInitialRate, termMonths) * 12;
  const dscr = inPlaceNOI / qualifyingDS;
  // Year-1 cash basis DSCR uses actual (potentially IO) debt service.
  const cashDSCR = y1.noi / y1.debtService;
  // Year-2 stabilized DSCR
  const y2dscr = years[1] ? years[1].noi / years[1].debtService : null;
  const breakEvenOcc = (y1.opex + y1.debtService) / y1.gpr;

  // +200bps DSCR stress on the qualifying basis.
  const stressRate = ratesByYear[0] + 0.02;
  const stressPmt = mortgagePayment(loanAmount, stressRate, termMonths);
  const stressDSCR = inPlaceNOI / (stressPmt * 12);

  return {
    inputs: i, years, rentRoll: rr,
    totalCashIn, downPayment, loanAmount, closingCosts, totalRenoCost,
    annualDepreciation, accumDepreciation,
    inPlaceNOI, inPlaceEGI,
    goingInCap, stabilizedCap, cashOnCash, dscr, cashDSCR, y2dscr,
    qualifyingDS, breakEvenOcc, stressRate, stressDSCR,
    saleValue, saleCosts, finalBalance, adjustedBasis, totalGain,
    recaptureGain, ltcgGain, recaptureTax, ltcgTax,
    netSaleProceedsPretax, netSaleProceedsAfterTax,
    noi11,
    cfPre, cfAft,
    irrPreTax: irr(cfPre),
    irrAfterTax: irr(cfAft),
    equityMultiplePre: equityMultiple(cfPre),
    equityMultipleAfter: equityMultiple(cfAft),
    amort, ratesByYear,
  };
}

// =====================
// European LP/GP waterfall
// =====================

// Inputs:
//   projectCashflows: array length 11 (t0..t10), project-level pre-tax cash flows including sale.
//                     t0 is negative (total equity contribution), t1..t10 are distributions.
//   lpShare: 0..1 (LP fraction of equity)
//   prefRate: annual preferred return rate (e.g., 0.08)
//   tier1Promote: { lp: 0.8, gp: 0.2 } above pref before hurdle
//   tier2Hurdle: LP IRR threshold (e.g., 0.15) at which the second-tier promote engages
//   tier2Promote: { lp: 0.7, gp: 0.3 } once hurdle crossed
//
// Spec order: PREF → ROC → tier-1 promote → tier-2 promote (compounding pref).
//
// At each period:
//   1. Accrue pref on (remainingLPCapital + unpaidPref) at prefRate. (compounding)
//   2. Distribute available cash:
//      a. Pay accrued pref to LP (until pref balance = 0)
//      b. Return LP capital (until LP balance = 0)
//      c. Once both clear, remaining cash splits per current tier:
//          - tier 1 split until LP cumulative IRR reaches tier2Hurdle on LP cash flows
//          - then tier 2 split
export function runWaterfall({
  projectCashflows, lpShare, prefRate,
  tier1Promote, tier2Hurdle, tier2Promote,
}) {
  const periods = projectCashflows.length;
  const totalEquity = -projectCashflows[0];
  const lpCapital = totalEquity * lpShare;
  const gpCapital = totalEquity * (1 - lpShare);

  let lpUnreturned = lpCapital;
  let gpUnreturned = gpCapital;
  let lpPrefBalance = 0;

  const lpCF = [-lpCapital];
  const gpCF = [-gpCapital];
  const rows = [{
    year: 0, distributable: 0, prefAccrued: 0,
    lpPref: 0, lpROC: 0, gpROC: 0,
    tier1LP: 0, tier1GP: 0, tier2LP: 0, tier2GP: 0,
    lpTotal: -lpCapital, gpTotal: -gpCapital,
    lpPrefEndBalance: lpPrefBalance, lpUnreturnedEnd: lpUnreturned,
  }];

  for (let t = 1; t < periods; t++) {
    // 1. Accrue pref on (unreturned LP capital + outstanding pref balance) — compounding
    const prefBase = lpUnreturned + lpPrefBalance;
    const prefAccrued = prefBase * prefRate;
    lpPrefBalance += prefAccrued;

    let cash = projectCashflows[t];
    if (cash < 0) {
      // Capital call (rare): treat as additional LP contribution pro rata, increasing unreturned balance.
      const lpCall = -cash * lpShare;
      const gpCall = -cash * (1 - lpShare);
      lpUnreturned += lpCall;
      gpUnreturned += gpCall;
      lpCF.push(-lpCall);
      gpCF.push(-gpCall);
      rows.push({
        year: t, distributable: 0, prefAccrued, lpPref: 0,
        lpROC: -lpCall, gpROC: -gpCall,
        tier1LP: 0, tier1GP: 0, tier2LP: 0, tier2GP: 0,
        lpTotal: -lpCall, gpTotal: -gpCall,
        lpPrefEndBalance: lpPrefBalance, lpUnreturnedEnd: lpUnreturned,
      });
      continue;
    }

    let distributable = cash;
    // 2a. Pay accrued pref to LP
    const lpPrefPaid = Math.min(distributable, lpPrefBalance);
    lpPrefBalance -= lpPrefPaid;
    distributable -= lpPrefPaid;

    // 2b. Return LP capital
    const lpROC = Math.min(distributable, lpUnreturned);
    lpUnreturned -= lpROC;
    distributable -= lpROC;

    // 2c. Return GP capital (after LP fully returned, before promote — spec is LP-first; GP capital is also returned before promote in European)
    const gpROC = Math.min(distributable, gpUnreturned);
    gpUnreturned -= gpROC;
    distributable -= gpROC;

    // 2d. Promote tiers
    let tier1LP = 0, tier1GP = 0, tier2LP = 0, tier2GP = 0;
    if (distributable > 0) {
      // Determine current LP IRR using LP cash flows so far + a probe distribution
      // We use a bisection approach: try splitting all at tier 1; if resulting LP IRR > hurdle, some must be in tier 2.
      // Simple iterative approach: split distributable into a small step, check LP IRR, escalate to tier 2 when crossed.
      // For computational simplicity, do it in two passes:
      //   (i) compute LP IRR assuming all remaining at tier 1; if <= hurdle, stay tier 1.
      //   (ii) otherwise, binary-search the split point where LP IRR = hurdle.
      const allTier1LP_cf = [...lpCF, lpPrefPaid + lpROC + distributable * tier1Promote.lp];
      const allTier1GP_cf = [...gpCF, gpROC + distributable * tier1Promote.gp];
      // pad LP CF to current period length
      while (allTier1LP_cf.length < t + 1) allTier1LP_cf.push(0);
      const irrAllTier1 = irr(allTier1LP_cf);
      if (irrAllTier1 === null || irrAllTier1 <= tier2Hurdle) {
        tier1LP = distributable * tier1Promote.lp;
        tier1GP = distributable * tier1Promote.gp;
      } else {
        // Find the split: tier1 amount X such that LP IRR exactly equals hurdle.
        // LP receives: X*t1.lp + (distributable - X)*t2.lp
        let lo = 0, hi = distributable;
        for (let iter = 0; iter < 60; iter++) {
          const mid = (lo + hi) / 2;
          const lpDistMid = lpPrefPaid + lpROC + mid * tier1Promote.lp + (distributable - mid) * tier2Promote.lp;
          const probe = [...lpCF, lpDistMid];
          while (probe.length < t + 1) probe.push(0);
          const irrMid = irr(probe);
          if (irrMid === null) { hi = mid; continue; }
          if (irrMid > tier2Hurdle) lo = mid;
          else hi = mid;
          if (hi - lo < 1e-6) break;
        }
        const X = (lo + hi) / 2;
        tier1LP = X * tier1Promote.lp;
        tier1GP = X * tier1Promote.gp;
        tier2LP = (distributable - X) * tier2Promote.lp;
        tier2GP = (distributable - X) * tier2Promote.gp;
      }
    }

    const lpTotal = lpPrefPaid + lpROC + tier1LP + tier2LP;
    const gpTotal = gpROC + tier1GP + tier2GP;
    lpCF.push(lpTotal);
    gpCF.push(gpTotal);

    rows.push({
      year: t, distributable: cash, prefAccrued,
      lpPref: lpPrefPaid, lpROC, gpROC,
      tier1LP, tier1GP, tier2LP, tier2GP,
      lpTotal, gpTotal,
      lpPrefEndBalance: lpPrefBalance, lpUnreturnedEnd: lpUnreturned,
    });
  }

  return {
    rows, lpCF, gpCF,
    lpIRR: irr(lpCF),
    gpIRR: irr(gpCF),
    lpEquityMultiple: equityMultiple(lpCF),
    gpEquityMultiple: equityMultiple(gpCF),
    lpCleared: rows.length > 0 && rows[rows.length - 1].lpPrefEndBalance < 0.01 &&
               rows[rows.length - 1].lpUnreturnedEnd < 0.01,
  };
}
