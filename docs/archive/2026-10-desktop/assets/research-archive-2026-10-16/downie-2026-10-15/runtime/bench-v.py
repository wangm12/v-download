import json,time,pathlib,urllib.request,urllib.error,threading,subprocess,os,sys
ROOT=pathlib.Path(__file__).resolve().parent
BASE=json.loads((ROOT/'remote-api-address.json').read_text())['base_url']
TOKEN=json.loads((ROOT/'profile/settings.json').read_text())['remoteApiToken']
IDENTITY=json.loads((ROOT/'v-runtime-identity.json').read_text()) if (ROOT/'v-runtime-identity.json').exists() else {}
FFPROBE='/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64/ffprobe'

def request(method,path,body=None):
 data=None if body is None else json.dumps(body).encode()
 req=urllib.request.Request(BASE+path,data=data,method=method,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)

def seconds(s):
 parts=s.split(':');return sum(float(x)*60**i for i,x in enumerate(reversed(parts)))

class Sampler:
 def __init__(self):self.stop=threading.Event();self.samples=[];self.initial={};self.last={};self.thread=threading.Thread(target=self.run,daemon=True)
 def run(self):
  while not self.stop.is_set():
   t=time.monotonic();p=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss=,time=,lstart=,comm='],capture_output=True,text=True,env={**os.environ,'LC_ALL':'C'})
   rows={}
   for line in p.stdout.splitlines():
    a=line.split(None,9)
    if len(a)<10:continue
    try:rows[int(a[0])]={'pid':int(a[0]),'ppid':int(a[1]),'rss_kib':int(a[2]),'cpu_s':seconds(a[3]),'birth':' '.join(a[4:9]),'executable':a[9]}
    except ValueError:continue
   family={IDENTITY['pid']};old=set()
   while family!=old:
    old=set(family);family.update(pid for pid,r in rows.items() if r['ppid'] in family)
   selected=[rows[pid] for pid in family if pid in rows]
   for r in selected:
    key=str(r['pid'])+'/'+r['birth']
    if key not in self.initial:self.initial[key]=r['cpu_s'] if not self.samples else 0.0
    self.last[key]=r['cpu_s']
   self.samples.append({'monotonic':t,'rss_kib':sum(r['rss_kib'] for r in selected),'processes':selected})
   self.stop.wait(max(0,.1-(time.monotonic()-t)))
 def __enter__(self):self.thread.start();time.sleep(.15);return self
 def __exit__(self,*a):self.stop.set();self.thread.join()
 def summary(self):return {'sample_interval_s':.1,'samples':len(self.samples),'observed_peak_family_rss_mib':round(max([s['rss_kib'] for s in self.samples] or [0])/1024,2),'sampled_family_cpu_seconds':round(sum(max(0,self.last[k]-v) for k,v in self.initial.items()),3),'limitations':['RSS is sampled aggregate resident memory, not unique/private memory; shared pages may be counted repeatedly.','Short-lived children or their final CPU/RSS peak between 100ms samples can be missed; CPU is an observed estimate.','Measurements include Electron root/renderers/GPU and observed descendant engines, but not the fixture server or unrelated original app.']}

def probe(paths):
 result=[]
 for p in paths:
  r=subprocess.run([FFPROBE,'-v','error','-show_format','-show_streams','-show_chapters','-of','json',str(p)],capture_output=True,text=True,timeout=20)
  try:value=json.loads(r.stdout)
  except json.JSONDecodeError:value={}
  result.append({'path':str(p),'bytes':p.stat().st_size,'exit_code':r.returncode,'probe':value,'stderr':r.stderr})
 return result

def run(label,url,timeout=45,cancel_after=None):
 started=time.time();trace=[]
 with Sampler() as sampler:
  mono=time.monotonic();status,created=request('POST','/v1/jobs',{'url':url});trace.append({'elapsed_s':0,'http_status':status,'job':created})
  job=created;last=None
  if status==202:
   while time.monotonic()-mono<timeout:
    elapsed=time.monotonic()-mono
    if cancel_after and elapsed>=cancel_after:
     s,job=request('POST',f'/v1/jobs/{created["id"]}/cancel');trace.append({'elapsed_s':elapsed,'http_status':s,'job':job});break
    s,job=request('GET',f'/v1/jobs/{created["id"]}')
    state=(job.get('status'),job.get('progress'))
    if state!=last:trace.append({'elapsed_s':elapsed,'http_status':s,'job':job});last=state
    if job.get('status') in ['complete','error','cancelled']:break
    time.sleep(.1)
   else:
    _,cancelled=request('POST',f'/v1/jobs/{created["id"]}/cancel');trace.append({'elapsed_s':time.monotonic()-mono,'timeout':True,'cancellation':cancelled})
  elapsed=time.monotonic()-mono
 folder=ROOT/'output/remote-jobs'/str(created.get('id','unknown'))
 files=[p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in ['.mp4','.mkv','.webm','.m4a','.mp3','.mov','.ts']]
 result={'label':label,'input_url':url,'started_epoch':started,'elapsed_s':round(elapsed,4),'http_create_status':status,'final':job,'trace':trace,'resources':sampler.summary(),'outputs':probe(files)}
 (ROOT/'bench-results').mkdir(exist_ok=True)
 (ROOT/'bench-results'/f'{label}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 (ROOT/'bench-results'/f'{label}-samples.json').write_text(json.dumps(sampler.samples,ensure_ascii=False,indent=2))
 print(json.dumps({'label':label,'elapsed_s':result['elapsed_s'],'status':job.get('status'),'error':job.get('error'),'files':len(files),'peak_rss_mib':result['resources']['observed_peak_family_rss_mib']},ensure_ascii=False),flush=True)
 return result

if __name__=='__main__':
 origin='http://127.0.0.1:55661'
 if len(sys.argv)>2:run(sys.argv[1],sys.argv[2],timeout=90,cancel_after=3 if sys.argv[1].startswith('cancel') else None)
 else:
  for kind,route in [('direct','/direct.mp4'),('hls','/media/hls/master.m3u8'),('dash','/media/dash/manifest.mpd')]:
   for i in range(1,4):run(f'{kind}-{i}',origin+route)
  for label,route in [('annotated','/annotated.mp4'),('watch-hls','/watch/hls'),('playlist','/playlist'),('404','/missing.mp4'),('403','/denied.mp4'),('disconnect','/disconnect.mp4')]:run(label,origin+route)
  run('cancel-slow',origin+'/slow.mp4',cancel_after=3)
