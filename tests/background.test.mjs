import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extension");
const clone = value => value === undefined ? undefined : structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = "test-key-not-a-real-credential";
const scope = value => createHash("sha256").update(value).digest("hex");
const recoveryKey = value => "jpdbReviewRecoveryV4:" + scope(value);
const now = Date.now();
const cardA = {vid:101,sid:0,spelling:"言葉",reading:"ことば",meanings:["word"],card_state:["due"],due_at:1};
const cardB = {vid:102,sid:0,spelling:"次",reading:"つぎ",meanings:["next"],card_state:["due"],due_at:2};
const cardC = {vid:103,sid:0,spelling:"学ぶ",reading:"まなぶ",meanings:["learn"],card_state:["learning"],due_at:3};
const http = (data = null, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => typeof data === "string" ? data : data === null ? "" : JSON.stringify(data)
});

function fixture({cards=[cardA,cardB],fresh=true,session=null,apiKey=key,journal=null}={}) {
  const data = {
    local:{enabled:true,apiKey,jpdbReviewCacheV4:{
      scope:scope(apiKey),vocabIds:cards.map(card=>[card.vid,card.sid]),vocabCachedAt:now,
      cards:clone(cards),statesCachedAt:fresh?now:0,dueAtSupported:true,truncated:false,needsRefill:false
    }},
    session:{
      reviewPanelV3:{openTabId:null,revision:0,intents:{}},
      sharedReviewSessionV3:{scope:scope(apiKey),card:null,revealed:false,revision:0,...clone(session)}
    }
  };
  if(journal) data.local[recoveryKey(apiKey)]=clone(journal);
  return data;
}

async function boot(data,{fetcher=null,failSet=null,tabs=[]}={}) {
  let handler;
  let installed;
  const events=[],calls=[],scripts=[];
  const listeners=[];
  const longTimers=new Map();
  let timerId=0,stopped=false;
  const emit=(changes,area)=>queueMicrotask(()=>{if(!stopped) for(const fn of listeners) fn(changes,area);});
  function area(name) {
    return {
      get: async keys=>{
        if(typeof keys==="string") return {[keys]:clone(data[name][keys])};
        if(Array.isArray(keys)) return Object.fromEntries(keys.filter(k=>Object.hasOwn(data[name],k)).map(k=>[k,clone(data[name][k])]));
        const result=clone(keys||{});
        for(const k of Object.keys(result)) if(Object.hasOwn(data[name],k)) result[k]=clone(data[name][k]);
        return result;
      },
      set: async values=>{
        if(failSet?.(name,values)) throw new Error("Simulated storage failure");
        const changes={};
        for(const [k,v] of Object.entries(values)) {
          if(JSON.stringify(data[name][k])!==JSON.stringify(v)) changes[k]={oldValue:clone(data[name][k]),newValue:clone(v)};
          data[name][k]=clone(v);
        }
        if(Object.keys(changes).length) emit(changes,name);
      }
    };
  }
  const chrome={
    runtime:{
      onInstalled:{addListener(fn){installed=fn;}},onStartup:{addListener(){}},
      onMessage:{addListener(fn){handler=fn;}},getManifest:()=>({version:"0.3.4"}),
      openOptionsPage:async()=>{}
    },
    storage:{local:area("local"),session:area("session"),onChanged:{addListener(fn){listeners.push(fn);}}},
    action:{onClicked:{addListener(){}}},
    tabs:{
      query:async()=>tabs,
      sendMessage:async(id,message)=>{
        events.push({id,...clone(message)});
        if(message.type==="JPDB_UI_PROBE") return {ready:true,version:tabs.find(t=>t.id===id)?.version||"0.3.4"};
        return {ready:true};
      },
      onRemoved:{addListener(){}}
    },
    scripting:{executeScript:async detail=>scripts.push(detail)},
    alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener(){}}},
    permissions:{contains:async()=>false,onAdded:{addListener(){}},onRemoved:{addListener(){}}}
  };
  const remoteCards=new Map([cardA,cardB,cardC].map(card=>[card.vid,clone(card)]));
  const defaultFetch=async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    if(url.endsWith("/review")) {
      const card=remoteCards.get(body.vid);
      if(card) {card.card_state=["known"];card.due_at=Date.now()+100000;}
      return http(null,204);
    }
    if(url.endsWith("/lookup-vocabulary")) {
      return http({vocabulary_info:body.list.map(([vid])=>body.fields.map(field=>remoteCards.get(vid)?.[field]))});
    }
    if(url.endsWith("/list-user-decks")) return http({decks:[[1,"Test"]]});
    if(url.endsWith("/deck/list-vocabulary")) return http({vocabulary:[...remoteCards.keys()].map(vid=>[vid,0])});
    if(url.endsWith("/ping")) return http(null,204);
    throw new Error("Unexpected external request: "+url);
  };
  const wrappedFetch=async(url,options)=>{
    calls.push({url,body:options.body?JSON.parse(options.body):null,signal:options.signal,authorization:options.headers.Authorization});
    return fetcher ? fetcher(url,options,defaultFetch) : defaultFetch(url,options);
  };
  const context=vm.createContext({
    chrome,fetch:wrappedFetch,crypto:webcrypto,TextEncoder,AbortController,URL,console,Date,Map,Set,
    setTimeout(fn,ms){
      const id=++timerId;
      if(ms>=8000) longTimers.set(id,fn);
      else setImmediate(()=>{if(!stopped) fn();});
      return id;
    },
    clearTimeout(id){longTimers.delete(id);},
    structuredClone
  });
  const modules=new Map();
  async function load(name) {
    if(modules.has(name)) return modules.get(name);
    const mod=new vm.SourceTextModule(await fs.readFile(path.join(ROOT,name),"utf8"),{context,identifier:name});
    modules.set(name,mod);
    await mod.link(specifier=>load(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier))));
    return mod;
  }
  await (await load("background.js")).evaluate();
  const runtime={
    data,events,calls,scripts,remoteCards,chrome,
    install(){return installed?.();},
    send(message,tabId=1){return new Promise(resolve=>handler(message,{tab:{id:tabId}},response=>resolve(clone(response))));},
    async state(tabId=1){return await this.send({type:"JPDB_GET_PANEL_STATE"},tabId);},
    async expire(){for(const [id,fn] of [...longTimers]){longTimers.delete(id);fn();}await flush();},
    stop(){stopped=true;longTimers.clear();},
    longTimers
  };
  return runtime;
}

async function flush() {for(let i=0;i<30;i++) await tick();}
async function until(fn,label="condition") {
  for(let i=0;i<1000;i++){if(await fn()) return;await tick();}
  throw new Error("Did not reach "+label);
}
async function open(runtime,tabId=1,intent="open-"+Math.random()) {
  const result=await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:true,intentId:intent},tabId);
  assert.equal(result.success,true,JSON.stringify(result));
  return result;
}
async function ready(runtime,tabId=1) {
  await until(async()=>{const state=await runtime.state(tabId);return !state.state.loading;});
  return (await runtime.state(tabId)).state;
}
async function reveal(runtime,tabId=1) {
  let state=await ready(runtime,tabId);
  const reply=await runtime.send({type:"JPDB_MARK_REVEALED",vid:state.card.vid,sid:state.card.sid,revision:state.revision},tabId);
  assert.equal(reply.success,true);
  assert.equal(reply.state.revealed,true);
  return reply.state;
}
async function grade(runtime,tabId=1) {
  const state=await reveal(runtime,tabId);
  const result=await runtime.send({type:"JPDB_SUBMIT_REVIEW",vid:state.card.vid,sid:state.card.sid,
    revision:state.revision,grade:"okay"},tabId);
  assert.equal(result.success,true);
  return result;
}
const cases=[];
async function test(name,fn){await fn();cases.push(name);console.log("PASS "+name);}

await test("onInstalled must not overwrite API key or preferences saved during initialization",async()=>{
  const data=fixture();
  delete data.local.apiKey;
  delete data.local.enabled;
  const runtime=await boot(data);
  // The installer has read empty settings, but the user saves settings before
  // its asynchronous continuation. Defaults must not clobber these values.
  const installing=runtime.install();
  await runtime.chrome.storage.local.set({apiKey:key,enabled:false});
  await installing;
  await flush();
  assert.equal(data.local.apiKey,key,'installer must not blank a newly saved key');
  assert.equal(data.local.enabled,false,'installer must not change an explicit disabled choice');
  runtime.stop();
});

await test("missing API key shows an actionable error instead of an indefinite loading state",async()=>{
  const data=fixture({apiKey:"",fresh:false});
  const runtime=await boot(data);
  const result=await open(runtime);
  assert.equal(result.state.loading,false);
  assert.equal(result.state.progress,null);
  assert.equal(result.state.error.code,"NO_API_KEY");
  assert.equal(runtime.calls.length,0);
  runtime.stop();
});

await test("large first-time deck scan reports progress and finishes without selecting unchecked cards",async()=>{
  const data=fixture({fresh:false});
  data.local.jpdbReviewCacheV4.vocabIds=[];
  data.local.jpdbReviewCacheV4.vocabCachedAt=0;
  data.local.jpdbReviewCacheV4.cards=[];
  data.local.jpdbReviewCacheV4.statesCachedAt=0;
  let releaseDeck, releaseBatch, seenLookups=0;
  const deckGate=new Promise(resolve=>releaseDeck=resolve);
  const batchGate=new Promise(resolve=>releaseBatch=resolve);
  const pairs=Array.from({length:850},(_,i)=>[1000+i,0]);
  const fetcher=async(url,options,normal)=>{
    const body=options.body?JSON.parse(options.body):{};
    if(url.endsWith("/list-user-decks")) return http({decks:[[1,"A"],[2,"B"]]});
    if(url.endsWith("/deck/list-vocabulary")) {
      if(body.id===2) await deckGate;
      return http({vocabulary:body.id===1?pairs.slice(0,425):pairs.slice(425)});
    }
    if(url.endsWith("/lookup-vocabulary")) {
      if(++seenLookups===2) await batchGate;
      return http({vocabulary_info:body.list.map(([vid])=>body.fields.map(field=>({
        spelling:String(vid),reading:"test",meanings:["test"],card_state:["due"],due_at:1
      })[field]))});
    }
    return normal(url,options);
  };
  const runtime=await boot(data,{fetcher});
  const first=await open(runtime);
  assert.equal(first.state.loading,true);
  await until(async()=>{
    const p=(await runtime.state()).state.progress;
    return p?.phase==="vocabulary" && p.completed===1 && p.total===2;
  },"first deck progress");
  assert.equal((await runtime.state()).state.card,null,"must not expose partially scanned review schedule");
  releaseDeck();
  await until(async()=>{
    const p=(await runtime.state()).state.progress;
    return p?.phase==="reviews" && p.completed===400 && p.total===850;
  },"first batch progress");
  assert.equal((await runtime.state()).state.loading,true);
  releaseBatch();
  const final=await ready(runtime);
  assert.equal(final.loading,false);
  assert.equal(final.progress,null);
  assert.equal(final.error,null);
  assert.equal(final.card.vid,1000);
  assert.equal(data.local.jpdbReviewCacheV4.vocabIds.length,850);
  runtime.stop();
});

await test("panel ownership and close remain immediate during blocked lookup; no stale reopening",async()=>{
  const data=fixture({fresh:false});
  let resolveLookup;
  const pending=new Promise(resolve=>resolveLookup=resolve);
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>url.endsWith("/lookup-vocabulary")?pending:normal(url,options)});
  const a=await open(runtime,1,"a-open");
  assert.equal(a.state.loading,true);
  const b=await open(runtime,2,"b-open");
  assert.equal(b.state.loading,true);
  assert.equal(b.ownerTabId,2);
  assert.ok(b.panelRevision>a.panelRevision);
  const closed=await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:false,intentId:"b-close"},2);
  assert.equal(closed.open,false);
  const duplicate=await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:true,intentId:"b-open"},2);
  assert.equal(duplicate.open,false);
  resolveLookup(http({vocabulary_info:[[cardA.spelling,cardA.reading,cardA.meanings,cardA.card_state,cardA.due_at],
    [cardB.spelling,cardB.reading,cardB.meanings,cardB.card_state,cardB.due_at]]}));
  await flush();
  assert.equal((await runtime.state(1)).open,false);
  assert.equal((await runtime.state(2)).open,false);
  assert.equal((await runtime.state(2)).state.loading,false);
  runtime.stop();
});

await test("successful grade commits and advances before optional lookup; fresh worker cache avoids rescan",async()=>{
  const data=fixture();
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>url.endsWith("/lookup-vocabulary")?new Promise(()=>{}):normal(url,options)});
  await open(runtime);
  const saving=await grade(runtime);
  assert.equal(saving.state.submission.status,"saving");
  await until(async()=>(await runtime.state()).state.lastOutcome?.status==="accepted","accepted receipt");
  const state=(await runtime.state()).state;
  assert.equal(state.card.vid,102);
  assert.equal(state.submission,null);
  assert.equal(state.loading,false);
  const journal=data.local[recoveryKey(key)];
  assert.equal(journal.active,null);
  assert.equal(journal.lastOutcome.status,"accepted");
  assert.deepEqual(data.local.jpdbReviewCacheV4.cards.map(c=>c.vid),[102]);
  runtime.stop();
  const restarted=await boot(data);
  const reopened=await open(restarted);
  assert.equal(reopened.state.card.vid,102);
  assert.equal(reopened.state.loading,false);
  await flush();
  assert.equal(restarted.calls.length,0);
  restarted.stop();
});

await test("unknown write is never retried; restart and explicit continue retain quarantine",async()=>{
  const data=fixture();
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>url.endsWith("/review")?new Promise(()=>{}):normal(url,options)});
  await open(runtime);
  const saving=await grade(runtime);
  assert.equal(saving.state.submission.status,"saving");
  await flush();
  assert.equal(runtime.calls.filter(c=>c.url.endsWith("/review")).length,1);
  await runtime.expire();
  await until(async()=>(await runtime.state()).state.submission?.status==="uncertain","uncertain timeout");
  const uncertain=(await runtime.state()).state;
  const repeated=await runtime.send({type:"JPDB_SUBMIT_REVIEW",vid:101,sid:0,revision:uncertain.revision,grade:"okay"});
  assert.equal(repeated.ignored,true);
  assert.equal(runtime.calls.filter(c=>c.url.endsWith("/review")).length,1);
  runtime.stop();
  const restarted=await boot(data);
  await open(restarted);
  assert.equal((await restarted.state()).state.submission.status,"uncertain");
  await restarted.send({type:"JPDB_RECONCILE_REVIEW"});
  await flush();
  assert.equal((await restarted.state()).state.submission.status,"uncertain");
  assert.equal(restarted.calls.some(c=>c.url.endsWith("/review")),false);
  const next=await restarted.send({type:"JPDB_CONTINUE_WITHOUT_RESENDING"});
  assert.equal(next.state.card.vid,102);
  assert.equal(next.state.submission,null);
  assert.equal(next.state.recoveryCount,1);
  restarted.stop();
  const third=await boot(data);
  await open(third);
  assert.equal((await third.state()).state.card.vid,102);
  assert.equal((await third.state()).state.recoveryCount,1);
  const sync=await third.send({type:"JPDB_FORCE_SYNC"});
  assert.equal(sync.state.recoveryCount,1);
  assert.notEqual(sync.state.card?.vid,101);
  third.remoteCards.get(101).due_at=999;
  await third.send({type:"JPDB_RECONCILE_REVIEW"});
  await flush();
  assert.equal((await third.state()).state.recoveryCount,0);
  assert.equal(third.calls.some(c=>c.url.endsWith("/review")),false);
  third.stop();
});

await test("worker restart with an in-flight persisted journal becomes uncertain without resending",async()=>{
  const attempt={attemptId:"interrupted",card:cardA,grade:"okay",at:now,sessionRevision:4,status:"saving"};
  const data=fixture({journal:{active:attempt,quarantines:[],lastOutcome:null}});
  const runtime=await boot(data);
  const opened=await open(runtime);
  assert.equal(opened.state.submission.status,"uncertain");
  assert.equal(data.local[recoveryKey(key)].active.status,"uncertain");
  const sync=await runtime.send({type:"JPDB_FORCE_SYNC"});
  assert.equal(sync.success,false);
  assert.equal(sync.errorInfo.code,"REVIEW_PENDING");
  const immediateSync=await runtime.send({type:"JPDB_FORCE_SYNC",wait:false});
  assert.equal(immediateSync.success,false);
  assert.equal(immediateSync.errorInfo.code,"REVIEW_PENDING");
  assert.equal(runtime.calls.length,0);
  runtime.stop();
});

await test("successful receipt survives crash before session update without resurfacing accepted card",async()=>{
  const data=fixture({cards:[cardB],session:{card:cardA,revealed:true,revision:5},
    journal:{active:null,quarantines:[],lastOutcome:{status:"accepted",attemptId:"receipt",
      cardKey:"101:0",sessionRevision:5,at:now}}});
  const runtime=await boot(data);
  const initial=await runtime.state();
  assert.equal(initial.state.card,null);
  const opened=await open(runtime);
  assert.equal(opened.state.card.vid,102);
  assert.equal(runtime.calls.length,0);
  runtime.stop();
});

await test("transient read failure retries same due_at fields, preserving learning eligibility",async()=>{
  const data=fixture({cards:[cardA,cardC],fresh:false});
  let failures=0;
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>{
    if(url.endsWith("/lookup-vocabulary")&&failures++===0) throw new Error("temporary offline");
    return normal(url,options);
  }});
  await open(runtime);
  await ready(runtime);
  assert.equal(data.local.jpdbReviewCacheV4.dueAtSupported,true);
  assert.equal(data.local.jpdbReviewCacheV4.cards.some(c=>c.vid===103),true);
  const lookups=runtime.calls.filter(c=>c.url.endsWith("/lookup-vocabulary"));
  assert.equal(lookups.length,2);
  assert.equal(lookups.every(call=>call.body.fields.includes("due_at")),true);
  runtime.stop();
});

await test("only explicit due_at field rejection uses compatibility fallback",async()=>{
  const data=fixture({cards:[cardA,cardC],fresh:false});
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>{
    const body=JSON.parse(options.body||"null");
    if(url.endsWith("/lookup-vocabulary")&&body.fields.includes("due_at")) return http("Invalid field: due_at",400);
    return normal(url,options);
  }});
  await open(runtime);
  await ready(runtime);
  assert.equal(data.local.jpdbReviewCacheV4.dueAtSupported,false);
  assert.deepEqual(data.local.jpdbReviewCacheV4.cards.map(c=>c.vid),[101]);
  runtime.stop();
});

await test("empty cold result uses one state scan, then reuses the fresh empty cache",async()=>{
  const data=fixture({fresh:false});
  const runtime=await boot(data);
  for(const card of runtime.remoteCards.values()) card.card_state=["known"];
  await open(runtime);
  await ready(runtime);
  assert.equal(runtime.calls.filter(c=>c.url.endsWith("/lookup-vocabulary")).length,1);
  await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:false,intentId:"empty-close"});
  const reopened=await open(runtime);
  assert.equal(reopened.state.card,null);
  assert.equal(reopened.state.loading,false);
  assert.equal(runtime.calls.filter(c=>c.url.endsWith("/lookup-vocabulary")).length,1);
  runtime.stop();
});

await test("read deadlines recover while close remains available",async()=>{
  const runtime=await boot(fixture({fresh:false}),{fetcher:async()=>new Promise(()=>{})});
  await open(runtime);
  await flush();
  await runtime.expire();
  await flush();
  await runtime.expire();
  await until(async()=>(await runtime.state()).state.error?.code==="TIMEOUT","timeout error");
  const closed=await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:false,intentId:"timeout-close"});
  assert.equal(closed.open,false);
  assert.equal(closed.state.loading,false);
  assert.equal(closed.state.progress,null);
  runtime.stop();
});

await test("API-key change discards late old-account responses and uses new-account cache",async()=>{
  const data=fixture({fresh:false});
  let releaseOld;
  const pending=new Promise(resolve=>releaseOld=resolve);
  const runtime=await boot(data,{fetcher:async(url,options,normal)=>{
    if(options.headers.Authorization==="Bearer "+key&&url.endsWith("/lookup-vocabulary")) return pending;
    return normal(url,options);
  }});
  await open(runtime);
  await flush();
  await runtime.chrome.storage.local.set({apiKey:"another-fake-key"});
  await until(async()=>data.local.jpdbReviewCacheV4.scope===scope("another-fake-key"),"new scope");
  releaseOld(http({vocabulary_info:[["OLD","old",["wrong account"],["due"],1],["OLD2","old",["wrong"],["due"],1]]}));
  await flush();
  const state=(await runtime.state()).state;
  assert.notEqual(state.card?.spelling,"OLD");
  assert.equal(data.local.jpdbReviewCacheV4.scope,scope("another-fake-key"));
  assert.equal(runtime.calls.some(c=>c.authorization==="Bearer another-fake-key"),true);
  runtime.stop();
});

await test("failure to persist pre-write journal sends no grade",async()=>{
  let fail=false;
  const data=fixture();
  const runtime=await boot(data,{failSet:(area,values)=>fail&&area==="local"&&Object.values(values).some(v=>v?.active?.status==="saving")});
  await open(runtime);
  await reveal(runtime);
  fail=true;
  const state=(await runtime.state()).state;
  const result=await runtime.send({type:"JPDB_SUBMIT_REVIEW",vid:101,sid:0,grade:"okay",revision:state.revision});
  assert.equal(result.state.error.code,"STORAGE_FAILED");
  assert.equal(runtime.calls.some(c=>c.url.endsWith("/review")),false);
  runtime.stop();
});

await test("outdated content scripts are reinjected; matching versions are reused",async()=>{
  const runtime=await boot(fixture(),{tabs:[{id:1,version:"0.3.1"},{id:2,version:"0.3.4"}]});
  await flush();
  assert.deepEqual(runtime.scripts.map(item=>item.target.tabId),[1]);
  runtime.stop();
});

await test("rapid duplicate grade messages produce one write",async()=>{
  let accept;
  const pending=new Promise(resolve=>accept=resolve);
  const runtime=await boot(fixture(),{fetcher:async(url,options,normal)=>url.endsWith("/review")?pending:normal(url,options)});
  await open(runtime);
  const state=await reveal(runtime);
  const message={type:"JPDB_SUBMIT_REVIEW",vid:101,sid:0,revision:state.revision,grade:"okay"};
  const results=await Promise.all([runtime.send(message),runtime.send(message)]);
  await flush();
  assert.equal(results.every(result=>result.state.submission.status==="saving"),true);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/review")).length,1);
  accept(http(null,204));
  await until(async()=>(await runtime.state()).state.lastOutcome?.status==="accepted");
  runtime.stop();
});

await test("accepted write with failed durable receipt becomes uncertain rather than retried",async()=>{
  let failed=false;
  const runtime=await boot(fixture(),{failSet:(area,values)=>{
    const receipt=Object.values(values).some(value=>value?.lastOutcome?.status==="accepted"&&!value.active);
    if(area==="local"&&receipt&&!failed){failed=true;return true;}
    return false;
  }});
  await open(runtime);
  await grade(runtime);
  await until(async()=>(await runtime.state()).state.submission?.status==="uncertain");
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/review")).length,1);
  assert.equal(runtime.data.local[recoveryKey(key)].active.status,"uncertain");
  runtime.stop();
});

await test("accepted durable receipt stays accepted when session persistence fails",async()=>{
  let failed=false;
  const runtime=await boot(fixture(),{failSet:(area,values)=>{
    const session=values.sharedReviewSessionV3;
    if(area==="session"&&session?.lastOutcome?.status==="accepted"&&!failed){failed=true;return true;}
    return false;
  }});
  await open(runtime);
  await grade(runtime);
  await until(async()=>(await runtime.state()).state.error?.code==="STORAGE_FAILED");
  const state=(await runtime.state()).state;
  assert.equal(state.submission,null);
  assert.equal(state.lastOutcome.status,"accepted");
  assert.equal(runtime.data.local[recoveryKey(key)].active,null);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/review")).length,1);
  runtime.stop();
});

await test("cache persistence failure exits loading with an error and responsive close",async()=>{
  let failed=false;
  const runtime=await boot(fixture({fresh:false}),{failSet:(area,values)=>{
    if(area==="local"&&values.jpdbReviewCacheV4&&!failed){failed=true;return true;}
    return false;
  }});
  await open(runtime);
  await until(async()=>Boolean((await runtime.state()).state.error));
  assert.equal((await runtime.state()).state.loading,false);
  const closed=await runtime.send({type:"JPDB_SET_PANEL_OPEN",open:false,intentId:"storage-close"});
  assert.equal(closed.open,false);
  runtime.stop();
});

await test("immediate force sync acknowledges loading and exposes final count without another scan",async()=>{
  let finish;
  const gate=new Promise(resolve=>finish=resolve);
  const runtime=await boot(fixture({cards:[cardA]}),{fetcher:async(url,options,normal)=>{
    if(url.endsWith("/lookup-vocabulary")) await gate;
    return normal(url,options);
  }});
  runtime.remoteCards.get(101).card_state=["known"];
  await open(runtime);
  const started=await runtime.send({type:"JPDB_FORCE_SYNC",wait:false});
  assert.equal(started.success,true);
  assert.equal(started.syncStarted,true);
  assert.equal(started.state.loading,true);
  await until(()=>runtime.calls.some(call=>call.url.endsWith("/lookup-vocabulary")));
  finish();
  await until(()=>runtime.data.session.sharedReviewSessionV3.loading===false);
  const completed=await runtime.send({type:"JPDB_GET_DIAGNOSTICS"});
  assert.equal(completed.session.loading,false);
  assert.equal(completed.session.error,null);
  assert.equal(completed.eligibleCount,2);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/lookup-vocabulary")).length,1);
  runtime.stop();
});

await test("force sync replaces an ordinary cached-ID scan and rejects its late result",async()=>{
  let releaseOld;
  const oldLookup=new Promise(resolve=>releaseOld=resolve);
  let held=false;
  const runtime=await boot(fixture({cards:[cardA],fresh:false}),{fetcher:async(url,options,normal)=>{
    if(url.endsWith("/lookup-vocabulary")&&!held){held=true;return oldLookup;}
    return normal(url,options);
  }});
  await open(runtime);
  await until(()=>runtime.calls.some(call=>call.url.endsWith("/lookup-vocabulary")));
  const oldCall=runtime.calls.find(call=>call.url.endsWith("/lookup-vocabulary"));
  assert.deepEqual(oldCall.body.list,[[101,0]]);
  runtime.remoteCards.get(101).card_state=["known"];
  const started=await runtime.send({type:"JPDB_FORCE_SYNC",wait:false});
  assert.equal(started.state.loading,true);
  assert.equal(oldCall.signal.aborted,true);
  await until(()=>runtime.data.session.sharedReviewSessionV3.loading===false);
  const completed=await runtime.send({type:"JPDB_GET_DIAGNOSTICS"});
  assert.equal(completed.eligibleCount,2);
  assert.equal(completed.state.card.vid,102);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/list-user-decks")).length,1);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/deck/list-vocabulary")).length,1);
  assert.deepEqual(runtime.data.local.jpdbReviewCacheV4.vocabIds,[[101,0],[102,0],[103,0]]);
  releaseOld(http({vocabulary_info:[["STALE","stale",["stale"],["due"],1]]}));
  await flush();
  const afterLate=(await runtime.state()).state;
  assert.equal(afterLate.card.vid,102);
  assert.equal(afterLate.loading,false);
  assert.equal(runtime.data.local.jpdbReviewCacheV4.cards.some(card=>card.spelling==="STALE"),false);
  assert.equal(runtime.calls.filter(call=>call.url.endsWith("/lookup-vocabulary")).length,2);
  runtime.stop();
});

console.log(JSON.stringify({passed:cases.length,cases,environment:"Actual source modules and runtime message interface; isolated simulated Chrome and JPDB; no real account traffic"},null,2));

