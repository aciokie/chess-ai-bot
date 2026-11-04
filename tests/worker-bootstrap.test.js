'use strict';
// Simulation tests for the patched-worker bootstrap produced by
// buildWasmPatchedEngine():
//   - launch message handling (bytes mode + compiled-module mode)
//   - the self.fetch mock: intercepts ONLY the first unconsumed fetch,
//     passes everything else through to the real fetch
//   - the `ie[e].apply(null,fe)` loader patch (must not throw)
//   - the 3s alive beacon + compiled-module capture postMessage
//
//   node tests/worker-bootstrap.test.js

const vm = require('vm');
const { extractFunction, readUserscript } = require('./lib/extract');

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
async function waitFor(fn, ms = 3000) {
    const start = Date.now();
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() - start > ms) throw new Error('timed out waiting for ' + fn);
        await new Promise((r) => setTimeout(r, 5));
    }
}

// ── Sandbox #1: run buildWasmPatchedEngine to capture the bootstrap + launch ──
const src = readUserscript();
const captured = { blobParts: null, workerPosts: [] };
class MockBlob { constructor(parts) { captured.blobParts = parts.map(String); } }
class MockWorker {
    constructor(url) { this.url = String(url); }
    postMessage(msg, transfer) { captured.workerPosts.push({ msg, transfer: transfer || null }); }
    terminate() {}
}
const buildSandbox = { console, Blob: MockBlob, Worker: MockWorker, URL: { createObjectURL: () => 'blob:mock-worker' }, setTimeout, setInterval };
vm.createContext(buildSandbox);
vm.runInContext(extractFunction(src, 'buildWasmPatchedEngine'), buildSandbox);
const buildWasmPatchedEngine = vm.runInContext('buildWasmPatchedEngine', buildSandbox);
assert(typeof buildWasmPatchedEngine === 'function', 'buildWasmPatchedEngine not extracted');

// ── Sandbox #2 factory: a fake worker global ("self") to run the bootstrap ──
function makeWorkerEnv() {
    const posts = [];
    const transfers = [];
    const passThrough = [];
    const intervals = [];
    const self = {
        postMessage: (m, t) => { posts.push(m); transfers.push(t); },
        fetch: (u) => { passThrough.push(String(u)); return Promise.resolve({ passthrough: true }); },
        location: { href: 'blob:https://www.chess.com/worker-uuid' },
    };
    const env = {
        console,
        self,
        // Bare `fetch(...)` inside the engine code must resolve to the CURRENT
        // self.fetch (the bootstrap replaces it at runtime).
        fetch: (...args) => env.self.fetch(...args),
        WebAssembly: { instantiate: () => Promise.resolve({ module: { tag: 'compiled' }, instance: {} }) },
        Response: class Response {
            constructor(body, init) { this.body = body; this.init = init; }
            arrayBuffer() { return Promise.resolve(this.body.buffer ? this.body.buffer : this.body); }
        },
        Headers: class Headers { constructor(h) { this.h = h; } },
        setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
        performance: { now: () => 1234 },
    };
    vm.createContext(env);
    return { env, posts, transfers, passThrough, intervals, self };
}

const JS_CODE_BYTES = `
self.__loaded = true;
var ie = {}; var e = 1; var fe = [];
ie[e].apply(null, fe);                                  // must be guarded by the bootstrap patch
fetch("first-fetch").then(function(r){ return r.arrayBuffer(); })
    .then(function(b){ self.postMessage("probe:user-bytes " + b.byteLength); });
fetch("second-fetch").then(function(r){ self.postMessage("probe:second-passthrough " + (r && r.passthrough ? "yes" : "no")); });
WebAssembly.instantiate(new Uint8Array([9, 9]), {}).then(function(res){ self.postMessage("probe:instantiate-ok " + !!res.module); });
`;

const JS_CODE_MODULE = `
WebAssembly.instantiate(new Uint8Array([1]), {}).then(function(res){ self.postMessage("probe:inst-ok " + (!!res && !!res.instance)); });
`;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('bytes mode: bootstrap installs, beacons, and launches the loader', async () => {
    captured.workerPosts = [];
    buildWasmPatchedEngine(JS_CODE_BYTES, new Uint8Array([0, 1, 2, 3]), null, 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-lite-single.wasm');
    const launch = captured.workerPosts.pop();
    assert(launch && launch.msg.__type === 'launch', 'expected a launch message');
    const bootstrapCode = captured.blobParts[0];

    const W = makeWorkerEnv();
    vm.runInContext(bootstrapCode, W.env);
    assert(W.posts.includes('__probe:bootstrap-ready'), 'bootstrap-ready probe missing');
    assert(W.intervals.length === 1 && W.intervals[0].ms === 3000, '3s beacon interval missing');

    W.self.onmessage({ data: launch.msg });
    assert(W.posts.includes('__probe:bytes-received n=4'), 'bytes-received probe missing');
    assert(W.self.__loaded === true, 'loader code did not run');
    assert(!W.posts.some(p => typeof p === 'string' && p.startsWith('__probe:loader-error')),
        'loader threw — ie[e].apply patch did not apply');

    await waitFor(() => W.posts.includes('probe:user-bytes 4'));
    await waitFor(() => W.posts.includes('probe:instantiate-ok true'));

    assert(W.passThrough.includes('second-fetch'), 'second fetch was not passed through');
    assert(!W.passThrough.includes('first-fetch'), 'first (WASM) fetch should be intercepted');
    assert(W.posts.some(p => typeof p === 'string' && p.startsWith('__probe:fetch first-fetch')), 'fetch probe missing');

    const modulePost = W.posts.findIndex(p => p && typeof p === 'object' && p.__type === 'module');
    assert(modulePost !== -1, 'compiled module was not captured/posted');
    assert(W.posts[modulePost].module && W.posts[modulePost].module.tag === 'compiled', 'wrong module forwarded');
    assert(Array.isArray(W.transfers[modulePost]), 'module should be posted with a transfer list');
});

test('module mode: instantiate is redirected to the compiled module', async () => {
    captured.workerPosts = [];
    const compiled = { tag: 'precompiled' };
    buildWasmPatchedEngine(JS_CODE_MODULE, null, compiled, 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.wasm');
    const launch = captured.workerPosts.pop();
    assert(launch && launch.msg.__type === 'launch-module', 'expected a launch-module message');
    assert(launch.msg.wasmModule === compiled, 'compiled module not attached');

    const W = makeWorkerEnv();
    vm.runInContext(captured.blobParts[0], W.env);
    W.self.onmessage({ data: launch.msg });

    assert(W.posts.includes('__probe:module-mode'), 'module-mode probe missing');
    assert(W.posts.includes('__probe:instantiate-from-module'), 'instantiate redirect probe missing');
    await waitFor(() => W.posts.includes('probe:inst-ok true'));
    assert(!W.posts.some(p => p && typeof p === 'object' && p.__type === 'module'),
        'module must NOT be re-posted when it was provided by the main thread');
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('  PASS  ' + name); }
        catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
    }
    console.log('\n' + (failed ? failed + ' test(s) FAILED' : tests.length + ' bootstrap tests passed') + '\n');
    process.exit(failed ? 1 : 0);
})();
