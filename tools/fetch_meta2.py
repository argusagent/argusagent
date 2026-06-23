import json, time, os
from innertube import post
def get_visitor():
    b=post("browse",{"context":{"client":{"clientName":"WEB","clientVersion":"2.20240726.00.00","hl":"en"}},"browseId":"UCqm9Z0DfGXZ8oMF70ic3B1A","params":"EgZ2aWRlb3PyBgQKAjoA"})
    return b["responseContext"]["visitorData"]
VD=get_visitor()
def player(vid):
    cl={"clientName":"ANDROID_VR","clientVersion":"1.60.19","androidSdkVersion":32,"hl":"en","gl":"US","visitorData":VD}
    return post("player",{"context":{"client":cl},"videoId":vid,"contentCheckOk":True,"racyCheckOk":True})
master=json.load(open("master_videos.json"))
done={}
if os.path.exists("metadata.json"):
    for r in json.load(open("metadata.json")):
        if r.get("playability") or r.get("error"): done[r["videoId"]]=r
out=[]
for i,m in enumerate(master):
    vid=m["videoId"]
    if vid in done and done[vid].get("playability"):
        out.append(done[vid]); continue
    rec=dict(m)
    for attempt in range(4):
        try:
            r=player(vid); st=r.get("playabilityStatus",{})
            rec["playability"]=st.get("status"); rec["playability_reason"]=st.get("reason")
            vd=r.get("videoDetails",{})
            rec["title"]=vd.get("title") or rec["title"]
            rec["lengthSeconds"]=vd.get("lengthSeconds"); rec["isLive"]=vd.get("isLiveContent"); rec["viewCount"]=vd.get("viewCount")
            mf=r.get("microformat",{}).get("playerMicroformatRenderer",{})
            rec["publishDate"]=mf.get("publishDate"); rec["uploadDate"]=mf.get("uploadDate"); rec["category"]=mf.get("category"); rec["lengthMf"]=mf.get("lengthSeconds")
            ct=r.get("captions",{}).get("playerCaptionsTracklistRenderer",{}).get("captionTracks",[])
            rec["captions"]=[{"lang":c.get("languageCode"),"name":(c.get("name",{}) or {}).get("simpleText") or (c.get("name",{}) or {}).get("runs",[{}])[0].get("text",""),"kind":c.get("kind","manual"),"baseUrl":c.get("baseUrl")} for c in ct]
            rec.pop("error",None); break
        except Exception as e:
            if attempt==3: rec["error"]=repr(e)[:120]
            else: time.sleep(2**attempt)
    out.append(rec)
    json.dump(out,open("metadata.json","w"),indent=1)
ok=sum(1 for r in out if r.get("playability")=="OK")
withcap=sum(1 for r in out if r.get("captions"))
err=sum(1 for r in out if r.get("error"))
print(f"TOTAL {len(out)} | OK {ok} | with captions {withcap} | errors {err}")
