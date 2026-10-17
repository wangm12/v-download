from client import *
base={'version':1,'target':'video','maxHeight':360,'videoCodec':'h264','maxFps':30,'dynamicRange':'any','output':'original','postprocess':'none'}
results=[]
for fmt,fps in [('hls-400',30),('hls-800',60)]:
 selection={**base,'maxFps':fps,'exact':{'sourceUrl':BASE+'/watch/precision','formatId':fmt,'kind':'muxed'}}
 response=invoke('start-download',{'url':BASE+'/watch/precision','title':f'Exact-{fps}','format':'video','selection':selection})
 assert 'data' in response,response
 task=wait(response['data']['id']);assert task['status']=='complete',task
 metadata=probe(task['filePath']);v=next(s for s in metadata['streams'] if s['codec_type']=='video');n,d=map(float,v['r_frame_rate'].split('/'));assert v['height']==360 and round(n/d)==fps,metadata
 decode(task['filePath'])
 repeated=invoke('start-download',{'url':BASE+'/watch/precision','title':'Same choice','format':'video','selection':selection});assert repeated['outcome']=='focused' and repeated['data']['id']==task['id'],repeated
 results.append({'id':task['id'],'format_id':fmt,'height':360,'fps':fps,'decode':'PASS','duplicate':repeated['outcome']})
print(results,flush=True);(ROOT/'exact-results.json').write_text(json.dumps(results,indent=2))
