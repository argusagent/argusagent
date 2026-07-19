# Printify + Etsy — complete operational guide (researched July 2026)

All claims from official Printify/Etsy help-center pages (via search snippets — 403 walls
prevented full-page reads) plus graded secondary sources. Re-verify in-app before relying:
the draft-publish toggle, resale-certificate UI path, per-blueprint size lists.

## What Printify is

A print-on-demand middleman: you hold no inventory. The catalog is "blueprints"
(product types) offered by multiple third-party **print providers** that differ in
location, price, quality, and sizes. You pick blueprint → provider → upload art → set
retail prices → publish to a connected store. When something sells, the provider prints
and ships it blind (no Printify branding, your shop as sender); you keep retail minus
production+shipping+fees.

- **Free plan**: full access, up to 5 stores, pay per order only.
- **Premium** ($39/mo or $299/yr): up to 20% off production costs — breaks even around
  ~17 orders/month; ignore until then.
- Posters ship **rolled in extra-thick cardboard tubes**; main US wall-art provider is
  **Sensaria** (ex-Circle Graphics), ~3–4 business day production.

## How the Etsy link works

Printify is an authorized Etsy Partner. Flow: Printify → Manage my stores → Add new
store → Etsy → OAuth "Grant access" (listings, orders, tracking, inventory — it never
sees your password or banking).

**Prereq:** the Etsy shop must already be activated (≥1 live listing, $0.20).

**On publish, Printify creates the Etsy listing for you**: title/description (edit the
defaults — they're generic), up to 20 mockups (hard limit — publish fails above it),
variants with Printify SKUs (SKU = the join key; don't edit variants Etsy-side), and a
**fixed-price shipping profile** — calculated shipping is unsupported and breaks publish.

**Sync is one-way (Printify → Etsy).** Republishing from Printify overwrites Etsy-side
edits unless you use "selective publishing" (push only chosen elements). Rule: do SEO
edits in one place and never full-republish over Etsy-side changes.

**Production partner disclosure (required):** Etsy mandates listing your production
partner. One-time setup: Etsy Settings → Production partners → create "Printify"; after
that Printify auto-assigns it on publish. Skipping this = listing removal/suspension
risk, especially post the June 10, 2025 Creativity Standards tightening ("based on a
seller's original design" — our original art qualifies; template/clip-art shops don't).

## Order lifecycle and money flow

1. Buyer pays **Etsy** (Etsy collects/remits US sales tax as marketplace facilitator).
2. Order syncs to Printify instantly → sits **"On hold"** for your approval window
   (default ~24h, configurable; manual or auto-approve at a set time). This window is
   your only edit/cancel opportunity. Personalized orders ALWAYS wait for manual
   approval — forget them and they never ship.
3. On submission, **Printify charges your card** for production + shipping (+ tax on
   production cost unless you file a resale certificate — do this once you have a
   sales-tax permit; Etsy-facilitated orders shouldn't be double-taxed).
4. Production (posters ~3–4 business days) → "Ready to ship" → **tracking auto-pushes
   to Etsy**, order auto-completes, buyer gets the tracking email. You do nothing.
5. Etsy pays out your retail revenue on your deposit schedule. Your profit = Etsy
   payout − Printify charge.

## When things go wrong

- **Damage/defect**: buyer messages YOU on Etsy → collect photos → Printify order →
  "Submit issue" → refund or free reprint (30-day window, photo proof, no physical
  return). Printify pays for defects and transit damage; **you** pay for
  buyer's-remorse returns per your own Etsy return policy. Etsy Purchase Protection
  backstops buyers if you don't respond within 48h.
- **Out of stock**: enable Order Routing (Store settings) to auto-reroute to an
  alternate provider with a max-cost cap; otherwise orders wait.
- **Known integration failure modes**: silent disconnect when you change your Etsy
  password (reconnect manually — orders quietly stop importing); publish failures
  (calculated shipping, >20 mockups, deactivated listing); shipping profile missing
  origin ZIP/delivery time after Etsy-side edits; multi-item orders under-collect
  shipping (Etsy applies the discounted additional-item rate across providers — bake
  shipping into price or adjust the additional-item fee); peak-season production delays
  threatening Star Seller (set generous processing times).

## Poster/file specifics (and how the Kaze files map)

- Formats PNG/JPEG (≤100MB), **300 DPI recommended** (150 = floor). Printify
  auto-downscales larger files perfectly; never upscales well.
- **One file per aspect ratio** at the largest size sold: 24×36 @300DPI (7200×10800)
  covers every 2:3 size; separate files for 3:4, 4:5, 11:14 — exactly the five master
  files per design we already rendered for the Kaze Collection. ✔
- **Bleed**: cover 100% of the bleed zone; keep critical elements inside the safe area.
  Kaze designs have full-bleed textured backgrounds with centered compositions — ideal.
  One adjustment worth making: regenerate with ~3% extra background margin per side so
  trimming never clips a composition edge (one-line change in build.js).
- Finish for this collection: **matte** (fits the japandi/linen aesthetic; satin for
  more saturated styles). Blueprint options include matte vertical posters and
  250–300gsm photopaper.

## Sensible defaults for launch

Auto-approve with a 24h hold; order one sample per trio before going live (~$40–60
total); price 18×24 at $35+ with free shipping (unlocks Etsy's US search priority
placement); mirror Printify's 30-day defect window in your Etsy return policy; set
processing time to 5 business days; create the Printify production partner before the
first publish.
