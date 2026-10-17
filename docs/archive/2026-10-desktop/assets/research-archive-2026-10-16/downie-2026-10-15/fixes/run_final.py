from run_media import *
import hashlib
results.clear()
# The final build changed probe supervision, so exercise both adapters again.
for engine in ['auto','ffmpeg','ytdlp']:
 for media,route in [('hls','/media/hls/master.m3u8'),('dash','/media/dash/manifest.mpd')]:
  run(engine,route,media,'360',360,name='final-'+engine+'-'+media+'-360')
row=run('ffmpeg','/annotated.mp4','mp4','360',720,name='final-annotated')
assert len(probe(row['filePath'])['chapters'])==3
row=run('ffmpeg','/media/sample-two-subs.mp4','mp4','360',720,name='final-two-subs')
subs=[s for s in probe(row['filePath'])['streams'] if s['codec_type']=='subtitle']
assert [s['tags']['language'] for s in subs]==['eng','zho'],subs
row=run('ffmpeg','/media/sample-srt.mkv','mkv','360',None,name='final-incompatible-forced')
assert 'codec' in row['error'].lower(),row
row=run('auto','/media/sample-srt.mkv','mkv','360',720,name='final-incompatible-auto')
assert len([s for s in probe(row['filePath'])['streams'] if s['codec_type']=='subtitle'])==1
assert Path(row['filePath']).suffix=='.mkv',row
run('ffmpeg','/direct.mp4','mp4','360',720,name='final-plain-av')
run('ffmpeg','/direct.mp4','mp4','128',0,format='mp3',name='final-plain-mp3')
# Cancellation while FFmpeg is reading, then retry on the original task ID.
invoke('update-settings','directMediaEngine','ffmpeg')
r=invoke('start-download',{'url':BASE+'/slow.mp4','title':'final-pause','format':'video','quality':'360','mediaType':'mp4','forceNew':True})
tid=r['data']['id'];time.sleep(.6)
assert invoke('pause-download',tid)['paused']
row=wait_task(tid);assert row['status']=='paused' and not row.get('filePath'),row
assert invoke('retry-download',tid)['retried'];row=wait_task(tid)
assert row['status']=='complete',row
meta=probe(row['filePath']);assert float(meta['format']['duration'])>=12,meta
subprocess.run([FF,'-v','error','-xerror','-i',row['filePath'],'-f','null','-'],capture_output=True,check=True)
(ROOT/'final-cancellation.json').write_text(json.dumps({'id':tid,'paused':True,'retried':'complete','full_decode':'PASS'},indent=2))
# The real source output used for this final run.
repo=Path('/Users/mingjie/Documents/github/personal-projects/v-download')
paths=[repo/'out/main/index.js',repo/'out/preload/index.js',*sorted((repo/'out/renderer/assets').iterdir()),Path(FF),Path(PROBE),Path(FF).with_name('yt-dlp')]
(ROOT/'final-build-digests.json').write_text(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},indent=2))
# UI test next uses Auto and a page not used by the earlier format-dialog run.
invoke('update-settings','directMediaEngine','auto')
print('final integration PASS',flush=True)
