from invoke import *
import time,subprocess,sqlite3
FF='/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64/ffmpeg'
PROBE=FF.replace('ffmpeg','ffprobe')
results=json.loads((ROOT/'media-results.json').read_text())
def wait_task(tid):
 for _ in range(1000):
  row=next(x for x in invoke('get-downloads')['data'] if x['id']==tid)
  if row['status'] in ['error','complete','paused','cancelled']:return row
  time.sleep(.2)
 raise RuntimeError('timed out '+tid)
def probe(path):
 return json.loads(subprocess.check_output([PROBE,'-v','error','-show_streams','-show_chapters','-show_format','-of','json',path]))
def run(engine,route,media,quality,expected_height,format='video',name=None):
 invoke('update-settings','directMediaEngine',engine)
 title=name or f'{engine}-{media}-{quality}'
 response=invoke('start-download',{'url':BASE+route,'title':title,'format':format,'quality':str(quality),'mediaType':media,'forceNew':True})
 assert 'data' in response,response
 row=wait_task(response['data']['id'])
 result={'name':title,'engine':engine,'route':route,'quality':quality,'id':row['id'],'status':row['status'],'error':row.get('error'),'file':row.get('filePath')}
 if expected_height is not None:
  assert row['status']=='complete',row
  metadata=probe(row['filePath']); result['streams']=[{k:s.get(k) for k in ['codec_type','codec_name','height','tags']} for s in metadata['streams']];result['chapters']=metadata['chapters'];result['duration']=metadata['format']['duration']
  if expected_height>0:assert [s['height'] for s in metadata['streams'] if s['codec_type']=='video']==[expected_height],result
  if expected_height==0:assert not any(s['codec_type']=='video' for s in metadata['streams']),result
  subprocess.run([FF,'-v','error','-xerror','-i',row['filePath'],'-map','0:v?','-map','0:a?','-f','null','-'],check=True,capture_output=True)
  result['full_decode']='PASS'
 else:assert row['status']=='error',row
 results.append(result)
 (ROOT/'media-results.json').write_text(json.dumps(results,indent=2))
 print(title,row['status'],expected_height,flush=True)
 return row
if __name__ == '__main__':
 for engine in ['auto','ffmpeg','ytdlp']:
  for media,route in [('hls','/media/hls/master.m3u8'),('dash','/media/dash/manifest.mpd')]:
   for quality,height in [('360',360),('best',720)]:run(engine,route,media,quality,height)
   run(engine,route,media,'240',None)
 for engine in ['auto','ffmpeg','ytdlp']:
  row=run(engine,'/annotated.mp4','mp4','360',720,name=engine+'-annotated')
  metadata=probe(row['filePath'])
  assert [(s['codec_name'],s.get('tags',{}).get('language')) for s in metadata['streams'] if s['codec_type']=='subtitle']==[('mov_text','eng')],metadata
  assert len(metadata['chapters'])==3,metadata
  text=subprocess.check_output([FF,'-v','error','-i',row['filePath'],'-map','0:s:0','-f','srt','-']).decode()
  expected=subprocess.check_output([FF,'-v','error','-i',str(ROOT.parent/'runtime/fixtures/media/sample-annotated.mp4'),'-map','0:s:0','-f','srt','-']).decode()
  assert text==expected,(text,expected)
 run('ffmpeg','/direct.mp4','mp4','360',720,name='plain-av')
 run('ffmpeg','/direct.mp4','mp4','128',0,format='mp3',name='plain-mp3')
 # Real IPC boundary: empty/stale/malformed input cannot act as a global retry.
 before={r['id']:r['status'] for r in invoke('get-downloads')['data'] if r['id'].startswith('hist-')}
 for value in [[],['missing','hist-error-1','hist-paused','hist-cancelled','hist-complete']]:
  assert invoke('resume-session-interrupted',value)=={'ok':True,'resumedIds':[]}
 for value in [None,'all',[1],['']]:assert invoke('resume-session-interrupted',value)['ok']==False
 assert before=={r['id']:r['status'] for r in invoke('get-downloads')['data'] if r['id'].startswith('hist-')}
 (ROOT/'scope-boundary-result.json').write_text(json.dumps({'status':'PASS','preserved':before},indent=2))
 print('media and scoped resume integration PASS',flush=True)
