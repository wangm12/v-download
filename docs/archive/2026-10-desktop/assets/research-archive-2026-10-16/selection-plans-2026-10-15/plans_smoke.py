from client import *
results=[]
for planId,path,codec,format in [('builtin:compatible','/media/sample-hevc.mp4','h264','video'),('builtin:audio','/direct.mp4','mp3','audio')]:
 result=invoke('start-download',{'url':BASE+path,'title':planId.split(':')[-1]+' smoke','format':format,'planId':planId,'planRevision':1})
 assert 'data' in result,result
 row=wait(result['data']['id']);assert row['status']=='complete',row
 meta=probe(row['filePath']);streams=meta['streams'];expected='video' if format=='video' else 'audio'
 assert any(s['codec_type']==expected and s['codec_name']==codec for s in streams),meta
 if expected=='audio':assert not any(s['codec_type']=='video' for s in streams)
 decode(row['filePath']);results.append({'plan':planId,'id':row['id'],'file':row['filePath'],'codec':codec,'decode':'PASS'})
 print(planId,'PASS',flush=True)
(ROOT/'plans-smoke-results.json').write_text(json.dumps(results,indent=2))
