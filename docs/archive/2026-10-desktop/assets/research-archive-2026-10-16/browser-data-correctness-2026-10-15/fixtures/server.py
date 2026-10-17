import json,os
from pathlib import Path
from serve_fixtures import FixtureServer,FixtureHandler
SIGNED='?token=a%2fb&label=hello%20world&utm_source=capture'
class Handler(FixtureHandler):
 def do_POST(self):
  if self.path!='/debug-trace':return self.respond(404,b'no','text/plain',False)
  raw=self.rfile.read(min(int(self.headers.get('Content-Length','0')),20000))
  with Path(__file__).with_name('debug-trace.jsonl').open('ab') as log:log.write(raw+b'\n')
  self.respond(200,b'{}','application/json',False)

 def route(self,head):
  with Path(__file__).with_name('source-requests.jsonl').open('a') as log:log.write(json.dumps({'url':self.path,'referer':self.headers.get('Referer'),'userAgent':self.headers.get('User-Agent')})+'\n')
  path=self.path.split('?')[0];base='http://127.0.0.1:'+str(self.server.server_address[1])
  if path=='/watch/lesson':
   roots=[base+'/stream/'+str(i)+'/master.m3u8'+SIGNED for i in (1,2)]
   body='<html><head><title>Source correctness — three independent streams</title><meta name="referrer" content="unsafe-url"></head><body><h1>Three independent streams</h1><p>Open V-Download to select the detected streams.</p><video width="640" height="360" controls src="/signed.mp4'+SIGNED+'"></video><iframe src="/embed/lesson?entry=frame%20three" width="640" height="120"></iframe><script>'+''.join('fetch('+json.dumps(u)+').then(r=>r.text());' for u in roots)+'</script></body></html>'
   return self.respond(200,body.encode(),'text/html; charset=utf-8',head)
  if path=='/embed/lesson':
   u=base+'/stream/3/master.m3u8'+SIGNED
   return self.respond(200,('<html><head><title>Third frame source</title><meta name="referrer" content="unsafe-url"></head><body><p>Third stream from an iframe</p><script>fetch('+json.dumps(u)+').then(r=>r.text());</script></body></html>').encode(),'text/html; charset=utf-8',head)
  if path.startswith('/stream/') or path in ('/signed.mp4','/shared.mp4'):
   expected=base+('/embed/lesson?entry=frame%20three' if path.startswith('/stream/3/') else '/watch/lesson?course=demo%20unit&view=1')
   if self.headers.get('Referer') not in ([base+'/watch/lesson?course=demo%20unit&view=1',base+'/embed/lesson?entry=frame%20three'] if path=='/shared.mp4' else [expected]):return self.respond(403,b'Full document Referer required','text/plain',head)
   if (path.endswith('/master.m3u8') or path in ('/signed.mp4','/shared.mp4')) and self.path!=path+SIGNED:return self.respond(403,b'Original query bytes required','text/plain',head)
   if path.endswith('/master.m3u8'):return self.serve_file(Path(__file__).parent/'media/fps-master.m3u8',head=head)
   if path in ('/signed.mp4','/shared.mp4'):return self.serve_file(Path(__file__).parent/'media/sample-360.mp4',head=head)
   file=Path(__file__).parent/'media'/path.rsplit('/',1)[1]
   return self.serve_file(file,head=head)
  return super().route(head)
s=FixtureServer(61076);s.RequestHandlerClass=Handler
state={'base_url':'http://127.0.0.1:'+str(s.server_address[1]),'pid':os.getpid()};Path(__file__).with_name('server.json').write_text(json.dumps(state));print(json.dumps(state),flush=True);s.serve_forever()
