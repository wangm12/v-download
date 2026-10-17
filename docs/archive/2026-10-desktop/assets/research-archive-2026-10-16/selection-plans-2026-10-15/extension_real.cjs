const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {backgroundHarness}=require('/Users/mingjie/Documents/github/personal-projects/v-download/scripts/extension-background-harness.cjs')
const root=__dirname,read=f=>JSON.parse(fs.readFileSync(path.join(root,f))),base=read('fixtures/server.json').base_url,id=fs.readFileSync(path.join(root,'extension-id'),'utf8'),port=read('extension-server.json').port
const worker=backgroundHarness({extensionId:id,storage:{downloadPlanId:'builtin:audio',downloadPlanRevision:1},fetch:(url,init={})=>fetch(url.replace('http://127.0.0.1:18765',`http://127.0.0.1:${port}`),{...init,headers:{...init.headers,Origin:`chrome-extension://${id}`}})})
;(async()=>{
 const plans=await worker.message({type:'GET_DOWNLOAD_PLANS'});assert.equal(plans.ok,true);assert.ok(plans.plans.some(p=>p.id==='builtin:audio'));assert.ok(!JSON.stringify(plans).includes(root),'filesystem paths never cross extension catalog boundary')
 const single=await worker.message({type:'DOWNLOAD_MEDIA_FROM_CONTENT',item:{url:base+'/direct.mp4?extension=single',type:'mp4',title:'Extension selected MP3'}},{tab:{id:1,url:base+'/watch/precision',title:'Fixture'}});assert.equal(single.ok,true,JSON.stringify(single))
 worker.storage.downloadPlanId='builtin:compatible'
 const batch=await worker.message({type:'DOWNLOAD_MEDIA',tabUrl:base+'/watch/precision',tabTitle:'Extension compatible batch',items:[{url:base+'/media/fps30.m3u8?extension=batch',type:'hls'},{url:base+'/media/precision-hevc.mp4?extension=batch',type:'mp4'}]});assert.equal(batch.ok,true,JSON.stringify(batch))
 worker.storage.downloadPlanId='removed:plan';const fail=await worker.message({type:'DOWNLOAD_MEDIA_FROM_CONTENT',item:{url:base+'/direct.mp4?extension=removed',type:'mp4'}},{tab:{id:1,url:base+'/watch/precision'}});assert.equal(fail.ok,false);assert.equal(worker.wakes.length,0)
 fs.writeFileSync(path.join(root,'extension-dispatch-results.json'),JSON.stringify({single,batch,invalidPlan:fail,wakes:worker.wakes.length,catalog:plans.plans.map(p=>({id:p.id,revision:p.revision}))},null,2));console.log('production extension worker → authenticated local server → production queue PASS')
})().catch(e=>{console.error(e);process.exitCode=1})
