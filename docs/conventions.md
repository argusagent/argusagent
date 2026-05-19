# UnderWrite Pro — Calculation Conventions

This document records the financial conventions used throughout the application, with sources.

## Cap Rate
Cap rate = NOI ÷ Value (unlevered; NOI excludes debt service). For value-add multifamily, going-in cap uses in-place stabilized NOI (no renovation disruption). Stabilized / exit cap uses Year-11 forward NOI ÷ sale price.

Sources: [JPMorgan](https://www.jpmorgan.com/insights/real-estate/commercial-term-lending/cap-rates-explained), [PropertyMetrics](https://propertymetrics.com/blog/cap-rate/), [Wall Street Prep](https://www.wallstreetprep.com/knowledge/cap-rate/)

## DSCR
DSCR = NOI ÷ Annual Debt Service (P+I).

Two DSCR figures are surfaced for multifamily:
- **Qualifying DSCR** = in-place NOI ÷ fully-amortizing P+I at the **uncapped** initial all-in rate (matches lender sizing).
- **Cash DSCR** = Year-1 actual NOI ÷ actual debt service (may use IO).

Lender minimum default: 1.20. <1.0 flagged red.

Sources: [Wikipedia](https://en.wikipedia.org/wiki/Debt_service_coverage_ratio), [Wall Street Prep](https://www.wallstreetprep.com/knowledge/dscr-debt-service-coverage-ratio/)

## Cash-on-Cash
= Annual pre-tax cash flow ÷ Total cash invested. Year-1 used by default. Total cash invested = down payment + closing costs + (SF: rehab) + (MF: rate-cap cost + initial cap reserve). Reno CapEx for MF is drawn over time and modeled as a deduction from yearly cash flow rather than initial equity.

Source: [Wall Street Prep](https://www.wallstreetprep.com/knowledge/cash-on-cash-return/)

## IRR (Newton–Raphson)
NPV(r) = Σ CF_t / (1+r)^t. Iterate r → r − NPV(r)/NPV′(r). Fall back to bisection on [−0.999, 10] if Newton fails. Tolerance 1e-9; max 100 Newton iters, 200 bisection iters.

Source: [Improved Newton-Raphson for IRR](https://www.researchgate.net/publication/338749495_Calculating_Internal_Rate_of_Return_IRR_in_Practice_using_Improved_Newton-Raphson_Algorithm)

## Depreciation
27.5-year straight-line on building only (land excluded). Full-year basis (mid-month is for tax filing, not pro-forma UW). Reno CapEx is capitalized into building basis and depreciated.

Source: [IRS Pub 527](https://www.irs.gov/publications/p527)

## Sale Tax
- Accumulated depreciation taxed at 25% (unrecaptured §1250 gain — the legal cap rate for residential rental).
- Gain above adjusted basis taxed at LTCG (user-set, default 20%).

Source: [TurboTax — Depreciation Recapture](https://turbotax.intuit.com/tax-tips/rental-property/depreciation-recapture-definition-calculation-and-examples/c5H96UGw8)

## 1% Rule / GRM / Break-Even Occupancy
- 1% rule: monthly rent ≥ 1% of price.
- GRM = price ÷ annual gross rent.
- Break-even occupancy = (OpEx + Debt Service) ÷ Potential Gross Income.

Source: [CommercialRE.loans](https://www.commercialrealestate.loans/commercial-real-estate-glossary/1-and-2-percent-rules/), [Wall Street Prep — Break-even](https://www.wallstreetprep.com/knowledge/breakeven-occupancy-ratio/)

## SOFR + Spread, Rate Cap, IO
- All-in rate = effective SOFR + spread.
- Rate cap strike is on the **SOFR index**; during cap term, effective SOFR = min(SOFR, strike). After cap term, no cap.
- Interest-only period: only interest accrues; loan re-amortizes over remaining term after IO expires.
- Floating rate is sized year-by-year from a user-input SOFR forward curve. Each month the payment is recalculated at the current rate and remaining term.

Source: [AdventuresinCRE — Interest Rate Cap](https://www.adventuresincre.com/glossary/interest-rate-cap/), [CommercialRE.loans — SOFR](https://www.commercialrealestate.loans/commercial-real-estate-glossary/sofr/)

## European LP/GP Waterfall
Order per period: 

1. Accrue pref on (unreturned LP capital + outstanding pref balance) — **compounding**.
2. Pay accrued pref to LP.
3. Return LP capital.
4. Return GP capital.
5. Distribute remaining cash in tier-1 split (e.g., 80/20) until LP cumulative IRR reaches the tier-2 hurdle.
6. Above hurdle: tier-2 split (e.g., 70/30).

Binary search (60 iters) finds the exact tier-1 / tier-2 split point each period where LP IRR equals the hurdle.

Source: [Wall Street Prep — Waterfall](https://www.wallstreetprep.com/knowledge/real-estate-waterfall/), [FNRP — American vs European](https://fnrpusa.com/blog/american-vs-european-equity-waterfalls/)

## Multifamily Revenue Build
EGI = GPR − Vacancy − Loss-to-Lease − Concessions − Non-Revenue + Other Income.

OpEx model: per-unit operating ($/unit/yr) + property tax + insurance + management (% of EGI) + asset-management fee (% of EGI) + replacement reserve ($/unit/yr).

Source: [PropRise — EGI](https://www.proprise.ai/primer/glossary/effective-gross-income/), [Tactica — Loss-to-Lease](https://www.tacticares.com/blog-feed/underwriting-multifamily-loss-to-lease)

## Value-Add Renovation
Total reno cost = units × cost/unit × (1 + contingency) × (1 + construction-management fee). Renovation runs at a user-set pace (units/month). Each unit incurs N months of full vacancy during renovation, then transitions from in-place rent to pro-forma rent. Reno capex is drawn evenly over the renovation period and shown as a negative operating cash flow (capitalized for tax — not deducted from taxable income).

Source: [Tactica — Value-Add Underwriting](https://www.tacticares.com/blog-feed/the-ultimate-guide-to-multifamily-value-add-underwriting)
