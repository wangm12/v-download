from client import *
base={'version':1,'target':'video','maxHeight':360,'videoCodec':'h264','maxFps':30,'dynamicRange':'any','output':'original','postprocess':'none'}
plan={'id':'regression:30fps','name':'30 fps batch','revision':1,'selection':base,'includeNote':False,'filenameTemplate':'{title} [{id}]'}
r=invoke('mutate-download-plan',{'action':'save','plan':plan,'expectedRevision':0});assert r.get('data'),r
listing=invoke('list-playlist-entries',BASE+'/collection?run=2')['data']
entries=listing['items'];assert len(entries)==2,listing
# A slow owned task holds the individual slot while the selected requests are admitted.
block=invoke('start-download',{'url':BASE+'/slow.mp4?block=snapshot','title':'snapshot blocker','format':'video','mediaType':'mp4','forceNew':True})['data']['id']
batch=[{'url':e['pageUrl'],'title':e['title'],'format':'video','planId':plan['id'],'planRevision':1,'playlistId':'snapshot-test','playlistTitle':'Snapshot test','playlistIndex':e['playlistIndex'],'entryIndex':e['playlistIndex'],'metadata':{'ytdlpId':e['id']}} for e in entries]
r=invoke('start-downloads-bulk',batch);assert r.get('data',{}).get('count')==2,r
ids=r['data']['ids'];assert len(set(ids))==2,ids
before=[next(t for t in tasks() if t['id']==tid) for tid in ids]
assert [x['metadata']['downloadRequest']['entryIndex'] for x in before]==[1,2],before
# Mutate, rename, then delete the plan before at least the queued collection is started.
changed={**plan,'name':'changed after enqueue','selection':{**base,'maxFps':60}}
r=invoke('mutate-download-plan',{'action':'save','plan':changed,'expectedRevision':1});assert r.get('data'),r
r=invoke('mutate-download-plan',{'action':'delete','id':plan['id'],'expectedRevision':2});assert r.get('data'),r
invoke('cancel-download',block)
results=[]
for tid in ids:
 task=wait(tid);assert task['status']=='complete',task
 snapshot=task['metadata']['downloadRequest'];assert snapshot['selection']['maxFps']==30 and snapshot['plan']['revision']==1,snapshot
 m=probe(task['filePath']);v=next(s for s in m['streams'] if s['codec_type']=='video');n,d=map(float,v['r_frame_rate'].split('/'));assert v['height']==360 and round(n/d)==30,m
 decode(task['filePath']);results.append({'id':tid,'entryIndex':snapshot['entryIndex'],'fps':30,'height':360,'plan_revision':1,'decode':'PASS'})
(ROOT/'collection-snapshot-results.json').write_text(json.dumps(results,indent=2));print(results,flush=True)
# Native collection follows the same selection and conversion publication pipeline.
r=invoke('start-download',{'url':BASE+'/collection?list=native&run=2','title':'Native compatible collection','format':'video','planId':'builtin:compatible','planRevision':1,'playlistId':'native-compatible','metadata':{'nativeYoutubePlaylist':True},'isPlaylist':True})
assert 'data' in r,r
row=wait(r['data']['id']);assert row['status']=='complete',row
c=sqlite3.connect('file:'+str(ROOT/'profile/downloads.db')+'?mode=ro',uri=True)
extras=json.loads(c.execute('select extras from downloads where id=?',(row['id'],)).fetchone()[0]);paths=[entry['destinationPath'] for entry in extras.get('nativePlaylistPublishJournal',[])]
assert len(paths)==2,extras
for file in paths:
 file=str(Path(row['filePath'])/file) if not Path(file).is_absolute() else file
 m=probe(file);assert any(s['codec_type']=='video' and s['codec_name']=='h264' for s in m['streams']),m;decode(file)
(ROOT/'native-collection-results.json').write_text(json.dumps({'id':row['id'],'files':paths,'decode':'PASS'},indent=2));print('native collection PASS',flush=True)
