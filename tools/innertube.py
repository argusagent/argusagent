import json, urllib.request, ssl, os, time

PROXY = os.environ.get("HTTPS_PROXY")
KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
CTX = {"client": {"clientName": "WEB", "clientVersion": "2.20240726.00.00", "hl":"en","gl":"US"}}
_ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
_opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({"https": PROXY}),
    urllib.request.HTTPSHandler(context=_ctx))

def post(path, body, retries=4):
    url = f"https://youtubei.googleapis.com/youtubei/v1/{path}?key={KEY}&prettyPrint=false"
    data = json.dumps(body).encode()
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data,
                headers={"Content-Type":"application/json","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with _opener.open(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i==retries-1: raise
            time.sleep(2**i)

def walk_find(o, key, out):
    if isinstance(o,dict):
        if key in o: out.append(o[key])
        for v in o.values(): walk_find(v,key,out)
    elif isinstance(o,list):
        for x in o: walk_find(x,key,out)

def extract_videos(res):
    lvs=[]; walk_find(res,"lockupViewModel",lvs)
    vids=[]
    for lv in lvs:
        if lv.get("contentType")!="LOCKUP_CONTENT_TYPE_VIDEO": continue
        vid=lv.get("contentId")
        mt=lv.get("metadata",{}).get("lockupMetadataViewModel",{})
        title=mt.get("title",{}).get("content","")
        rel=""
        try:
            rows=mt["metadata"]["contentMetadataViewModel"]["metadataRows"]
            parts=[p.get("text",{}).get("content","") for row in rows for p in row.get("metadataParts",[])]
            rel=" | ".join(p for p in parts if p)
        except Exception: pass
        vids.append({"videoId":vid,"title":title,"meta":rel})
    return vids

def get_continuation(res):
    toks=[]; walk_find(res,"continuationItemRenderer",toks)
    for t in toks:
        tok=t.get("continuationEndpoint",{}).get("continuationCommand",{}).get("token")
        if tok: return tok
    return None

if __name__=="__main__":
    ch="UCqm9Z0DfGXZ8oMF70ic3B1A"
    res=post("browse",{"context":CTX,"browseId":ch,"params":"EgZ2aWRlb3PyBgQKAjoA"})
    allv=[]; seen=set()
    def add(vs):
        for v in vs:
            if v["videoId"] and v["videoId"] not in seen:
                seen.add(v["videoId"]); allv.append(v)
    add(extract_videos(res))
    tok=get_continuation(res)
    page=1
    while tok:
        page+=1
        res=post("browse",{"context":CTX,"continuation":tok})
        new=extract_videos(res)
        add(new)
        ntok=get_continuation(res)
        print(f"page {page}: +{len(new)} total={len(allv)}")
        if ntok==tok: break
        tok=ntok
    print("TOTAL VIDEOS (Videos tab):", len(allv))
    json.dump(allv, open("videos_list.json","w"), indent=1)
