from invoke import *
import time,subprocess,hashlib
invoke('update-settings','directMediaEngine','ffmpeg')
def start(url,title,quality='360'):
 r=invoke('start-download',{'url':url,'title':title,'format':'video','quality':quality,'mediaType':'hls','forceNew':True});assert 'data' in r,r
 return r['data']['id']
def wait(tid,timeout=22):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  r=next(r for r in invoke('get-downloads')['data'] if r['id']==tid)
  if r['status'] in ['error','cancelled','complete']:return r
  time.sleep(.1)
 raise AssertionError('task did not settle '+tid)
def events(tid):
 return [x['args'][0] for line in (ROOT/'events.jsonl').read_text().splitlines() if (x:=json.loads(line)).get('channel')=='download-progress' and x['args'][0].get('id')==tid]
missing=start(BASE+'/media/hls/master.m3u8','review-missing-rendition','240')
r=wait(missing);assert r['status']=='error' and '240p' in r['error'],r
assert any(e['status']=='error' and '240p' in e['error'] for e in events(missing)),events(missing)
port=json.loads((ROOT/'probe-server.json').read_text())['port'];url=f'http://127.0.0.1:{port}/stall.m3u8'
cancelled=start(url,'review-cancel-probe');time.sleep(.3)
assert invoke('cancel-download',cancelled)['cancelled'];r=wait(cancelled);assert r['status']=='cancelled',r
timedout=start(url,'review-timeout-probe');began=time.monotonic();r=wait(timedout)
assert r['status']=='error' and 'timed out' in r['error'],r
elapsed=time.monotonic()-began
assert any(e['status']=='error' and 'timed out' in e['error'] for e in events(timedout))
# After both cancellation and timeout, the next real media task can claim the only slot.
follow=start(BASE+'/media/hls/master.m3u8','review-followup');r=wait(follow);assert r['status']=='complete',r
ff=Path('/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64/ffmpeg')
probe=json.loads(subprocess.check_output([str(ff.with_name('ffprobe')),'-v','error','-show_streams','-of','json',r['filePath']]))
assert [s['height'] for s in probe['streams'] if s['codec_type']=='video']==[360],probe
subprocess.run([str(ff),'-v','error','-xerror','-i',r['filePath'],'-f','null','-'],capture_output=True,check=True)
# Final observation: cancelling a pending probe never emits a later error or completion.
assert not [e for e in events(cancelled) if e['status'] in ['complete','error']],events(cancelled)
report={'status':'PASS','no_match':{'id':missing,'event':'error'},'cancel':{'id':cancelled,'status':'cancelled'},'timeout':{'id':timedout,'elapsed_seconds':elapsed,'event':'error'},'followup':{'id':follow,'height':360,'full_decode':'PASS'}}
(ROOT/'probe-error-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
repo=Path('/Users/mingjie/Documents/github/personal-projects/v-download')
paths=[repo/'out/main/index.js',repo/'out/preload/index.js',*sorted((repo/'out/renderer/assets').iterdir()),ff,ff.with_name('ffprobe'),ff.with_name('yt-dlp')]
(ROOT/'final-build-digests.json').write_text(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},indent=2))
