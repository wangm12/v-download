from client import *
policy={'version':1,'target':'video','maxHeight':360,'videoCodec':'any','dynamicRange':'any','output':'original','postprocess':'none'}
results=[]
def rejected(label,options):
 before=len(tasks());r=invoke('start-download',options);assert r.get('error'),r;assert len(tasks())==before;results.append({'case':label,'result':'rejected before admission','reason':r['error']})
rejected('missing plan',{'url':BASE+'/direct.mp4?negative=missing','planId':'removed:plan','format':'video'})
rejected('stale revision',{'url':BASE+'/direct.mp4?negative=stale','planId':'builtin:audio','planRevision':2,'format':'video'})
rejected('wrong source exact ID',{'url':BASE+'/direct.mp4?negative=wrong','selection':{**policy,'exact':{'sourceUrl':BASE+'/watch/precision','formatId':'hls-400','kind':'muxed'}},'format':'video'})
for name,url,s in [
 ('height',BASE+'/direct.mp4?negative=height',{**policy,'maxHeight':240}),
 ('fps',BASE+'/media/sample-360-60.mp4?negative=fps',{**policy,'maxFps':30}),
 ('codec',BASE+'/direct.mp4?negative=codec',{**policy,'maxHeight':1080,'videoCodec':'av1'}),
 ('exact-missing',BASE+'/watch/precision?negative=exact',{**policy,'exact':{'sourceUrl':BASE+'/watch/precision?negative=exact','formatId':'missing-format','kind':'muxed'}}),
 ('HDR-unknown',BASE+'/direct.mp4?negative=hdr',{**policy,'maxHeight':1080,'dynamicRange':'hdr'})]:
 r=invoke('start-download',{'url':url,'title':'Negative '+name,'format':'video','selection':s});assert r.get('data'),r;row=wait(r['data']['id']);assert row['status']=='error' and not row['filePath'],{k:row.get(k) for k in ['id','status','error','filePath']};results.append({'case':name,'id':row['id'],'result':'no final output','reason':row['error']})
# Both engine adapters enforce the same selection for a multi-rendition HLS source.
r=invoke('update-settings','directMediaEngine','ffmpeg');assert r.get('ok'),r
r=invoke('start-download',{'url':BASE+'/media/fps-master.m3u8?engine=ffmpeg','title':'FFmpeg shared 360p 30fps','format':'video','mediaType':'hls','selection':{**policy,'videoCodec':'h264','maxFps':30}});assert r.get('data'),r;row=wait(r['data']['id']);assert row['status']=='complete',{k:row.get(k) for k in ['status','error']};m=probe(row['filePath']);v=next(s for s in m['streams'] if s['codec_type']=='video');assert v['height']==360 and v['r_frame_rate']=='30/1';decode(row['filePath']);results.append({'case':'FFmpeg selected rendition','id':row['id'],'height':360,'fps':30,'decode':'PASS'})
invoke('update-settings','directMediaEngine','auto')
# Cancellation after conversion begins must not publish a completed file or poison the next queue slot.
eventOffset=len((ROOT/'events.jsonl').read_text().splitlines())
r=invoke('start-download',{'url':BASE+'/direct.mp4?negative=cancel','title':'Cancel compatibility conversion','format':'video','planId':'builtin:compatible'});tid=r['data']['id'];deadline=time.monotonic()+30;phase=False
while time.monotonic()<deadline:
 events=[json.loads(line) for line in (ROOT/'events.jsonl').read_text().splitlines()[eventOffset:]]
 if any(e.get('channel')=='download-progress' and e['args'][0].get('id')==tid and e['args'][0].get('phase')=='transcoding' for e in events):
  phase=True;invoke('cancel-download',tid);break
 time.sleep(.01)
assert phase,'conversion phase not observed'
row=wait(tid);time.sleep(.7);row=next(r for r in tasks() if r['id']==tid);assert row['status']=='cancelled' and not row['filePath'],row
r=invoke('start-download',{'url':BASE+'/direct.mp4?negative=after-cancel','title':'Queue after conversion cancellation','format':'audio','planId':'builtin:audio'});row=wait(r['data']['id']);assert row['status']=='complete';decode(row['filePath']);results.append({'case':'conversion cancellation + next task','cancelledId':tid,'nextId':row['id'],'result':'PASS'})
(ROOT/'negative-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
