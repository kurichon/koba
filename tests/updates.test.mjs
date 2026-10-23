import test from 'node:test';
import assert from 'node:assert/strict';

let importCounter = 0;
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));

async function environment({ permission = true, fetchImpl, settings } = {}) {
  const data = settings ? {jpdbUpdateSettings:settings} : {};
  const alarms = new Map();
  const calls = [];
  const env = { data, alarms, calls, permission, version:'0.3.3' };
  globalThis.chrome = {
    runtime: {getManifest:() => ({version:env.version}), onStartup:event()},
    storage: {local:{
      get:async key => typeof key === 'string' ? {[key]:clone(data[key])} : clone(data),
      set:async patch => Object.assign(data,clone(patch))
    }},
    permissions:{contains:async()=>env.permission, onAdded:event(), onRemoved:event()},
    alarms:{
      create:async(name,config)=>alarms.set(name,clone(config)),
      clear:async name=>alarms.delete(name), onAlarm:event()
    }
  };
  globalThis.fetch = async (url,options) => {
    calls.push({url,options});
    if (!fetchImpl) throw new Error('Unexpected network request');
    return await fetchImpl(url,options);
  };
  env.module = await import(new URL(`../extension/updates.js?test=${++importCounter}`,import.meta.url));
  return env;
}

function release(version='0.3.10', overrides={}) {
  const tag=`v${version}`;
  const name=`KoBa_v${version}.zip`;
  return {draft:false,prerelease:false,published_at:'2026-10-23T00:00:00Z',tag_name:tag,
    html_url:`https://github.com/example/jpdb/releases/tag/${tag}`,
    name:'<img src=x onerror=alert(1)>',body:'untrusted release notes',
    assets:[{name,state:'uploaded',size:25000,browser_download_url:`https://github.com/example/jpdb/releases/download/${tag}/${name}`}],...overrides};
}
const json = (value, options={}) => new Response(JSON.stringify(value),{status:200,...options});

test('automatic checks require a configured source, opt-in, and optional host permission',async()=>{
  const env=await environment({permission:false});
  await env.module.initializeUpdates();
  await tick();
  assert.equal(env.calls.length,0);
  assert.equal(env.alarms.size,0);
  assert.equal((await env.module.getUpdateStatus()).state.status,'not-configured');
  await env.module.saveUpdateSettings({repository:'example/jpdb',enabled:true});
  const status=await env.module.checkForUpdates({force:true});
  assert.equal(status.state.status,'permission-required');
  assert.equal(env.calls.length,0);
  assert.equal(env.alarms.size,0);
  await assert.rejects(env.module.saveUpdateSettings({repository:'https://github.com.evil.test/example/jpdb',enabled:true}));
  assert.equal(env.data.jpdbUpdateSettings.repository,'example/jpdb');
});

test('published installable releases are compared numerically and conditional checks preserve validated metadata',async()=>{
  let count=0;
  const env=await environment({fetchImpl:async()=>++count===1?json(release(),{headers:{etag:'"safe-etag"'}}):new Response(null,{status:304})});
  await env.module.saveUpdateSettings({repository:'https://github.com/example/jpdb',enabled:true});
  const first=await env.module.checkForUpdates({force:true});
  assert.equal(first.state.available,true);
  assert.equal(first.state.status,'available');
  assert.equal(first.state.latestVersion,'0.3.10');
  assert.equal(first.state.releaseUrl,'https://github.com/example/jpdb/releases/tag/v0.3.10');
  assert.equal(JSON.stringify(first).includes('untrusted release notes'),false);
  assert.equal(JSON.stringify(first).includes('<img'),false);
  assert.equal(env.calls[0].url,'https://api.github.com/repos/example/jpdb/releases/latest');
  assert.equal(env.calls[0].options.credentials,'omit');
  assert.equal(env.calls[0].options.redirect,'error');
  assert.equal(Object.hasOwn(env.calls[0].options.headers,'Authorization'),false);
  assert.ok(env.calls[0].options.signal);
  await env.module.checkForUpdates();
  assert.equal(env.calls.length,1,'daily schedule prevents another automatic request');
  const second=await env.module.checkForUpdates({force:true});
  assert.equal(env.calls[1].options.headers['If-None-Match'],'"safe-etag"');
  assert.equal(second.state.available,true);
  env.version='0.3.10';
  assert.equal((await env.module.getUpdateStatus()).state.available,false,'installed version wins over previously saved notice');
});

test('downgrades, preview tags, draft releases, wrong destinations, and missing runtime assets are never offered',async()=>{
  const cases=[
    {body:release('0.3.1'),status:'current'},
    {body:release('0.3.3-beta'),status:'error'},
    {body:release('0.3.3',{prerelease:true}),status:'error'},
    {body:release('0.3.3',{draft:true}),status:'error'},
    {body:release('0.3.3',{html_url:'https://github.com/other/jpdb/releases/tag/v0.3.3'}),status:'error'},
    {body:release('0.3.3',{assets:[]}),status:'error'}
  ];
  for(const sample of cases){
    const env=await environment({fetchImpl:async()=>json(sample.body),settings:{repository:'example/jpdb',enabled:true}});
    const result=await env.module.checkForUpdates({force:true});
    assert.equal(result.state.available,false);
    assert.equal(result.state.status,sample.status);
  }
});

test('a temporary failure retains only a previously verified same-source release and respects a server cooldown',async()=>{
  let failure=false;
  const env=await environment({fetchImpl:async()=>failure?new Response(null,{status:429,headers:{'retry-after':'60'}}):json(release()),settings:{repository:'example/jpdb',enabled:true}});
  await env.module.checkForUpdates({force:true});
  failure=true;
  const failed=await env.module.checkForUpdates({force:true});
  assert.equal(failed.state.status,'error');
  assert.equal(failed.state.available,true);
  assert.equal(failed.state.latestVersion,'0.3.10');
  await env.module.saveUpdateSettings({repository:'example/jpdb',enabled:true});
  assert.equal((await env.module.getUpdateStatus()).state.status,'error','saving unchanged settings cannot hide a server cooldown');
  await env.module.checkForUpdates({force:true});
  assert.equal(env.calls.length,2,'manual checks also respect rate limits');
  await env.module.saveUpdateSettings({repository:'example/different',enabled:true});
  assert.equal((await env.module.getUpdateStatus()).state.available,false);
});

test('changing repository during an in-flight request prevents stale metadata from being committed',async()=>{
  let respond;
  const env=await environment({fetchImpl:()=>new Promise(resolve=>respond=resolve),settings:{repository:'example/jpdb',enabled:true}});
  const pending=env.module.checkForUpdates({force:true});
  for(let i=0;i<20&&!respond;i++)await tick();
  assert.ok(respond);
  await env.module.saveUpdateSettings({repository:'example/second',enabled:false});
  respond(json(release()));
  const result=await pending;
  assert.equal(result.settings.repository,'example/second');
  assert.equal(result.state.repository,'example/second');
  assert.equal(result.state.available,false);
  assert.equal(result.state.status,'disabled');
});

test('an unresponsive metadata request has a deadline and leaves a recoverable state',async()=>{
  const originalSetTimeout=globalThis.setTimeout;
  let aborted=false;
  globalThis.setTimeout=(fn,ms,...args)=>originalSetTimeout(fn,ms===12000?10:ms,...args);
  try {
    const env=await environment({fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{
      aborted=true;reject(new DOMException('Aborted','AbortError'));
    })),settings:{repository:'example/jpdb',enabled:true}});
    const result=await env.module.checkForUpdates({force:true});
    assert.equal(aborted,true);
    assert.equal(result.state.status,'error');
    assert.match(result.state.error,/respond in time/);
  } finally {globalThis.setTimeout=originalSetTimeout;}
});

test('a worker restart cannot leave a stored Checking status permanently busy',async()=>{
  const env=await environment({fetchImpl:async()=>json(release()),settings:{repository:'example/jpdb',enabled:true}});
  env.data.jpdbUpdateState={repository:'example/jpdb',status:'checking',nextCheckAt:Date.now()+86400000};
  const interrupted=await env.module.getUpdateStatus();
  assert.equal(interrupted.state.status,'error');
  assert.equal(interrupted.state.nextCheckAt,null);
  const recovered=await env.module.checkForUpdates();
  assert.equal(recovered.state.status,'available');
  assert.equal(env.calls.length,1);
});

test('404 and oversized metadata produce honest status without fetching code or leaving the checker busy',async()=>{
  const missing=await environment({fetchImpl:async()=>new Response(null,{status:404}),settings:{repository:'example/jpdb',enabled:true}});
  assert.equal((await missing.module.checkForUpdates({force:true})).state.status,'no-release');
  const oversized=await environment({fetchImpl:async()=>json({body:'x'.repeat(300000)}),settings:{repository:'example/jpdb',enabled:true}});
  const result=await oversized.module.checkForUpdates({force:true});
  assert.equal(result.state.status,'error');
  assert.match(result.state.error,/too much/);
  assert.equal(result.state.releaseUrl,null);
  assert.equal(oversized.calls.length,1);
  const invalid=await environment({fetchImpl:async()=>new Response('<secret-server-body>'),settings:{repository:'example/jpdb',enabled:true}});
  const invalidResult=await invalid.module.checkForUpdates({force:true});
  assert.match(invalidResult.state.error,/invalid release metadata/);
  assert.equal(JSON.stringify(invalidResult).includes('secret-server-body'),false,'parser diagnostics do not echo a response body');
});


test('KoBa release assets are preferred but legacy JPDB names remain valid for transitional updates', async () => {
  const version='0.3.10', tag=`v${version}`;
  const oldName=`JPDB_Review_Button_for_ChatGPT_v${version}.zip`;
  const newName=`KoBa_v${version}.zip`;
  const oldAsset={name:oldName,state:'uploaded',size:20000,browser_download_url:`https://github.com/example/jpdb/releases/download/${tag}/${oldName}`};
  const newAsset={name:newName,state:'uploaded',size:20000,browser_download_url:`https://github.com/example/jpdb/releases/download/${tag}/${newName}`};
  const env=await environment({fetchImpl:async()=>json(release(version,{assets:[oldAsset,newAsset]})),settings:{repository:'example/jpdb',enabled:true}});
  const canonical=await env.module.checkForUpdates({force:true});
  assert.equal(canonical.state.assetName,newName,'new installation prefers KoBa filename');
  // An older, previously validated notice can still be interpreted after upgrading.
  env.data.jpdbUpdateState={...env.data.jpdbUpdateState,assetName:oldName};
  assert.equal((await env.module.getUpdateStatus()).state.assetName,oldName);
  globalThis.fetch=async()=>json(release(version,{assets:[oldAsset]}));
  const legacy=await env.module.checkForUpdates({force:true});
  assert.equal(legacy.state.assetName,oldName,'accept older-name-only release metadata');
  const wrong={...oldAsset,browser_download_url:`https://github.com/attacker/jpdb/releases/download/${tag}/${oldName}`};
  globalThis.fetch=async()=>json(release(version,{assets:[wrong]}));
  const invalid=await env.module.checkForUpdates({force:true});
  assert.equal(invalid.state.status,'error','legacy aliases receive the same strict URL validation');
});
