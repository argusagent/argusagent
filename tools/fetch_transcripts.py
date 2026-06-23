import json, time, os, urllib.request, ssl, re
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
            url=base + ("&" if "?" in base else "?") + "fmt=json3"
            raw=http_get(url)
            lines=parse_json3(raw)
            if not lines:
                # try without fmt (xml) fallback
                raw2=http_get(base)
                # parse xml
                txts=re.findall(r"<text[^>]*>(.*?)</text>",raw2.decode("utf-8","replace"),re.S)
                import html
                lines=[(0,html.unescape(re.sub("<[^>]+>","",t)).strip()) for t in txts if t.strip()]
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
