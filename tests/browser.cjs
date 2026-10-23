// Actual MV3 extension in an isolated Chromium profile. All external transport
// is a controlled fixture; this never uses a real JPDB key or submits a real review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.JPDB_TEST_EXTENSION || path.join(root, 'extension'));
const upgradeFrom = path.resolve(process.env.JPDB_TEST_UPGRADE_FROM || path.join(__dirname, 'fixtures', 'v0.3.1'));
const output = path.resolve(process.env.JPDB_TEST_OUTPUT || path.join(root, 'test-results'));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
const fakeKey = 'browser-fixture-not-a-real-jpdb-key';
const html = `<!doctype html><html><head><title>JPDB controlled layout</title><style>
body{font:16px sans-serif;margin:0;background:#fafafa;color:#202020}main{max-width:620px;margin:80px auto}
form{position:fixed;left:300px;bottom:35px;width:620px;height:90px}textarea{width:100%;height:100%;box-sizing:border-box}
</style></head><body><main><h1>Review interaction fixture</h1><p>Controlled layout; no live ChatGPT or JPDB account.</p>
<form><textarea id="prompt-textarea" aria-label="Message"></textarea></form></main></body></html>`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const skippedScenarios = [];
const apps = new Set();
let browserVersion;
fs.mkdirSync(output, { recursive: true });

async function until(check, label, timeout = 7000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(25);
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

async function installTransport(worker) {
  await until(() => worker.evaluate(() => Boolean(chrome?.storage?.local)), 'extension worker ready');
  await worker.evaluate(() => {
    const fixture = globalThis.__jpdbFixture = {
      requests: [], attempts: [], holds: [], holdLookups: false, holdRefresh: false,
      reviewMode: 'success', failLookup: false, holdSecondLookup: false, lookupCount: 0, permission: false,
      cards: [
        { vid:101, sid:1, spelling:'猫', reading:'ねこ', meanings:['cat'], card_state:['due'], due_at:1000 },
        { vid:102, sid:1, spelling:'犬', reading:'いぬ', meanings:['dog'], card_state:['due'], due_at:2000 },
        { vid:103, sid:1, spelling:'学ぶ', reading:'まなぶ', meanings:['learn'], card_state:['learning'], due_at:3000 }
      ]
    };
    // Permission decisions are simulated; the browser's permission prompt is not a gate proven here.
    chrome.permissions.contains = async () => fixture.permission;
    async function hold(signal) {
      await new Promise((resolve, reject) => {
        const done = () => { signal?.removeEventListener('abort', aborted); resolve(); };
        const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) return aborted();
        signal?.addEventListener('abort', aborted, { once:true });
        fixture.holds.push(done);
      });
    }
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const body = options.body ? JSON.parse(options.body) : null;
      fixture.requests.push({ origin:url.origin, endpoint:url.pathname, body });
      if (url.origin === 'https://api.github.com') {
        if (options.headers?.Authorization) throw new Error('JPDB credentials leaked to GitHub');
        const repository = url.pathname.match(/^\/repos\/(.+)\/releases\/latest$/)?.[1];
        if (!repository) throw new Error('Unexpected GitHub URL');
        const version = '0.4.0', tag = 'v' + version;
        const assetName = `KoBa_v${version}.zip`;
        return new Response(JSON.stringify({ draft:false, prerelease:false, tag_name:tag,
          published_at:'2026-10-20T00:00:00Z', html_url:`https://github.com/${repository.toLowerCase()}/releases/tag/${tag}`,
          assets:[{name:assetName,state:'uploaded',size:12345,
            browser_download_url:`https://github.com/${repository.toLowerCase()}/releases/download/${tag}/${assetName}`}]
        }), {status:200, headers:{etag:'"fixture-v040"'}});
      }
      if (url.origin !== 'https://jpdb.io') throw new Error('Unexpected external request');
      if (url.pathname.endsWith('/review')) {
        fixture.attempts.push(body);
        if (fixture.reviewMode === 'drop') throw new TypeError('Simulated lost response');
        if (fixture.reviewMode === 'hold') await hold(options.signal);
        const card = fixture.cards.find(c => c.vid === body.vid && c.sid === body.sid);
        if (card) { card.card_state = ['known']; card.due_at = Date.now() + 86400000; }
        return new Response(null, {status:204});
      }
      if (url.pathname.endsWith('/lookup-vocabulary')) {
        fixture.lookupCount++;
        if (fixture.failLookup) return new Response('Temporary service failure', {status:503});
        if (fixture.holdSecondLookup && fixture.lookupCount === 2) await hold(options.signal);
        if (fixture.holdLookups || (fixture.holdRefresh && fixture.attempts.length)) await hold(options.signal);
        return new Response(JSON.stringify({vocabulary_info:body.list.map(([vid,sid]) => {
          const card = fixture.cards.find(c => c.vid === vid && c.sid === sid);
          return body.fields.map(field => card?.[field]);
        })}), {status:200});
      }
      if (url.pathname.endsWith('/list-user-decks')) return Response.json({decks:[[1,'Fixture']]});
      if (url.pathname.endsWith('/deck/list-vocabulary')) return Response.json({vocabulary:fixture.cards.map(c=>[c.vid,c.sid])});
      if (url.pathname.endsWith('/ping')) return new Response(null,{status:204});
      throw new Error('Unexpected JPDB endpoint: ' + url.pathname);
    };
  });
}

async function app({ extension = source } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jpdb-browser-test-'));
  const launch = () => chromium.launchPersistentContext(profile, {
    ...(process.env.JPDB_TEST_EXECUTABLE ? {executablePath:process.env.JPDB_TEST_EXECUTABLE} : {channel:'chromium'}),
    headless:true, viewport:{width:1280,height:800},
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  let context = await launch();
  const a = { context, profile, errors:[] };
  browserVersion = context.browser()?.version();
  apps.add(a);
  context.on('page', page => page.on('pageerror', error => a.errors.push(error.message)));
  await context.route(/^https?:\/\//, route => route.request().url().startsWith('https://chatgpt.com/')
    ? route.fulfill({status:200,contentType:'text/html',body:html}) : route.abort('blockedbyclient'));
  a.worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await installTransport(a.worker);
  browserVersion = await a.worker.evaluate(() => navigator.userAgent.match(/(?:Headless)?Chrome\/([\d.]+)/)?.[1] || navigator.userAgent);
  a.id = new URL(a.worker.url()).host;
  await a.worker.evaluate(async fakeKey => { await chrome.storage.local.set({enabled:true,apiKey:fakeKey}); }, fakeKey);
  a.page = async name => {
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/fixture-' + name);
    await page.locator('#ambient-jpdb-host .launcher').waitFor({state:'visible'});
    return page;
  };
  a.configure = async patch => a.worker.evaluate(patch => Object.assign(globalThis.__jpdbFixture, patch), patch);
  a.release = async () => a.worker.evaluate(() => {
    const f=globalThis.__jpdbFixture; f.holdLookups=false; f.holdRefresh=false;
    f.holds.splice(0).forEach(resolve=>resolve());
  });
  a.attempts = async () => a.worker.evaluate(() => globalThis.__jpdbFixture.attempts.length);
  a.restart = async () => {
    // A cold browser relaunch with the SAME profile and unpacked folder
    // deterministically checks storage recovery and in-place folder upgrades.
    // Chrome's internal extensions page and in-process reload can be unavailable
    // in headless Chromium, so hot re-injection remains a live-browser gate.
    await context.close();
    context = await launch();
    a.context = context;
    context.on('page', page => page.on('pageerror', error => a.errors.push(error.message)));
    await context.route(/^https?:\/\//, route => route.request().url().startsWith('https://chatgpt.com/')
      ? route.fulfill({status:200,contentType:'text/html',body:html}) : route.abort('blockedbyclient'));
    a.worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
    await installTransport(a.worker);
  };
  a.close = async () => {
    await context.close(); apps.delete(a); fs.rmSync(profile,{recursive:true,force:true});
  };
  return a;
}

async function ui(page) {
  return await page.locator('#ambient-jpdb-host').evaluate(host => {
    const s=host.shadowRoot, popup=s.querySelector('.popup');
    return {open:!popup.classList.contains('hidden'),status:s.querySelector('.status').textContent,
      word:s.querySelector('.word').textContent,loadingText:s.querySelector('.loading').textContent,answer:!s.querySelector('.answer').classList.contains('hidden'),
      notice:s.querySelector('.notice-text').textContent,
      disabled:[...s.querySelectorAll('[data-grade]')].every(button=>button.disabled),
      updateHidden:s.querySelector('.update-hint').classList.contains('state-hidden')};
  });
}
async function cardReady(page, spelling) {
  try {
    await until(async()=>{const s=await ui(page);return s.open && s.word===spelling && !/Loading|Saving|Syncing|Checking/i.test(s.status);}, 'ready card ' + spelling);
  } catch (error) {
    // A timed-out fixture must explain whether the failure was extension state,
    // service-worker lifecycle, or the test transport; no keys or card text leak.
    const visible = await ui(page).catch(e => ({error:String(e)}));
    const workers = await Promise.all(page.context().serviceWorkers().map(async worker => {
      try {
        return await worker.evaluate(async () => {
          const session = (await chrome.storage.session.get('sharedReviewSessionV3')).sharedReviewSessionV3;
          const fixture = globalThis.__jpdbFixture;
          return {fixtureInstalled:!!fixture, requests:fixture?.requests?.map(r=>r.endpoint) || [],
            attemptCount:fixture?.attempts?.length || 0,
            cardCount:fixture?.cards?.length || 0,
            loadState:{loading:session?.loading,cardId:session?.card?.vid,error:session?.error?.code,
              revision:session?.revision},
            workerVersion:chrome.runtime.getManifest().version};
        });
      } catch (e) { return {error:String(e)}; }
    }));
    throw new Error(`${error.message}; ui=${JSON.stringify(visible)}; workers=${JSON.stringify(workers)}`);
  }
}
async function runCase(name, fn) {
  if (process.env.JPDB_TEST_CASE && !name.includes(process.env.JPDB_TEST_CASE)) return;
  const start=Date.now();
  const detail=await fn();
  results.push({name,status:'passed',elapsedMs:Date.now()-start,...detail});
  console.log('PASS ' + name);
}

async function run() {
  await runCase('Immediate loading, cancellable popup, and single owner across tabs', async()=>{
    const a=await app();
    try {
      await a.configure({holdLookups:true});
      const one=await a.page('loading-one'), two=await a.page('loading-two');
      const start=Date.now();
      await one.locator('.launcher').click();
      await one.locator('.popup').waitFor({state:'visible',timeout:1500});
      const visibleMs=Date.now()-start;
      assert.match((await ui(one)).status,/Loading/);
      await until(()=>a.worker.evaluate(()=>globalThis.__jpdbFixture.holds.length>0),'held initial lookup');
      await one.locator('.launcher').click();
      assert.equal((await ui(one)).open,false);
      await a.release();
      await until(()=>a.worker.evaluate(async()=>!(await chrome.storage.session.get('sharedReviewSessionV3')).sharedReviewSessionV3.loading),'load complete while closed');
      assert.equal((await ui(one)).open,false,'late load must not reopen dismissed popup');
      await one.locator('.launcher').click(); await cardReady(one,'猫');
      await two.locator('.launcher').click(); await cardReady(two,'猫');
      await until(async()=>!(await ui(one)).open,'former owner closes');
      assert.equal((await ui(two)).open,true);
      await one.bringToFront();
      assert.equal((await ui(one)).open,false,'tab switching does not open review');
      const dimensions=await one.locator('#ambient-jpdb-host').boundingBox();
      assert.equal(dimensions.width,0); assert.equal(dimensions.height,0);
      assert.equal(await a.attempts(),0);
      assert.deepEqual(a.errors,[]);
      return {visibleMs,reviewPosts:0,formerOwnerClosed:true,lateReopen:false};
    } finally {await a.close();}
  });

  await runCase('A large first-time scan explains its progress before allowing review', async()=>{
    const a=await app();
    try {
      await a.worker.evaluate(()=>{
        const f=globalThis.__jpdbFixture;
        f.cards=Array.from({length:850},(_,i)=>({
          vid:1000+i, sid:1, spelling:`entry${i}`,reading:'test',meanings:['test'],
          card_state:['due'],due_at:1000+i
        }));
        f.holdSecondLookup=true;
      });
      const p=await a.page('long-initial-load');
      await p.locator('.launcher').click();
      await until(async()=>/Checking review eligibility: 400 of 850/.test((await ui(p)).loadingText),
        'first 400-word progress indicator',12000);
      const view=await ui(p);
      assert.equal(view.word,'','partially scanned results must not be presented as complete');
      assert.match(view.loadingText,/400 of 850/);
      await a.release();
      await cardReady(p,'entry0');
      assert.equal(await a.attempts(),0);
      return {initialProgress:'400/850',reviewPosts:0};
    } finally {await a.close();}
  });

  await runCase('Accepted review advances during slow refresh; keyboard, focus, and layout recover',async()=>{
    const a=await app();
    try {
      const p=await a.page('grade');
      await p.locator('#prompt-textarea').fill('Typing stays in ChatGPT');
      await p.locator('.launcher').click(); await cardReady(p,'猫');
      await a.configure({holdRefresh:true});
      // Dispatch both real keyboard events without waiting for the reveal message round trip.
      await p.locator('.popup').evaluate(popup=>{
        popup.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
        popup.dispatchEvent(new KeyboardEvent('keydown',{key:'4',code:'Digit4',bubbles:true}));
      });
      await cardReady(p,'犬');
      assert.equal(await a.attempts(),1);
      await until(()=>a.worker.evaluate(()=>globalThis.__jpdbFixture.holds.length>0),'held post-grade refresh');
      await p.locator('.launcher').click(); assert.equal((await ui(p)).open,false);
      await p.locator('.launcher').click(); await cardReady(p,'犬');
      await p.locator('.popup').press('Escape');
      await until(()=>p.locator('#prompt-textarea').evaluate(el=>document.activeElement===el),'focus restored to composer');
      await p.keyboard.type(' 1 2 3 4 5 ');
      assert.equal(await a.attempts(),1,'typing must not submit reviews');
      await p.locator('.launcher').click(); await cardReady(p,'犬');
      await p.locator('.reveal').click();
      await until(async()=>(await ui(p)).answer,'answer revealed');
      await p.locator('.close').click();
      await p.locator('.launcher').click(); await cardReady(p,'犬');
      assert.equal((await ui(p)).answer,false,'close resets ungraded answer');
      await p.locator('form').evaluate(form=>form.remove());
      assert.equal((await ui(p)).open,true,'composer replacement cannot strand open popup');
      await p.evaluate(()=>{
        const form=document.createElement('form'); form.style.left='420px';
        form.innerHTML='<textarea id="prompt-textarea" aria-label="Message"></textarea>';
        document.querySelector('main').appendChild(form);
      });
      await until(()=>p.locator('.launcher').evaluate(el=>el.style.left==='378px'),'launcher repositions to new composer');
      await p.screenshot({path:path.join(output,'review-popup.png')});
      await a.release();
      assert.deepEqual(a.errors,[]);
      return {reviewPosts:1,nextCardBeforeRefresh:true,composerFocusRestored:true,rapidRevealAndGrade:true};
    } finally {await a.close();}
  });

  await runCase('Unknown write survives reload and can be skipped without resending',async()=>{
    const a=await app();
    try {
      let p=await a.page('uncertain');
      await p.locator('.launcher').click(); await cardReady(p,'猫');
      await a.configure({reviewMode:'drop'});
      await p.locator('.reveal').click();
      await p.locator('[data-grade="okay"]').click();
      await until(async()=>/uncertain/.test((await ui(p)).status),'uncertain write state');
      assert.equal(await a.attempts(),1);
      assert.equal((await ui(p)).disabled,true);
      await p.screenshot({path:path.join(output,'review-recovery.png')});
      await p.locator('.reconcile').click();
      await until(async()=>{const s=await ui(p);return /uncertain/.test(s.status)&&s.disabled;},'unchanged state stays uncertain');
      assert.match((await ui(p)).notice,/has not changed/,'reconciliation explains its observed result');
      assert.equal(await a.attempts(),1);
      await a.restart();
      p = await a.page('uncertain-restarted');
      assert.equal(await p.locator('#ambient-jpdb-host').count(),1,'one UI after cold relaunch');
      await p.locator('.launcher').click();
      await until(async()=>/uncertain/.test((await ui(p)).status),'uncertain survives browser relaunch');
      assert.equal(await a.attempts(),0,'reload must not resend the prior request');
      const savedKey=await a.worker.evaluate(async()=> (await chrome.storage.local.get('apiKey')).apiKey);
      assert.equal(savedKey,fakeKey);
      await p.locator('.continue-review').click(); await cardReady(p,'犬');
      const recovery=await a.worker.evaluate(async()=>{
        const data=await chrome.storage.local.get(null);
        return Object.values(Object.fromEntries(Object.entries(data).filter(([key])=>key.startsWith('jpdbReviewRecoveryV4:'))));
      });
      assert.equal(recovery[0].active,null);
      assert.equal(recovery[0].quarantines.length,1);
      assert.equal(recovery[0].quarantines[0].card.vid,101);
      assert.equal(await a.attempts(),0);
      assert.deepEqual(a.errors,[]);
      return {postsBeforeReload:1,postsAfterReload:0,withheldCards:1,apiKeyPreserved:true};
    } finally {await a.close();}
  });

  await runCase('Settings permission paths, verified release notices, and safe diagnostics',async()=>{
    const a=await app();
    try {
      const p=await a.page('settings');
      await p.locator('.launcher').click(); await cardReady(p,'猫');
      const options=await a.context.newPage();
      await options.goto(`chrome-extension://${a.id}/options.html`);
      await until(()=>options.locator('#apiKey').inputValue().then(value=>value===fakeKey),'saved key visible in settings');
      await options.locator('#updateRepository').fill('Example/JPDB-Review-Button');
      await options.locator('#updateEnabled').check();
      await options.evaluate(()=>{chrome.permissions.request=async()=>false;});
      await options.locator('#updateSave').click();
      await until(()=>options.locator('#updateStatus').textContent().then(text=>/access|allow|needed/i.test(text)),'permission denied state');
      assert.equal(await a.worker.evaluate(()=>globalThis.__jpdbFixture.requests.filter(r=>r.origin==='https://api.github.com').length),0);
      await a.configure({permission:true});
      await options.evaluate(()=>{chrome.permissions.request=async()=>true;});
      await options.locator('#updateCheck').click();
      await options.locator('#updateRelease').waitFor({state:'visible'});
      assert.match(await options.locator('#updateRelease').getAttribute('href'),/^https:\/\/github.com\/example\/jpdb-review-button\/releases\/tag\/v0\.4\.0$/);
      await until(async()=>!(await ui(p)).updateHidden,'case-insensitive verified popup release notice');
      const alarm=await a.worker.evaluate(()=>chrome.alarms.get('jpdb-release-check'));
      assert.equal(alarm.periodInMinutes,1440);
      await a.worker.evaluate(async version=>{
        const data=await chrome.storage.local.get('jpdbUpdateState');
        await chrome.storage.local.set({jpdbUpdateState:{...data.jpdbUpdateState,available:true,status:'available',
          latestVersion:version,tag:'v'+version,releaseUrl:`https://github.com/example/jpdb-review-button/releases/tag/v${version}`,
          assetName:`KoBa_v${version}.zip`}});
      },manifest.version);
      await until(async()=>(await ui(p)).updateHidden,'already-installed release notice hidden');
      await options.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}});});
      await options.locator('#diagCopy').click();
      await options.locator('#diagnosticExport').waitFor({state:'visible'});
      const diagnostic=await options.locator('#diagnosticExport').inputValue();
      assert.equal(JSON.parse(diagnostic).extensionVersion,manifest.version);
      for (const forbidden of [fakeKey,'猫','ねこ','Authorization','sharedReviewSessionV3']) assert.ok(!diagnostic.includes(forbidden));
      await a.configure({failLookup:true});
      await options.locator('#sync').click();
      await until(()=>options.locator('#status').textContent().then(text=>/^Sync failed:/.test(text)),'failed force sync reported honestly');
      assert.equal((await ui(p)).disabled,true,'review grades stay disabled until the read error is resolved');
      await options.screenshot({path:path.join(output,'settings.png'),fullPage:true});
      assert.deepEqual(a.errors,[]);
      return {githubCallsWithPermissionDenied:0,scheduledMinutes:alarm.periodInMinutes,diagnosticContainsSecrets:false,
        permissionPrompt:'simulated allow/deny decisions; native prompt not exercised'};
    } finally {await a.close();}
  });

  if (fs.existsSync(upgradeFrom) && process.env.JPDB_TEST_UPGRADE === '1') {
    await runCase('Same-folder v0.3.1 upgrade preserves settings across a browser relaunch',async()=>{
      const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jpdb-upgrade-source-'));
      fs.cpSync(upgradeFrom,folder,{recursive:true});
      const a=await app({extension:folder});
      try {
        const p=await a.page('upgrade');
        fs.cpSync(source,folder,{recursive:true});
        await a.restart();
        await until(()=>a.worker.evaluate(()=>chrome.runtime.getManifest().version).then(version=>version===manifest.version),'new installed manifest');
        const upgraded = await a.page('upgraded');
        assert.equal(await upgraded.locator('.notice').count(),1,'new KoBa UI loads after relaunch');
        assert.equal(await upgraded.locator('#ambient-jpdb-host').count(),1);
        assert.equal(await a.worker.evaluate(async()=> (await chrome.storage.local.get('apiKey')).apiKey),fakeKey);
        await upgraded.locator('.launcher').click();
        try { await cardReady(upgraded,'猫'); }
        catch (error) {
          const state = await ui(upgraded).catch(e => ({uiError:String(e)}));
          const observed = await a.worker.evaluate(async () => ({
            version:chrome.runtime.getManifest().version,
            endpoints:globalThis.__jpdbFixture?.requests?.map(r=>r.endpoint) || [],
            attempts:globalThis.__jpdbFixture?.attempts?.length || 0,
            localKeys:Object.keys(await chrome.storage.local.get(null)).filter(x=>/session|review|queue|key|enabled/i.test(x))
          })).catch(e => ({workerError:String(e)}));
          throw new Error(`${error.message}; ui=${JSON.stringify(state)}; worker=${JSON.stringify(observed)}`);
        }
        assert.deepEqual(a.errors,[]);
        return {from:'0.3.1',to:manifest.version,apiKeyPreserved:true,newUiLoaded:true,
          existingTabHotReinjection:'not tested in headless CI'};
      } finally {await a.close();fs.rmSync(folder,{recursive:true,force:true});}
    });
  } else if (fs.existsSync(upgradeFrom)) {
    const reason = 'Requires a real supported extension reload; headless Chromium may cache the previous service worker across a folder replacement';
    skippedScenarios.push({name:'Same-folder v0.3.1 upgrade',reason});
    console.log('SKIP Same-folder v0.3.1 upgrade: ' + reason);
  }
}

run().then(()=>{
  const runtimeFiles=Object.fromEntries(fs.readdirSync(source).filter(name=>fs.statSync(path.join(source,name)).isFile())
    .sort().map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]));
  const report={candidate:manifest.version,source,executedAt:new Date().toISOString(),
    browserVersion,browserExecutable:process.env.JPDB_TEST_EXECUTABLE || chromium.executablePath(),method:'Actual unpacked MV3 extension; isolated profile; controlled ChatGPT layout and fake JPDB/GitHub transport',
    limits:['No live JPDB or ChatGPT account','No installed Chrome/Brave user-profile test','Native optional-permission prompt simulated','Exact hot extension upgrade is an opt-in live-browser gate'],runtimeFiles,results,skippedScenarios};
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${results.length} browser scenarios passed.`);
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  for(const a of apps) {await a.context.close().catch(()=>{});fs.rmSync(a.profile,{recursive:true,force:true});}
});
