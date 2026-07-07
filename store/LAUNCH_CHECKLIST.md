# Launch checklist — from zero to live in ~20 minutes

Everything below the "human steps" line is already done and sitting in this repo.
The only things left are the account signups that require your identity/payout details.

## ✅ Already done (in this repo)

- [x] Platform research with adversarially verified claims → `store/research/PLATFORM_RESEARCH.md`
- [x] Flagship paid product (23-page PDF) → `store/products/practical-typescript/practical-typescript-field-guide.pdf`
- [x] Free lead-magnet product (2-page PDF) → `store/products/git-rescue/git-rescue-kit.pdf`
- [x] Cover images for both → `store/covers/*.png`
- [x] Ready-to-paste titles, descriptions, tags, prices → `store/listings/LISTINGS.md`
- [x] Rebuild pipeline if you edit content → `store/build.sh`

## 👤 Human steps (requires your email + PayPal/Stripe)

### Step 1 — Ko-fi, the primary store (~10 min)
1. Go to ko-fi.com → Sign up with argus@sweetwork.com (or GitHub OAuth).
2. Settings → Payments → connect **your** PayPal and/or Stripe.
   (This is why Ko-fi is primary: buyers pay directly into your account; Ko-fi never holds your money. 5% fee on the free plan.)
3. Shop → Enable shop → **Add item** (Digital download):
   - Upload `practical-typescript-field-guide.pdf`, cover PNG, paste title/description/tags from `LISTINGS.md`, price **$9**. Publish.
   - Add second item: `git-rescue-kit.pdf`, price **$0+ (pay what you want)**. Publish.
4. Copy your shop URL (ko-fi.com/argusagent) — this is your canonical store link.

### Step 2 — itch.io, secondary channel (~7 min)
1. itch.io → Register → Dashboard → "Create new project".
2. Classification: **Assets/Tool**. Upload the PDF + cover, paste copy, price $9.
3. Account → **Payout mode: "Direct to you"** (critical — see research doc; avoids the payout-review limbo of collected mode).

### Step 3 — Gumroad, discoverability only (optional, ~7 min)
1. gumroad.com → Sign up → new product → digital product → upload, paste copy, $9.
2. Complete payout settings immediately; don't let a balance accumulate (see research: verified suspension/frozen-payout reports). Treat Gumroad as a marketing surface — Discover traffic — not the money store.

### Step 4 — Point traffic at it (day 1, ~15 min)
1. Merge this branch so the README store section goes live on your GitHub profile.
2. Post the launch where developers already know you:
   - A "building in public" thread: what you built, one screenshot of a guide page, the free Git Rescue Kit link first, paid guide second. The free→paid funnel converts better than leading with the sale.
   - Dev.to / Hashnode post: publish Chapter 4 (discriminated unions) as a free article ending with the guide link.
   - Add the Ko-fi link to your GitHub profile sidebar (Settings → Profile → Website).
3. In every open-source PR/issue interaction, your GitHub profile IS the funnel — the README does the selling; don't spam maintainers.

## Honest expectations (from the research)

- The verified comp: a plain 27-page Git PDF did **105 sales / $734** on Gumroad — but over months, with an audience. Day-1 revenue with zero audience is typically **$0–$30**; the setup you're launching today is the asset that compounds.
- What moves the needle in week 1: the free lead magnet getting shared (Reddit r/git, r/typescript allow useful free resources; read each sub's self-promo rules first), and one good written post.
- Iterate: if the free kit gets downloads but the guide doesn't sell, the price isn't the problem — the description is. If neither moves, distribution is the problem, not the product.

## Rebuilding after edits

```bash
cd store && ./build.sh   # re-renders both PDFs and both covers
```
