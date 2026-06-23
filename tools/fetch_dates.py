import json, time, os
from innertube import post
b=post("browse",{"context":{"client":{"clientName":"WEB","clientVersion":"2.20240726.00.00","hl":"en"}},"browseId":"UCqm9Z0DfGXZ8oMF70ic3B1A","params":"EgZ2aWRlb3PyBgQKAjoA"})
VD=b["responseContext"]["visitorData"]
def webplayer(vid):
    return post("player",{"context":{"client":{"clientName":"WEB","clientVersion":"2.20240726.00.00","hl":"en","gl":"US","visitorData":VD}},"videoId":vid,"contentCheckOk":True,"racyCheckOk":True})
meta=json.load(open("metadata.json"))
dates={}
if os.path.exists("dates.json"): dates=json.load(open("dates.json"))
for i,m in enumerate(meta):
    vid=m["videoId"]
    if vid in dates and dates[vid].get("publishDate"): continue
    rec={}
    for a in range(4):
        try:
            p=webplayer(vid)
            mf=p.get("microformat",{}).get("playerMicroformatRenderer",{})
            rec["publishDate"]=mf.get("publishDate"); rec["uploadDate"]=mf.get("uploadDate")
            rec["title_mf"]=(mf.get("title",{}) or {}).get("simpleText") or "".join(r.get("text","") for r in (mf.get("title",{}) or {}).get("runs",[]))
            rec["lengthMf"]=mf.get("lengthSeconds"); rec["category"]=mf.get("category")
            rec["ownerName"]=mf.get("ownerChannelName")
            break
        except Exception as e:
            if a==3: rec["date_error"]=repr(e)[:100]
            else: time.sleep(2**a)
    dates[vid]=rec
    if (i+1)%20==0:
        json.dump(dates,open("dates.json","w")); print(f"{i+1}/{len(meta)}",flush=True)
json.dump(dates,open("dates.json","w"))
got=sum(1 for r in dates.values() if r.get("publishDate"))
print(f"DONE dates: {got}/{len(meta)} have publishDate; errors {sum(1 for r in dates.values() if r.get('date_error'))}")
