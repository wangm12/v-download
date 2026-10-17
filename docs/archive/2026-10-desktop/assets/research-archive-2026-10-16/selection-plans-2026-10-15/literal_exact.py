from client import *
policy={'version':1,'target':'video','maxHeight':360,'videoCodec':'h264','maxFps':30,'dynamicRange':'any','output':'original','postprocess':'none'}
results=[]
for name,path,exact,fps in [('numeric-pair','/watch/dash?exact=literal-final',{'formatId':'1','audioFormatId':'2','kind':'video'},30),('hls30','/watch/precision?exact=literal-final30',{'formatId':'hls-400','kind':'muxed'},30),('hls60','/watch/precision?exact=literal-final60',{'formatId':'hls-800','kind':'muxed'},60),('reserved-best','/watch/precision?exact=literal-best',{'formatId':'best','kind':'muxed'},30)]:
 url=BASE+path;selection={**policy,'maxFps':fps,'exact':{'sourceUrl':url,**exact}}
 r=invoke('start-download',{'url':url,'title':'Literal exact '+name,'format':'video','selection':selection});assert r.get('data'),r;row=wait(r['data']['id'])
 if name=='reserved-best':
  assert row['status']=='error' and not row['filePath'],row;results.append({'case':name,'id':row['id'],'result':'literal ID absent; no automatic fallback'});continue
 assert row['status']=='complete',{k:row.get(k) for k in ['id','status','error']};m=probe(row['filePath']);v=next(s for s in m['streams'] if s['codec_type']=='video');assert v['height']==360 and v['r_frame_rate']==str(fps)+'/1';assert any(s['codec_type']=='audio' for s in m['streams']);decode(row['filePath']);results.append({'case':name,'id':row['id'],'height':360,'fps':fps,'audio':True,'decode':'PASS'})
(ROOT/'literal-exact-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
