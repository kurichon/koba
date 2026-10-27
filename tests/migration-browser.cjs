// Real Chromium check of original unpacked path -> actual directory content replacement.
// Uses a disposable browser profile and fake local data; no JPDB or account traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'koba-migration-browser-'));
const old = path.join(base, 'old-extension');
const payload = path.join(base, 'AppData', 'KoBa', 'Extension');
const backup = path.join(base, 'preserved-backup');
const profile = path.join(base, 'browser-profile');
const fakeValue = 'no-live-key-do-not-send';
let context = null;
let stage = 'start';
const watchdog = setTimeout(() => { console.error('STALLED migration-browser stage:', stage); process.exit(2); }, 90000);

async function launch() {
    stage = 'launch';
    context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: ['--disable-extensions-except=' + old, '--load-extension=' + old]
    });
    stage = 'service-worker';
    const worker = context.serviceWorkers()[0] ||
        await context.waitForEvent('serviceworker', { timeout: 15000 });
    // The MV3 worker can be observable before the Chrome extension APIs are ready.
    for (let i = 0; i < 100; i++) {
        if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false))
            return { worker, id: new URL(worker.url()).host };
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Extension service worker started but storage API never became ready: ' + worker.url());
}

(async () => {
    fs.cpSync(path.join(__dirname, '..', 'extension'), old, { recursive: true });
    const original = await launch();
    stage = 'store-sentinel';
    await original.worker.evaluate(value => chrome.storage.local.set({ kobaMigrationSentinel: value }), fakeValue);
    stage = 'close-first';
    await context.close();
    context = null;
    fs.mkdirSync(path.dirname(payload), { recursive: true });
    fs.renameSync(old, backup);
    fs.cpSync(backup, payload, { recursive: true });
    fs.cpSync(payload, old, { recursive: true }); // real original path, no link
    const linked = await launch();
    stage = 'read-sentinel';
    const restored = await linked.worker.evaluate(async () =>
        (await chrome.storage.local.get('kobaMigrationSentinel')).kobaMigrationSentinel);
    assert.equal(linked.id, original.id, 'unpacked extension ID changed despite keeping the same real path');
    assert.equal(restored, fakeValue, 'browser-local storage was detached from the original ID');
    stage = 'close-second';
    await context.close();
    context = null;
    console.log('PASS Chromium: original real directory path preserved extension ID and local storage after restart.');
})().catch(error => { console.error('FAIL', stage, error); process.exitCode = 1; })
.finally(async () => {
    clearTimeout(watchdog);
    try { await context?.close(); } catch {}
    try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
});
