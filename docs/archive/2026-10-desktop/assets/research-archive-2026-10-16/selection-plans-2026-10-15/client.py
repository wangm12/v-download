import json,urllib.request,urllib.error,time,subprocess,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent
BASE=json.loads((ROOT/'fixtures/server.json').read_text())['base_url']
FF='/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64/ffmpeg'
def invoke(channel,*args):
 port=json.loads((ROOT/'bridge.json').read_text())['port']
 request=urllib.request.Request(f'http://127.0.0.1:{port}',data=json.dumps({'channel':channel,'args':args}).encode(),headers={'Authorization':'Bearer '+(ROOT/'bridge-token').read_text(),'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(request,timeout=190))
def tasks():return invoke('get-downloads')['data']
def wait(tid,timeout=90):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  row=next(r for r in tasks() if r['id']==tid)
  if row['status'] in ['complete','error','cancelled','paused']:return row
  time.sleep(.15)
 raise AssertionError('Task timeout '+tid)
def probe(file):return json.loads(subprocess.check_output([FF.replace('ffmpeg','ffprobe'),'-v','error','-show_streams','-show_chapters','-show_format','-of','json',file]))
def decode(file):subprocess.run([FF,'-v','error','-xerror','-i',file,'-map','0:v?','-map','0:a?','-f','null','-'],capture_output=True,check=True)
def extension_request(path,body=None,capability=None):
 port=json.loads((ROOT/'extension-server.json').read_text())['port']
 headers={'Origin':'chrome-extension://'+(ROOT/'extension-id').read_text(),'Content-Type':'application/json'}
 if capability:headers['X-VDownload-Capability']=capability
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
if __name__=='__main__':
 print('library',invoke('get-download-plans'))
 info=json.loads(subprocess.check_output(['/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64/yt-dlp','--no-warnings','--no-download','-J',BASE+'/watch/precision']))
 print('formats',[(f['format_id'],f.get('height'),f.get('fps'),f.get('vcodec'),f.get('acodec')) for f in info['formats']])
 (ROOT/'precision-info.json').write_text(json.dumps(info,indent=2))
 print('collection',invoke('list-playlist-entries',BASE+'/collection'))
