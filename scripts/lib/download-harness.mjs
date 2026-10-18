import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Isolated real Electron main/preload/renderer, using production IPC handlers. */
export async function startDownloadHarness({ root, repo, settings, dnsRoutes = {} }) {
  for (const name of ['profile', 'session', 'temp', 'logs', 'output']) await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, 'profile/settings.json'), JSON.stringify(settings), { mode: 0o600 })
  const token = randomBytes(32).toString('hex')
  await writeFile(join(root, 'bootstrap.cjs'), `
const {app,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),dns=require('node:dns/promises');
const root=__dirname,events=[],lookups=[],servers=new Set();
for(const [key,dir] of Object.entries({userData:'profile',sessionData:'session',temp:'temp',logs:'logs',downloads:'output'}))app.setPath(key,path.join(root,dir));
delete process.env.VDOWNLOAD_UPDATE_PROVIDER_URL;delete process.env.VDOWNLOAD_UPDATE_URL;
const routes=${JSON.stringify(dnsRoutes)},lookup=dns.lookup;
dns.lookup=async function(host,options){if(routes[host]){lookups.push(host);return routes[host]}return lookup.call(this,host,options)};
app.on('web-contents-created',(_event,wc)=>{const send=wc.send.bind(wc);wc.send=(channel,...args)=>{if(channel==='download-progress')events.push(args[0]);return send(channel,...args)}});
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){if(args[0]===18765)args[0]=0;this.once('listening',()=>servers.add(this));this.once('close',()=>servers.delete(this));return listen.apply(this,args)};
const handlers=new Map(),original=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>{handlers.set(name,fn);return original(name,fn)};
const allowed=new Set(['start-download','get-downloads','get-settings','update-settings','cancel-download']);
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.headers.authorization!==${JSON.stringify('Bearer ' + token)}){res.writeHead(403);res.end();return}
 try{let raw='';for await(const x of req){raw+=x;if(raw.length>65536)throw Error('too large')}
 const {channel,args=[]}=JSON.parse(raw);
 if(channel==='quit-harness'){res.end('{}');setTimeout(()=>app.quit(),10);return}
 if(channel==='harness-state'){res.end(JSON.stringify({events:events.splice(0),lookups:[...lookups],openServers:servers.size}));return}
 if(!allowed.has(channel)||!handlers.has(channel))throw Error('not ready');
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handlers.get(channel)({},...args)));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(root,'bridge.json'),JSON.stringify({port:server.address().port})));
app.on('will-quit',()=>server.close());
require(${JSON.stringify(join(repo, 'out/main/index.js'))});
`)
  const electron = (await import('electron')).default
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [join(root, 'bootstrap.cjs')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = '', bridge
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { log = (log + chunk).slice(-128_000) })
  async function invoke(channel, ...args) {
    const response = await fetch(`http://127.0.0.1:${bridge.port}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }), signal: AbortSignal.timeout(30_000) })
    const data = await response.json()
    if (response.status !== 200) throw Error(JSON.stringify(data))
    return data
  }
  const harness = { invoke, getLog: () => log, close: async () => {
    if (child.exitCode !== null) return
    try { await invoke('quit-harness') } catch {}
    for (let n = 0; n < 100 && child.exitCode === null; n++) await sleep(100)
    if (child.exitCode === null) { child.kill('SIGTERM'); for (let n = 0; n < 50 && child.exitCode === null; n++) await sleep(100) }
    if (child.exitCode === null) throw Error('Harness must exit before its profile is removed')
  } }
  try {
    for (let n = 0; n < 150; n++) {
      if (child.exitCode !== null) throw Error(`Electron exited: ${log.slice(-3000)}`)
      try { bridge = JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8')); if ((await invoke('get-downloads')).data) return harness } catch {}
      await sleep(100)
    }
    throw Error('Electron harness did not become ready')
  } catch (error) { await harness.close(); throw error }
}
