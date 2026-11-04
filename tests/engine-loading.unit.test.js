'use strict';
// Unit tests for the engine download pipeline helpers, extracted from
// chess-ai-bot.user.js and exercised in a vm sandbox:
//   headerValue / sha256Hex / xhrText / xhrBinary (truncation + hash checks)
//   purgeModelCache (cache self-heal helper)
//
//   node tests/engine-loading.unit.test.js

const vm = require('vm');
const crypto = require('crypto');
const { extractFunction, readUserscript } = require('./lib/extract');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// crypto.subtle.digest resolves on the thread pool, so poll until the handler
// fires instead of assuming a fixed number of ticks.
async function waitFor(fn, ms = 3000) {
    const start = Date.now();
    for (;;) {
        const v = fn();
        if (v !== null && v !== undefined) return v;
        if (Date.now() - start > ms) throw new Error('timed out waiting for callback');
        await new Promise((r) => setTimeout(r, 5));
    }
}

// ── Build the sandbox ────────────────────────────────────────────────────────
const src = readUserscript();
const fnSource = ['headerValue', 'sha256Hex', 'xhrText', 'xhrBinary', 'purgeModelCache']
    .map((n) => extractFunction(src, n)).join('\n\n');

const state = { lastReq: null, deleted: [], dbMode: 'ok' };
const sandbox = {
    console,
    window: { crypto: crypto.webcrypto },
    JS_TIMEOUT_MS: 30000,
    WASM_TIMEOUT_MS: 300000,
    GM_xmlhttpRequest: (o) => { state.lastReq = o; },
    getEngineById: (id) => ({ id, cacheKey: id }),
    openCache: (cb) => { if (state.dbMode === 'no-db') cb(new Error('no db'), null); else cb(null, { fake: true }); },
    deleteCache: (db, key, cb) => { state.deleted.push(key); if (cb) cb(); },
};
vm.createContext(sandbox);
vm.runInContext(fnSource, sandbox);
const api = vm.runInContext('({ headerValue, sha256Hex, xhrText, xhrBinary, purgeModelCache })', sandbox);

// ── Tiny async test runner ───────────────────────────────────────────────────
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

// Drive one xhrBinary call: fire(req) triggers a response handler.
async function callBinary(opts, fire) {
    let outcome = null;
    api.xhrBinary('https://cdn.test/file.wasm',
        (bytes) => { outcome = { ok: true, bytes }; },
        (err) => { outcome = { ok: false, error: err }; },
        opts);
    const req = state.lastReq;
    fire(req);
    await waitFor(() => outcome);
    return { outcome, req };
}
async function callText(fire) {
    let outcome = null;
    api.xhrText('https://cdn.test/file.js',
        (text) => { outcome = { ok: true, text }; },
        (err) => { outcome = { ok: false, error: err }; });
    const req = state.lastReq;
    fire(req);
    await waitFor(() => outcome);
    return { outcome, req };
}
const hexToBuffer = (hex) => Buffer.from(hex, 'hex');
const bytesBuffer = (arr) => new Uint8Array(arr).buffer;

test('headerValue parses GM responseHeaders strings', () => {
    assert(api.headerValue('content-length: 1234\r\ncontent-type: application/wasm', 'content-length') === '1234');
    assert(api.headerValue('Content-Length: 42\nX: y', 'content-length') === '42');
    assert(api.headerValue('  X-Foo :   abc  \r\n', 'x-foo') === 'abc');
    assert(api.headerValue('etag: "x"', 'content-length') === null);
    assert(api.headerValue(null, 'content-length') === null);
    assert(api.headerValue('', 'content-length') === null);
});

test('sha256Hex matches Node crypto for known vectors', async () => {
    const abc = new Uint8Array(Buffer.from('abc'));
    assert(await api.sha256Hex(abc) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const empty = new Uint8Array(0);
    assert(await api.sha256Hex(empty) === sha256(Buffer.alloc(0)));
});

test('sha256Hex returns null when crypto.subtle is unavailable', async () => {
    const saved = sandbox.window.crypto;
    sandbox.window.crypto = undefined;
    try { assert(await api.sha256Hex(new Uint8Array([1])) === null); }
    finally { sandbox.window.crypto = saved; }
});

test('xhrText returns body on 200 and errors on 404/network/timeout', async () => {
    let r = await callText((req) => req.onload({ status: 200, responseText: 'console.log(1)' }));
    assert(r.outcome.ok && r.outcome.text === 'console.log(1)');
    assert(r.req.timeout === 30000, 'default timeout should be JS_TIMEOUT_MS');

    r = await callText((req) => req.onload({ status: 404, responseText: 'nope' }));
    assert(!r.outcome.ok && /HTTP 404/.test(r.outcome.error.message));

    r = await callText((req) => req.onerror(new Error('boom')));
    assert(!r.outcome.ok && /Network error/.test(r.outcome.error.message));

    r = await callText((req) => req.ontimeout());
    assert(!r.outcome.ok && /Timeout/.test(r.outcome.error.message));
});

test('xhrBinary accepts a good download with matching sha256', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { outcome, req } = await callBinary(
        { sha256: sha256(Buffer.from(bytes)), timeoutMs: 12345 },
        (r) => r.onload({ status: 200, response: bytesBuffer([1, 2, 3, 4]), responseHeaders: 'content-length: 4' }));
    assert(req.timeout === 12345, 'opts.timeoutMs should override the default');
    assert(outcome.ok, outcome.error && outcome.error.message);
    // ArrayBuffer.isView works cross-realm (the bytes are created in the vm).
    assert(ArrayBuffer.isView(outcome.bytes) && outcome.bytes.length === 4);
});

test('xhrBinary rejects a truncated download (Content-Length mismatch)', async () => {
    const { outcome } = await callBinary({ sha256: null },
        (r) => r.onload({ status: 200, response: bytesBuffer([1, 2, 3]), responseHeaders: 'content-length: 4096\r\ncontent-type: application/wasm' }));
    assert(!outcome.ok && /Truncated download/.test(outcome.error.message), 'expected truncation error');
});

test('xhrBinary rejects a hash mismatch (corrupted bytes)', async () => {
    const goodHash = sha256(Buffer.from(new Uint8Array([1, 2, 3])));
    const { outcome } = await callBinary({ sha256: goodHash },
        (r) => r.onload({ status: 200, response: bytesBuffer([9, 9, 9]), responseHeaders: 'content-length: 3' }));
    assert(!outcome.ok && /Integrity check failed/.test(outcome.error.message), 'expected integrity error');
});

test('xhrBinary skips the hash check when no sha256 is pinned', async () => {
    const { outcome } = await callBinary({},
        (r) => r.onload({ status: 200, response: bytesBuffer([5, 5]), responseHeaders: 'content-length: 2' }));
    assert(outcome.ok && outcome.bytes.length === 2);
});

test('xhrBinary surfaces HTTP errors and timeouts', async () => {
    let r = await callBinary({}, (req) => req.onload({ status: 403 }));
    assert(!r.outcome.ok && /HTTP 403/.test(r.outcome.error.message));

    r = await callBinary({}, (req) => req.ontimeout());
    assert(!r.outcome.ok && /Binary timeout/.test(r.outcome.error.message));

    r = await callBinary({}, (req) => req.onerror(new Error('x')));
    assert(!r.outcome.ok && /Binary download failed/.test(r.outcome.error.message));
});

test('purgeModelCache deletes all keys for the model in order', async () => {
    state.deleted = [];
    state.dbMode = 'ok';
    await new Promise((resolve) => api.purgeModelCache('sf19_small', resolve));
    assert(JSON.stringify(state.deleted) === JSON.stringify([
        'sf19_small_js', 'sf19_small_wasm', 'sf19_small_patched', 'sf19_small_patched_module', 'sf19_small',
    ]), 'unexpected deletion order: ' + state.deleted.join(','));
});

test('purgeModelCache still calls back when IndexedDB is unavailable', async () => {
    state.deleted = [];
    state.dbMode = 'no-db';
    let called = false;
    await new Promise((resolve) => api.purgeModelCache('sf9_00', () => { called = true; resolve(); }));
    assert(called, 'callback not invoked');
    assert(state.deleted.length === 0, 'should not attempt deletions without a db');
});

// ── Run ──────────────────────────────────────────────────────────────────────
(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('  PASS  ' + name); }
        catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
    }
    console.log('\n' + (failed ? failed + ' test(s) FAILED' : tests.length + ' unit tests passed') + '\n');
    process.exit(failed ? 1 : 0);
})();
