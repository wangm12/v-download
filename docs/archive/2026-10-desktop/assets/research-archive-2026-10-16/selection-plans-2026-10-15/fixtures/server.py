import json,os
from pathlib import Path
from serve_fixtures import FixtureServer,FixtureHandler
class Handler(FixtureHandler):
 def route(self,head):
  path=self.path.split('?')[0]
  if path=='/watch/precision':return self.respond(200,b'<html><head><title>Exact 360p 30 or 60 fps</title></head><body><video controls><source src="/media/fps-master.m3u8" type="application/vnd.apple.mpegurl"></video></body></html>','text/html',head)
  if path=='/collection':return self.respond(200,b'<html><head><title>Shared plan collection</title></head><body><video controls title="First"><source src="/media/fps-master.m3u8" type="application/vnd.apple.mpegurl"></video><video controls title="Second"><source src="/media/dash/manifest.mpd" type="application/dash+xml"></video></body></html>','text/html',head)
  return super().route(head)
s=FixtureServer(0);s.RequestHandlerClass=Handler
state={'base_url':'http://127.0.0.1:%s'%s.server_address[1],'pid':os.getpid()}
Path(__file__).with_name('server.json').write_text(json.dumps(state));print(json.dumps(state),flush=True);s.serve_forever()
