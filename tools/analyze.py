#!/usr/bin/env python3
"""Extract ticker/company mentions and macro themes from the transcript archive,
aggregate over time, to ground the written ANALYSIS.md. Read-only over transcripts/."""
import json, os, re
from collections import Counter, defaultdict

ARCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "transcripts")
mani = json.load(open(os.path.join(ARCH, "manifest.json")))

# name/alias -> canonical "TICKER Name". Word-boundary, case-insensitive matching.
COMPANIES = {
    "NVDA": ["nvidia", "nvda"],
    "TSLA": ["tesla", "tsla"],
    "AAPL": ["apple", "aapl"],
    "MSFT": ["microsoft", "msft"],
    "GOOGL": ["google", "alphabet", "googl"],
    "AMZN": ["amazon", "amzn"],
    "META": ["meta", "facebook"],
    "AVGO": ["broadcom", "avgo"],
    "AMD": ["amd", "advanced micro"],
    "SMCI": ["super micro", "supermicro", "smci"],
    "PLTR": ["palantir", "pltr"],
    "COST": ["costco", "cost"],
    "WMT": ["walmart", "wmt"],
    "NFLX": ["netflix", "nflx"],
    "ASML": ["asml"],
    "TSM": ["taiwan semi", "tsmc", "tsm"],
    "MU": ["micron"],
    "QCOM": ["qualcomm"],
    "ARM": ["arm holdings"],
    "MRVL": ["marvell"],
    "DELL": ["dell"],
    "ORCL": ["oracle"],
    "CRM": ["salesforce"],
    "ADBE": ["adobe"],
    "JPM": ["jpmorgan", "jp morgan", "jamie dimon"],
    "GS": ["goldman sachs", "goldman"],
    "BAC": ["bank of america"],
    "VST": ["vistra"],
    "CEG": ["constellation energy"],
    "GEV": ["ge vernova"],
    "ETN": ["eaton"],
    "NEE": ["nextera"],
    "LLY": ["eli lilly", "lilly"],
    "NVO": ["novo nordisk"],
    "UNH": ["unitedhealth"],
    "BKNG": ["booking"],
    "AXON": ["axon"],
    "ANET": ["arista"],
    "VRT": ["vertiv"],
    "CDNS": ["cadence"],
    "SNPS": ["synopsys"],
    "PANW": ["palo alto"],
    "FTNT": ["fortinet"],
    "CRWD": ["crowdstrike"],
    "NOW": ["servicenow"],
    "UBER": ["uber"],
    "ABNB": ["airbnb"],
    "COIN": ["coinbase"],
    "MSTR": ["microstrategy", "strategy "],
    "HOOD": ["robinhood"],
    "RKLB": ["rocket lab", "rklb"],
    "SMR": ["nuscale"],
    "OKLO": ["oklo"],
    "IBM": ["ibm"],
    "INTC": ["intel"],
    "MCD": ["mcdonald"],
    "SBUX": ["starbucks"],
    "NKE": ["nike"],
    "DIS": ["disney"],
    "BA": ["boeing"],
    "CAT": ["caterpillar"],
    "DE": ["deere"],
    "XOM": ["exxon"],
    "CVX": ["chevron"],
    "LMT": ["lockheed"],
    "GE": ["ge aerospace", "general electric"],
}

THEMES = {
    "Fed / rate policy": ["federal reserve", "the fed ", "jerome powell", "powell", "rate cut", "rate hike", "fomc", "interest rate", "basis point"],
    "Inflation (CPI/PPI)": ["inflation", "cpi", "ppi", "pce", "consumer price", "producer price", "deflation"],
    "Tariffs / trade": ["tariff", "trade war", "trade deal", "liberation day"],
    "AI boom": ["artificial intelligence", " ai ", "ai boom", "ai infrastructure", "data center", "data centers", "chatgpt", "deepseek"],
    "Earnings season": ["earnings season", "earnings report", "quarterly earnings", "beat estimates", "guidance"],
    "Treasury yields / bonds": ["treasury yield", "10-year", "ten-year", "bond vigilante", "yield curve", "bond market"],
    "Recession risk": ["recession", "soft landing", "hard landing", "yield curve invert"],
    "Trump / politics": ["trump", "white house", "biden", "election", "congress", "tax bill"],
    "Energy / power / nuclear": ["nuclear", "power demand", "electricity", "natural gas", "oil price"],
    "Crypto / bitcoin": ["bitcoin", "crypto", "ethereum"],
    "Jobs / labor": ["jobs report", "unemployment", "payroll", "nonfarm", "labor market"],
    "Quantum computing": ["quantum"],
    "China": ["china", "chinese", "beijing"],
    "Gold / safe haven": ["gold ", "safe haven"],
}

def qtr(d):
    y, m = int(d[:4]), int(d[5:7])
    return f"{y}Q{(m-1)//3+1}"

def body_of(m):
    txt = open(os.path.join(ARCH, m["file"]), encoding="utf-8").read()
    return txt.split("=" * 60, 1)[1].lower()

# Build per-video lowercased text once
videos = []
for m in mani:
    if m["transcriptStatus"] != "success":
        continue
    videos.append((m["uploadDate"], qtr(m["uploadDate"]), body_of(m)))

quarters = sorted({v[1] for v in videos})

# company mentions
comp_total = Counter()
comp_q = defaultdict(Counter)          # ticker -> {quarter: docfreq}
comp_docs = Counter()                  # ticker -> num videos mentioning
for date, q, text in videos:
    for tk, aliases in COMPANIES.items():
        n = sum(len(re.findall(r"\b" + re.escape(a) + r"\b", text)) for a in aliases)
        if n:
            comp_total[tk] += n
            comp_docs[tk] += 1
            comp_q[tk][q] += 1

theme_q = defaultdict(Counter)         # theme -> {quarter: docfreq}
theme_docs = Counter()
for date, q, text in videos:
    for th, kws in THEMES.items():
        if any(k in text for k in kws):
            theme_docs[th] += 1
            theme_q[th][q] += 1

print("=== VIDEOS ANALYZED:", len(videos), "===")
print("\n=== TOP COMPANIES (by total mentions | videos mentioning) ===")
for tk, n in comp_total.most_common(45):
    print(f"{tk:6} {n:5}  in {comp_docs[tk]:3} videos")

print("\n=== THEME PREVALENCE (videos mentioning) ===")
for th, n in theme_docs.most_common():
    print(f"{n:4}  {th}")

print("\n=== QUARTERLY company doc-frequency (top 14 tickers) ===")
top = [tk for tk, _ in comp_total.most_common(14)]
print("ticker | " + " ".join(f"{q[2:]:>5}" for q in quarters))
for tk in top:
    print(f"{tk:6} | " + " ".join(f"{comp_q[tk].get(q,0):>5}" for q in quarters))

print("\n=== QUARTERLY theme doc-frequency ===")
print("theme".ljust(26) + "| " + " ".join(f"{q[2:]:>5}" for q in quarters))
for th in THEMES:
    print(th[:25].ljust(26) + "| " + " ".join(f"{theme_q[th].get(q,0):>5}" for q in quarters))

json.dump({
    "videos_analyzed": len(videos),
    "company_total": comp_total, "company_docs": comp_docs,
    "company_quarterly": {k: dict(v) for k, v in comp_q.items()},
    "theme_docs": theme_docs,
    "theme_quarterly": {k: dict(v) for k, v in theme_q.items()},
    "quarters": quarters,
}, open(os.path.join(os.path.dirname(__file__), "analysis_data.json"), "w"), indent=1)
