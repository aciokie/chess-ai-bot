'use strict';
// Verification suite for the browser-extension build (extension/):
//   - manifest.json is a valid MV3 manifest wired for Chess.com
//   - extension/src/bot.js regenerates byte-identically from the userscript
//     (extension/build.mjs --check) — proves the copy is the userscript plus
//     ONLY the scripted, additive transforms
//   - feature parity: identical DOM ids, identical DEFAULT_SETTINGS, the H
//     keybind / panel-hide behavior, and every feature marker present
//   - every model keeps its bundled engine source AND its CDN fallbacks
//   - bundled engine files on disk match the pinned SHA-256 hashes
//
//   node tests/extension.test.js
// (engine-file checks are skipped with a notice if extension/engines is absent)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readUserscript, parseRegistry } = require('./lib/extract');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const BOT = path.join(EXT, 'src', 'bot.js');
const MANIFEST = path.join(EXT, 'manifest.json');
const BUILD = path.join(EXT, 'build.mjs');
const DL = path.join(EXT, 'download-engines.mjs');
const ENGINES = path.join(EXT, 'engines');

let failures = 0, skips = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { failures++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}
function skip(name, why) { skips++; console.log('  SKIP  ' + name + ' — ' + why); }
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const normalize = (s) => s.replace(/\r\n/g, '\n');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const us = normalize(readUserscript());
assert(fs.existsSync(BOT), 'extension/src/bot.js missing — run: node extension/build.mjs');
const bot = normalize(fs.readFileSync(BOT, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

console.log('\n== Manifest (MV3) ==');
check('is MV3 with name/version', () => {
    assert(manifest.manifest_version === 3, 'not MV3');
    assert(manifest.name && manifest.version, 'name/version missing');
});
check('version matches the userscript @version', () => {
    const m = us.match(/@version\s+(\S+)/);
    assert(m, 'userscript version not found');
    assert(m[1] === manifest.version, `manifest ${manifest.version} != userscript ${m[1]}`);
});
check('content scripts: dual-world setup with correct order', () => {
    const cs = manifest.content_scripts;
    assert(Array.isArray(cs) && cs.length === 2, 'expected two content script entries (isolated + MAIN)');
    const iso = cs.find((c) => !c.world || c.world === 'ISOLATED');
    const main = cs.find((c) => c.world === 'MAIN');
    assert(iso && main, 'missing isolated or MAIN entry');
    // The MAIN world is the only world where chess.com's board.game is visible.
    assert(JSON.stringify(iso.js) === JSON.stringify(['src/ext-urls.js']), 'isolated entry: ' + JSON.stringify(iso.js));
    assert(iso.run_at === 'document_start', 'isolated entry must run at document_start');
    assert(JSON.stringify(main.js) === JSON.stringify(['src/ext-urls.js', 'src/gm-polyfill.js', 'src/bot.js']),
        'MAIN entry order: ' + JSON.stringify(main.js));
    assert(main.run_at === 'document_idle', 'MAIN entry must run at document_idle');
});
check('content script matches == userscript @match list (both entries)', () => {
    const matches = [...us.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map((m) => m[1]).sort();
    for (const cs of manifest.content_scripts) {
        const manifestMatches = [...cs.matches].sort();
        assert(JSON.stringify(matches) === JSON.stringify(manifestMatches),
            `entry ${cs.world || 'ISOLATED'}: ${manifestMatches}`);
    }
});
check('extURL resolves via the shared DOM attribute (MAIN-world safe)', () => {
    assert(bot.includes('data-sf-ext-base'), 'extURL does not read the DOM bridge attribute');
    const urls = fs.readFileSync(path.join(EXT, 'src', 'ext-urls.js'), 'utf8');
    assert(urls.includes('setAttribute(\'data-sf-ext-base\''), 'ext-urls.js does not publish the base attribute');
});
check('CSP allows wasm compilation + extension-file workers', () => {
    const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
    assert(csp, 'extension_pages CSP missing');
    assert(csp.includes("'wasm-unsafe-eval'"), "missing 'wasm-unsafe-eval'");
    assert(csp.includes("worker-src 'self'"), "missing worker-src 'self'");
    // Regression: 'blob:' in worker-src makes Chrome REFUSE to load the whole
    // extension (verified by bisect — the extension silently never loads).
    // Content-script blob workers do not need it and keep working without it.
    assert(!csp.includes('blob:'), "do NOT add 'blob:' to worker-src — it breaks extension loading");
});
check('engine files are web-accessible on Chess.com', () => {
    const war = manifest.web_accessible_resources || [];
    const entry = war.find((w) => (w.matches || []).some((mm) => mm.includes('chess.com')));
    assert(entry, 'no chess.com WAR entry');
    assert(entry.resources.some((r) => r.startsWith('engines/')), 'engines/ not web-accessible');
});

console.log('\n== Regeneration parity (copy == userscript + transforms) ==');
check('extension/src/bot.js is byte-identical to a fresh build', () => {
    const r = spawnSync(process.execPath, [BUILD, '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert(r.status === 0, (r.stderr || r.stdout || '').slice(0, 300));
});
check('transforms are additive-only (no feature code replaced)', () => {
    // The generated file must contain every non-derived line of the userscript.
    // Strip down to code lines (ignore blank lines) and require that each line
    // of the userscript appears in the copy, except the explicitly rewritten
    // anchor lines below (sources-array headers are rewritten in place).
    const REWRITTEN = [
        /^\/\/ ==\/UserScript==$/,
        /^\(function \(\) \{$/,
        /^\s*"use strict";$/,
    ];
    const copyLines = new Set(bot.split('\n'));
    const missing = us.split('\n').filter((l) =>
        l.trim() !== '' && !REWRITTEN.some((re) => re.test(l)) && !copyLines.has(l));
    assert(missing.length === 0,
        'userscript lines missing from the copy:\n' + missing.slice(0, 6).join('\n'));
});

console.log('\n== Feature parity ==');
function idSets(text) {
    return {
        html: new Set([...text.matchAll(/id="([^"]+)"/g)].map((m) => m[1])),
        dom: new Set([...text.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1])),
    };
}
check('identical UI element ids (nothing added, nothing dropped)', () => {
    const a = idSets(us), b = idSets(bot);
    for (const kind of ['html', 'dom']) {
        const onlyRoot = [...a[kind]].filter((x) => !b[kind].has(x));
        const onlyBot = [...b[kind]].filter((x) => !a[kind].has(x));
        assert(onlyRoot.length === 0 && onlyBot.length === 0,
            `${kind} ids differ. only-userscript: ${onlyRoot} only-extension: ${onlyBot}`);
    }
});
check('DEFAULT_SETTINGS are identical', () => {
    const grab = (t) => {
        const m = t.match(/const DEFAULT_SETTINGS = \{[\s\S]*?\n    \};/);
        assert(m, 'DEFAULT_SETTINGS not found');
        return m[0];
    };
    assert(grab(us) === grab(bot), 'settings blocks differ');
});
check('H keybind + panel hide behavior preserved', () => {
    assert(bot.includes('e.key === "h" || e.key === "H"'), 'H keybind missing');
    assert(bot.includes('classList.toggle("bot-hidden")'), 'panel toggle missing');
    assert(bot.includes('saveSetting("panelHidden", hidden)'), 'panelHidden persistence missing');
    assert(bot.includes('state.ui.minBtn.onclick'), '✕ hide button missing');
    assert(bot.includes('e.altKey'), 'Alt+B keybind missing');
});
check('duplicate-instance guard present (cross-world DOM marker)', () => {
    assert(bot.includes('data-sf-bot-active'), 'singleton guard marker missing');
    assert(bot.includes('skipping duplicate injection'), 'guard message missing');
});
check('all major feature markers present', () => {
    const markers = [
        'toggleBullet', 'shouldPauseAnalysis', 'scheduleAutoMove', 'processBestMove',
        'resetTransientStateForNewGame', 'startGameOverPoll', 'setupBoardObserver',
        'OpeningBook.enabled', 'ThreatDetector.enabled', 'humanizer', 'autoRematch',
        'premovePending', 'EvalBar.update', 'TRACK_URL', 'GM_info',
        'engineHealMap', 'purgeModelCache', 'sha256Hex', 'downloadFromNextSource',
        'localModelSel', 'inpDepth', 'chkMove', 'chkRun', 'chkQueue',
    ];
    const missing = markers.filter((m) => !bot.includes(m));
    assert(missing.length === 0, 'missing markers: ' + missing.join(', '));
});

console.log('\n== Bundled sources + fallbacks ==');
const bundledMap = (() => {
    const src = fs.readFileSync(BUILD, 'utf8');
    const out = {};
    for (const m of src.matchAll(/(sf\d+_\w+):\s*\{\s*js:\s*'([^']+)'(?:,\s*wasm:\s*(?:'([^']+)'|null))?\s*\}/g)) {
        out[m[1]] = { js: m[2], wasm: m[3] || null };
    }
    assert(Object.keys(out).length === 7, 'expected 7 bundled models, got ' + Object.keys(out).length);
    return out;
})();
const rootRegistry = parseRegistry(us);
const botRegistry = parseRegistry(bot, {});
check('every model: bundled source first, CDN fallbacks kept', () => {
    for (const model of botRegistry) {
        const b = bundledMap[model.id];
        assert(b, `no bundled mapping for ${model.id}`);
        const first = model.sources[0];
        assert(first.bundled === true && first.label === 'bundled', `${model.id}: first source is not bundled`);
        assert(first.js === 'EXT:' + b.js, `${model.id}: bundled js path mismatch (${first.js})`);
        if (b.wasm) assert(first.wasm === 'EXT:' + b.wasm, `${model.id}: bundled wasm path mismatch`);
        const fallbacks = model.sources.filter((s) => !s.bundled);
        const rootModel = rootRegistry.find((r) => r.id === model.id);
        assert(fallbacks.length === rootModel.sources.length,
            `${model.id}: fallback sources changed (${fallbacks.length} vs ${rootModel.sources.length})`);
        // caps + defaults untouched
        const capsOf = (x) => JSON.stringify(Object.keys(x).filter((k) => k !== 'sources').sort().map((k) => [k, x[k]]));
        assert(capsOf(model) === capsOf(rootModel), `${model.id}: caps/defaults changed`);
    }
});
check('bundled fast paths inserted for wasm and asm.js', () => {
    assert(bot.includes('Extension build: bundled engine fast path'), 'wasm fast path missing');
    assert(bot.includes('Extension build: bundled asm.js fast path'), 'asm.js fast path missing');
    assert(bot.includes('state.localEngine = new Worker(sources[0].js);') &&
           bot.includes('state.localEngine = new Worker(asmSources[0].js);'),
        'direct bundled worker creation missing');
    assert(bot.includes('Direct bundled worker blocked') && bot.includes('Direct bundled asm.js worker blocked'),
        'pipeline fallback on blocked direct worker missing');
});
check('extURL helper present; fast-path failure keeps the bundled source for local fetch', () => {
    assert((bot.match(/const extURL =/g) || []).length === 1, 'extURL helper missing/duplicated');
    assert(!bot.includes('sources.shift()') && !bot.includes('asmSources.shift()'),
        'bundled fast-path must NOT drop the bundled source (the fetch pipeline reads it locally)');
});

console.log('\n== Bundled engine files ==');
if (!fs.existsSync(ENGINES)) {
    skip('engine file hashes', 'extension/engines not present — run: node extension/download-engines.mjs');
} else {
    const dlSrc = fs.readFileSync(DL, 'utf8');
    const pins = [...dlSrc.matchAll(/\['(engines\/[^']+)',\s*'[^']+',\s*'[^']*',\s*'([0-9a-f]{64})'\]/g)]
        .map((m) => ({ file: m[1], hash: m[2] }));
    check('download-engines table covers all bundled files', () => {
        assert(pins.length === 12, 'expected 12 pinned files, got ' + pins.length);
        for (const b of Object.values(bundledMap)) {
            assert(pins.some((p) => p.file === b.js), 'no pin for ' + b.js);
            if (b.wasm) assert(pins.some((p) => p.file === b.wasm), 'no pin for ' + b.wasm);
        }
    });
    for (const p of pins) {
        check('hash ok: ' + p.file, () => {
            const abs = path.join(EXT, p.file);
            assert(fs.existsSync(abs), 'missing file');
            const actual = sha256(fs.readFileSync(abs));
            assert(actual === p.hash, `sha256 ${actual.slice(0, 12)}… != pinned ${p.hash.slice(0, 12)}…`);
        });
    }
    check('wasm pins match the userscript registry pins', () => {
        for (const b of Object.values(bundledMap)) {
            if (!b.wasm) continue;
            const pin = pins.find((p) => p.file === b.wasm);
            const model = rootRegistry.find((m) => (m.sources || []).some((s) => s.wasm && s.wasm.endsWith(path.basename(b.wasm))));
            assert(model, 'no registry model for ' + b.wasm);
            assert(model.sources[0].sha256 === pin.hash,
                `${b.wasm}: registry ${model.sources[0].sha256.slice(0, 12)}… != downloader ${pin.hash.slice(0, 12)}…`);
        }
    });
}

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All extension checks passed') +
    (skips ? ` (${skips} skipped)` : '') + '\n');
process.exit(failures ? 1 : 0);
