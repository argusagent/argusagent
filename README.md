# UnderWrite Pro

Institutional real-estate underwriting — single-family rental and multifamily value-add — as a fully offline, installable PWA. No backend, no accounts.

## What it does

Two modes (state isolated between them):

1. **Single-family / small rental** — purchase, fixed-rate financing, 10-year after-tax pro forma, BRRRR cash-out-refi modeling with lender DSCR gate.
2. **Multifamily / apartment complex** — editable unit-mix rent roll, loss-to-lease / concessions / non-revenue, value-add CapEx with renovation schedule, SOFR-plus-spread floating debt with rate cap and interest-only period (or fixed), exit-cap stabilized valuation, full European LP/GP equity waterfall with compounding pref and tiered promote.

Tabs: Dashboard (verdict + KPI tiles + charts + flags), Inputs (mode-conditional), Pro Forma (pre/after-tax 10-year), Waterfall (MF only), Sensitivity (rent×price stress, break-even occupancy, +200bps DSCR stress, DSCR-vs-rate chart), Saved Deals (localStorage).

## Run locally

```sh
npm run serve              # python3 -m http.server 8080
open http://localhost:8080
```

## Calculation verification

```sh
node tests/verify.js
```

Reference cases checked:

- Single-family base: $250k @ 7% / 25% down / $2,200 rent → 6.33% cap, 1.06 DSCR, $72/mo CF, ~$7,273 annual depreciation, ~9.9% 10-yr after-tax IRR.
- Multifamily value-add: ~$13.85M, 118 units → 7.00% going-in cap, ~1.20 DSCR, ~22.7% after-tax IRR, LP IRR clears 8% pref.

## Conventions

See `docs/conventions.md` (sources cited). Highlights:

- Cap rate = Year-1 NOI ÷ Price (in-place stabilized NOI for value-add).
- DSCR = NOI ÷ fully-amortizing P+I (lender-qualifying, even when actual debt service is IO).
- IRR via Newton–Raphson with bisection fallback (tolerance 1e-9).
- Depreciation 27.5 yr straight-line on building (land excluded); full-year underwriting basis.
- §1250 recapture taxed at 25%; LTCG on gain above basis taxed at user-set rate (default 20%).
- SOFR cap strike on the index; all-in rate = capped SOFR + spread.
- European waterfall order: compounding pref → return-of-capital → tier-1 promote → tier-2 promote at IRR hurdle.
- Exit price = Year-11 forward NOI ÷ exit cap.

## Deployment

Pushes to `main` or `claude/build-underwrite-pwa-*` auto-publish via the workflow in `.github/workflows/deploy.yml` to GitHub Pages once Pages is enabled (Settings → Pages → Source = GitHub Actions).
