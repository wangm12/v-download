const {app,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=__dirname;
for(const [key,dir] of Object.entries({userData:'profile',sessionData:'session',temp:'temp',logs:'logs',downloads:'output'}))app.setPath(key,path.join(root,dir));
process.env.TMPDIR=path.join(root,'temp');process.env.V_DOWNLOAD_FORCE_EXTENSION_AUTH='1';process.env.V_DOWNLOAD_EXTENSION_ID=fs.readFileSync(path.join(root,'extension-id'),'utf8');
delete process.env.VDOWNLOAD_UPDATE_PROVIDER_URL;delete process.env.VDOWNLOAD_UPDATE_URL;
// Bind only this research instance's extension listener to an ephemeral port.
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){if(args[0]===18765){args[0]=0;this.once('listening',()=>{
 const port=this.address().port;fs.writeFileSync(path.join(root,'extension-server.json'),JSON.stringify({port,pid:process.pid}));
 const source=fs.readFileSync('/Users/mingjie/Documents/github/personal-projects/v-download/extension/background.js','utf8');fs.writeFileSync(path.join(root,'test-extension/background.js'),source.replace("const APP_URL = 'http://127.0.0.1:18765'",`const APP_URL = 'http://127.0.0.1:${port}'`));
 });}return listen.apply(this,args)};
const handlers=new Map(),handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>{handlers.set(channel,fn);return handle(channel,fn)};
const log=(data)=>fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...data})+'\n');
app.on('browser-window-created',(_,win)=>{const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>{if(['download-progress','info-resolve-result','session-interrupted','new-download'].includes(channel))log({channel,args});return send(channel,...args)}});
const allowed=new Set(['start-download','start-downloads-bulk','start-info-resolve','promote-info-resolve','get-info-resolve-results','get-downloads','pause-download','cancel-download','retry-download','update-settings','get-settings','get-download-plans','mutate-download-plan','list-playlist-entries','resume-session-interrupted']);
const token=fs.readFileSync(path.join(root,'bridge-token'),'utf8');
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return}
 let body='';for await(const part of req){body+=part;if(body.length>256000){res.writeHead(413);res.end();return}}
 try{const {channel,args=[]}=JSON.parse(body);if(!allowed.has(channel)||!handlers.has(channel))throw Error('Unknown test operation');const result=await handlers.get(channel)({},...args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result??null));}
 catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(root,'bridge.json'),JSON.stringify({port:server.address().port,pid:process.pid})));
app.on('will-quit',()=>server.close());
fs.writeFileSync(path.join(root,'identity.json'),JSON.stringify({pid:process.pid,executable:process.execPath,versions:process.versions,userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),temp:app.getPath('temp'),source:'/Users/mingjie/Documents/github/personal-projects/v-download/out/main/index.js'},null,2));
require('/Users/mingjie/Documents/github/personal-projects/v-download/out/main/index.js');
