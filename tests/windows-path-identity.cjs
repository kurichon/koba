// Windows-only probe: old unpacked path -> junction, preserving browser profile.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
if(process.platform!=='win32') throw new Error('Windows required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'koba-path-probe-'));
const old=path.join(root,'old KoBa'), appdata=path.join(root,'LocalAppData','KoBa','Extension');
const backup=old+' backup', profile=path.join(root,'Profile');
const fixture='one-time-migration-identity-check';
const source=path.resolve(__dirname,'..','extension');
async function launch(folder) {
  const browser=await chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,
    args:['--disable-extensions-except='+folder,'--load-extension='+folder]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker',{timeout:25000});
  const id=new URL(worker.url()).host;
  return {browser,worker,id};
}
(async()=>{
  fs.cpSync(source,old,{recursive:true});
  let first=await launch(old);
  await first.worker.evaluate(v=>chrome.storage.local.set({kobaPathMigrationProbe:v}),fixture);
  console.log('FIRST',first.id,old);
  await first.browser.close();
  fs.mkdirSync(path.dirname(appdata),{recursive:true});
  fs.renameSync(old,backup);
  fs.cpSync(backup,appdata,{recursive:true});
  const link=cp.spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','mklink /J "'+old+'" "'+appdata+'"'],{encoding:'utf8'});
  assert.equal(link.status,0,'Junction creation failed: '+link.stdout+' '+link.stderr);
  console.log('JUNCTION',fs.realpathSync(old),appdata);
  let after=await launch(old);
  let value=await after.worker.evaluate(async()=> (await chrome.storage.local.get('kobaPathMigrationProbe')).kobaPathMigrationProbe);
  console.log('AFTER JUNCTION',after.id,'STORAGE:',value);
  assert.equal(after.id,first.id,'Moving old folder to a junction changed the extension identity');
  assert.equal(value,fixture,'Saved browser-local data was not retained');
  await after.browser.close();
  console.log('PASS: old path junction preserves identity and browser-local storage after cold restart');
})().catch(e=>{console.error('PROBE FAILURE',e);process.exitCode=1}).finally(()=>{
  if(!process.exitCode) fs.rmSync(root,{recursive:true,force:true});
});
