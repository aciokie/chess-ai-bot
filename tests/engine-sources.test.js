'use strict';
// Offline checks for the engine source registry and the 11.7.4 reliability
// changes (multi-CDN chains, pinned hashes, self-heal, cloud-mode removal).
//
//   node tests/engine-sources.test.js
//
// Everything here is static analysis + registry parsing; no network required.
// For live CDN + hash verification see tests/verify-engine-sources.js.

const { execFileSync } = require('child_process');
const { USERSCRIPT, readUserscript, parseRegistry } = require('./lib/extract');

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { failures++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const src = readUserscript();
const engines = parseRegistry(src);
const wasmModels = engines.filter(m => m.format === 'wasm');
const asmModels = engines.filter(m => m.format === 'asmjs');

console.log('\n== Registry structure ==');
check('registry parses and has 7 models', () => {
    assert(Array.isArray(engines), 'not an array');
    assert(engines.length === 7, 'expected 7 models, got ' + engines.length);
});
check('ids and cacheKeys are unique and complete', () => {
    const ids = engines.map(m => m.id);
    assert(new Set(ids).size === ids.length, 'duplicate ids');
    for (const m of engines) {
        assert(m.id && m.cacheKey && m.label, m.id + ' missing id/cacheKey/label');
        assert(['wasm', 'asmjs'].includes(m.format), m.id + ' bad format ' + m.format);
        assert(Number.isInteger(m.maxDepth) && m.maxDepth > 0, m.id + ' bad maxDepth');
        assert(Array.isArray(m.sources) && m.sources.length >= 1, m.id + ' has no sources');
    }
});
check('every model has at least one non-github (public CDN) source', () => {
    for (const m of engines) {
        assert(m.sources.some(s => s.label !== 'github' && s.label !== 'mirror'),
            m.id + ' relies only on the release mirror');
    }
});
check('wasm sources carry js + wasm + pinned sha256', () => {
    for (const m of wasmModels) {
        for (const s of m.sources) {
            assert(s.label && s.js && s.wasm, m.id + '/' + s.label + ' incomplete source');
            assert(/^[0-9a-f]{64}$/.test(s.sha256 || ''), m.id + '/' + s.label + ' sha256 not pinned');
            assert(s.js.startsWith('https://') && s.wasm.startsWith('https://'), 'non-https URL');
        }
    }
});
check('pinned sha256 is identical across all sources of a model', () => {
    for (const m of wasmModels) {
        const hashes = new Set(m.sources.map(s => s.sha256));
        assert(hashes.size === 1, m.id + ' has mixed hashes: ' + [...hashes].join(', '));
    }
});
check('asmjs sources are js-only (no wasm key)', () => {
    for (const m of asmModels) {
        for (const s of m.sources) assert(!s.wasm, m.id + '/' + s.label + ' unexpectedly has wasm');
    }
});
check('mirror sources use releases/latest/download', () => {
    const releases = 'https://github.com/aciokie/chess-ai-bot/releases/latest/download/';
    const cdnjsRepo = 'https://raw.githubusercontent.com/cdnjs/cdnjs/';
    for (const m of engines) {
        for (const s of m.sources) {
            if (s.label === 'mirror') {
                // Our own release mirror — must always be the releases URL.
                assert(s.js.startsWith(releases), m.id + ': bad mirror URL ' + s.js);
            } else if (s.label === 'github') {
                // Wasm models: releases mirror. asm.js models: cdnjs repo mirror.
                assert(s.js.startsWith(releases) || s.js.startsWith(cdnjsRepo),
                    m.id + ': bad github URL ' + s.js);
            }
        }
    }
});
check('no placeholder hashes or legacy fields remain', () => {
    assert(!src.includes('PENDING-SHA256'), 'placeholder sha256 left in userscript');
    assert(!/jsUrl:|wasmUrl:/.test(extractRegistryText()), 'legacy jsUrl/wasmUrl field left in registry');
    function extractRegistryText() {
        const start = src.indexOf('const LOCAL_ENGINES');
        const end = src.indexOf('const getEngineById', start);
        return src.slice(start, end);
    }
});
check('jsdelivr is only used for packages under its 150MB limit (sf16/sf11)', () => {
    for (const m of engines) {
        for (const s of m.sources) {
            if (s.label === 'jsdelivr') assert(['sf16_00', 'sf11_00'].includes(m.id),
                m.id + ' uses jsdelivr but that package exceeds the CDN size limit');
        }
    }
});
check('statically.io is gone (it serves truncated WASM files)', () => {
    assert(!src.includes('statically.io'), 'statically.io reference still present');
});

console.log('\n== Reliability features present ==');
for (const token of ['fetchJsFrom', 'fetchWasmFrom', 'downloadFromNextSource', 'headerValue',
    'sha256Hex', 'purgeModelCache', 'engineHealMap', 'WASM_TIMEOUT_MS', 'Auto-heal']) {
    check('contains ' + token, () => assert(src.includes(token), token + ' missing'));
}
check('source-chain counters declared before their first synchronous use', () => {
    // tryCompiledModule() runs synchronously down to downloadFromNextSource()
    // when IndexedDB is unavailable; sourceIdx must be initialized by then.
    const counter = src.indexOf('let sourceIdx');
    const call = src.indexOf('tryCompiledModule();');
    assert(counter !== -1 && call !== -1, 'markers not found');
    assert(counter < call, 'let sourceIdx is declared after tryCompiledModule() — TDZ crash without IndexedDB');
});

console.log('\n== Cloud-mode removal (dead code cleanup) ==');
for (const token of ['currentCloudRequest', 'analyzeCloud', 'handleCloudResponse', 'analyzeSF16',
    'handleSF16Response', 'triggerFallback', 'chess-api.com', 'stockfish.online',
    'embeddedWasm', 'EMBEDDED_SF19_SMALLNET_WASM_B64', 'CONFIG.API',
    'selMode', 'inpTime', 'inpSearch', 'engineMode === "cloud"', 'mode-cloud', 'show-cloud']) {
    check('no "' + token + '"', () => assert(!src.includes(token), 'leftover: ' + token));
}
check('engineMode is force-set to local on load', () => {
    assert(/settings\.engineMode = "local"/.test(src), 'engineMode force-local missing');
});
check('@connect only lists engine CDNs', () => {
    const connects = (src.match(/^\/\/ @connect\s+(.+)$/gm) || []).map(l => l.trim());
    for (const c of connects) {
        assert(!/chess-api|stockfish\.online/.test(c), 'stale @connect: ' + c);
    }
    assert(connects.some(c => c.includes('unpkg.com')), 'unpkg @connect missing');
    assert(connects.some(c => c.includes('github.com')), 'github @connect missing');
});

console.log('\n== Version + syntax ==');
check('version header is 11.7.4 or newer', () => {
    const m = src.match(/@version\s+(\d+)\.(\d+)\.(\d+)/);
    assert(m, 'no @version found');
    const v = [ +m[1], +m[2], +m[3] ];
    assert(v[0] > 11 || (v[0] === 11 && (v[1] > 7 || (v[1] === 7 && v[2] >= 4))),
        'version too old: ' + m[0]);
});
check('node --check passes', () => {
    execFileSync(process.execPath, ['--check', USERSCRIPT], { stdio: 'pipe' });
});

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
