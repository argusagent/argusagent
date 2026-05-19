// State management + localStorage persistence.

const STORAGE_KEY = 'underwritepro.v1';

export const defaultSF = {
  // Acquisition
  purchasePrice: 250000,
  downPct: 0.25,
  closingCostPct: 0.025,
  rehabBudget: 0,
  rehabMonths: 0,
  landPct: 0.20,
  // Financing
  rate: 0.07,
  termYears: 30,
  // Revenue
  grossMonthlyRent: 2200,
  otherIncomeAnnual: 0,
  vacancyPct: 0.05,
  // OpEx
  propertyTax: 3200,
  insurance: 1400,
  mgmtPct: 0.08,
  maintenancePct: 0.05,
  capexPct: 0.05,
  // Growth & exit
  rentGrowth: 0.03,
  expenseGrowth: 0.02,
  exitCapRate: 0.0675,
  saleCostPct: 0.06,
  // Tax
  ordinaryTaxRate: 0.37,
  ltcgRate: 0.20,
  // BRRRR
  refiEnabled: false,
  refiYear: 1,
  afterRepairValue: 0,
  refiLTV: 0.75,
  refiRate: 0.075,
  refiTermYears: 30,
  refiClosingCostPct: 0.02,
  refiMinDSCR: 1.20,
};

export const defaultMF = {
  purchasePrice: 13_850_000,
  closingCostPct: 0.02,
  ltv: 0.70,
  initialCapReserve: 0,
  unitMix: [
    { type: '1BR', count: 30, inPlaceRent: 1100, proFormaRent: 1550 },
    { type: '2BR', count: 70, inPlaceRent: 1350, proFormaRent: 1850 },
    { type: '3BR', count: 18, inPlaceRent: 1650, proFormaRent: 2200 },
  ],
  // Revenue
  vacancyPct: 0.05,
  lossToLeasePct: 0.02,
  concessionsPct: 0.01,
  nonRevenuePct: 0.01,
  otherIncomePerUnitAnnual: 600,
  // OpEx
  propertyTaxYr: 200_000,
  insuranceYr: 80_000,
  opexPerUnitYr: 3700,
  replacementReservePerUnitYr: 250,
  mgmtPct: 0.03,
  amFeePct: 0.01,
  // Growth & exit
  rentGrowth: 0.03,
  expenseGrowth: 0.025,
  exitCapRate: 0.0525,
  saleCostPct: 0.02,
  // Tax
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
  // Waterfall
  waterfall: {
    lpShare: 0.90,
    prefRate: 0.08,
    tier1LP: 0.80,
    tier1GP: 0.20,
    tier2Hurdle: 0.15,
    tier2LP: 0.70,
    tier2GP: 0.30,
  },
};

export function newState() {
  return {
    mode: 'sf',
    activeTab: 'dashboard',
    proFormaView: 'pre',
    sf: structuredClone(defaultSF),
    mf: structuredClone(defaultMF),
    savedDeals: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return newState();
    const parsed = JSON.parse(raw);
    // Merge in any new default keys so old saves still work.
    return {
      ...newState(),
      ...parsed,
      sf: { ...defaultSF, ...(parsed.sf || {}) },
      mf: {
        ...defaultMF,
        ...(parsed.mf || {}),
        waterfall: { ...defaultMF.waterfall, ...((parsed.mf || {}).waterfall || {}) },
      },
    };
  } catch (e) {
    console.warn('state load failed', e);
    return newState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('state save failed', e);
  }
}

export function saveDeal(state, name) {
  const id = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const snapshot = {
    id, name, mode: state.mode,
    savedAt: new Date().toISOString(),
    inputs: state.mode === 'sf' ? structuredClone(state.sf) : structuredClone(state.mf),
  };
  state.savedDeals = [snapshot, ...state.savedDeals];
  save(state);
  return snapshot;
}

export function loadDeal(state, id) {
  const deal = state.savedDeals.find((d) => d.id === id);
  if (!deal) return;
  state.mode = deal.mode;
  if (deal.mode === 'sf') state.sf = structuredClone(deal.inputs);
  else state.mf = structuredClone(deal.inputs);
  save(state);
}

export function deleteDeal(state, id) {
  state.savedDeals = state.savedDeals.filter((d) => d.id !== id);
  save(state);
}
