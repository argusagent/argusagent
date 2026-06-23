import json, time, os, urllib.request, ssl, re, html
import xml.etree.ElementTree as ET
from innertube import post
PROXY=os.environ.get("HTTPS_PROXY")
_ctx=ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
_op=urllib.request.build_opener(urllib.request.ProxyHandler({"https":PROXY}),urllib.request.HTTPSHandler(context=_ctx))

def get_visitor():
    b=post("browse",{"context":{"client":{"clientName":"WEB","clientVersion":"2.20240726.00.00","hl":"en"}},"browseId":"UCqm9Z0DfGXZ8oMF70ic3B1A","params":"EgZ2aWRlb3PyBgQKAjoA"})
    return b["responseContext"]["visitorData"]
VD=get_visitor()
def player(vid):
    cl={"clientName":"ANDROID_VR","clientVersion":"1.60.19","androidSdkVersion":32,"hl":"en","gl":"US","visitorData":VD}
    return post("player",{"context":{"client":cl},"videoId":vid,"contentCheckOk":True,"racyCheckOk":True})

def http_get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
    with _op.open(req,timeout=40) as r: return r.read()

def pick_track(tracks):
    # prefer manual english, then asr english, then any english, then first
    def score(t):
        lang=(t.get("languageCode") or "")
        manual = t.get("kind")!="asr"
        eng = lang.startswith("en")
        return (eng, manual)
    return sorted(tracks,key=score,reverse=True)[0] if tracks else None

def parse_json3(raw):
    data=json.loads(raw)
    events=data.get("events",[])
    lines=[]
    for ev in events:
        segs=ev.get("segs")
        if not segs: continue
        txt="".join(s.get("utf8","") for s in segs)
        txt=txt.strip("\n")
        if not txt.strip(): continue
        t=ev.get("tStartMs",0)
        lines.append((t,txt))
    return lines

def parse_timedtext_xml(raw):
    """Parse the timedtext 'format=3' XML (<p t=..><s>word</s>..) and the older
    srv1 (<text start=..>..) layouts. Returns [(start_ms, text), ...]."""
    root=ET.fromstring(raw)
    lines=[]
    # format=3: <body><p t=".." d=".."><s>..</s>..</p>
    body=root.find("body")
    ps = body.findall("p") if body is not None else []
    for p in ps:
        try: t=int(p.get("t","0"))
        except ValueError: t=0
        parts=[]
        if p.text: parts.append(p.text)
        for s in p:
            if s.text: parts.append(s.text)
            if s.tail: parts.append(s.tail)
        txt="".join(parts).strip()
        if txt: lines.append((t,txt))
    if lines: return lines
    # srv1: <transcript><text start="1.23" dur="..">..</text>
    for tx in root.findall(".//text"):
        try: t=int(float(tx.get("start","0"))*1000)
        except ValueError: t=0
        txt=html.unescape((tx.text or "").strip())
        if txt: lines.append((t,txt))
    return lines

def parse_captions(raw):
    """Try json3 first, then fall back to the XML timedtext formats."""
    head=raw[:64].lstrip()
    if head[:1] in (b"{", b"["):
        try:
            l=parse_json3(raw)
            if l: return l
        except Exception:
            pass
    try:
        return parse_timedtext_xml(raw)
    except Exception:
        return []

def main():
    meta=json.load(open("metadata.json"))
    results={}
    if os.path.exists("transcripts_raw.json"):
        results=json.load(open("transcripts_raw.json"))
    for i,m in enumerate(meta):
        vid=m["videoId"]
        if vid in results and results[vid].get("status") in ("success","no_captions"):
            continue
        rec={"videoId":vid}
        try:
            # fetch fresh player for current baseUrl
            r=player(vid)
            ct=r.get("captions",{}).get("playerCaptionsTracklistRenderer",{}).get("captionTracks",[])
            if not ct:
                rec["status"]="no_captions"; rec["reason"]="no caption tracks available"
                results[vid]=rec; continue
            track=pick_track(ct)
            base=track["baseUrl"]
            # Try json3 explicitly; the endpoint often still returns format=3 XML,
            # which parse_captions handles. Fall back to the raw baseUrl response.
            url=base + ("&" if "?" in base else "?") + "fmt=json3"
            raw=http_get(url)
            lines=parse_captions(raw)
            if not lines:
                raw2=http_get(base)
                lines=parse_captions(raw2)
            rec["status"]="success" if lines else "empty"
            rec["lang"]=track.get("languageCode")
            rec["kind"]=track.get("kind","manual")
            rec["lines"]=lines
            rec["n_lines"]=len(lines)
            rec["chars"]=sum(len(l[1]) for l in lines)
        except Exception as e:
            rec["status"]="error"; rec["reason"]=repr(e)[:150]
        results[vid]=rec
        if (i+1)%10==0:
            json.dump(results,open("transcripts_raw.json","w"))
            print(f"{i+1}/{len(meta)} | last {vid} {rec['status']}",flush=True)
    json.dump(results,open("transcripts_raw.json","w"))
    succ=sum(1 for r in results.values() if r["status"]=="success")
    print(f"DONE. success={succ} no_caption={sum(1 for r in results.values() if r['status']=='no_captions')} error={sum(1 for r in results.values() if r['status']=='error')}")

if __name__=="__main__":
    main()
