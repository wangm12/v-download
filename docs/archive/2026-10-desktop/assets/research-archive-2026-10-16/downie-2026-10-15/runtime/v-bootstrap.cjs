const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
for(const name of ['profile','session','temp','logs','output'])fs.mkdirSync(path.join(root,name),{recursive:true});
app.setPath('userData',path.join(root,'profile'));
app.setPath('sessionData',path.join(root,'session'));
app.setPath('temp',path.join(root,'temp'));
app.setPath('logs',path.join(root,'logs'));
app.setPath('downloads',path.join(root,'output'));
process.env.TMPDIR=path.join(root,'temp');
delete process.env.VDOWNLOAD_UPDATE_PROVIDER_URL;
delete process.env.VDOWNLOAD_UPDATE_URL;
fs.writeFileSync(path.join(root,'v-runtime-identity.json'),JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),executable:process.execPath,versions:process.versions,isPackaged:app.isPackaged,sourceEntry:'/Applications/V-Download.app/Contents/Resources/app.asar/out/main/index.js',userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),temp:app.getPath('temp'),downloads:app.getPath('downloads')},null,2));
fs.copyFileSync(path.join(root,'v-runtime-identity.json'),path.join(root,`v-runtime-identity-${process.pid}.json`));
app.on('browser-window-created',(_event,window)=>{
 window.webContents.once('did-finish-load',()=>{
  fs.writeFileSync(path.join(root,'v-window-ready.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString(),title:window.getTitle(),url:window.webContents.getURL()},null,2));
  fs.copyFileSync(path.join(root,'v-window-ready.json'),path.join(root,`v-window-ready-${process.pid}.json`));
 });
});
require('/Applications/V-Download.app/Contents/Resources/app.asar/out/main/index.js');
