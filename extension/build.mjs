#!/usr/bin/env node
/**
 * extension/build.mjs
 *
 * Generates extension/src/bot.js from the root userscript (chess-ai-bot.user.js).
 * The extension keeps 100% of the userscript's features — this script only:
 *   1. adds an "extension build" header + extURL() helper,
 *   2. prepends a `bundled` source (extension-local engine files) to every
 *      model in LOCAL_ENGINES (all CDN sources remain as fallbacks),
 *   3. inserts the bundled-engine fast paths into loadLocalEngine (direct
 *      `new Worker(extURL(...))` — no download, no blob bootstrap).
 *
 * Usage:
 *   node extension/build.mjs           # regenerate extension/src/bot.js
 *   node extension/build.mjs --check   # exit 1 if the on-disk copy differs
 *
 * NEVER edit extension/src/bot.js directly: edit chess-ai-bot.user.js and
 * re-run this script (tests/extension.test.js enforces regeneration parity).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'chess-ai-bot.user.js');
const TARGET = path.join(__dirname, 'src', 'bot.js');

// Model id -> bundled engine files (layout under extension/engines/).
// Filenames inside a folder are kept as published by the engine package so
// every build derives its sibling .wasm correctly from its own URL.
export const BUNDLED = {
    sf19_small: { js: 'engines/sf19_small/stockfish-19-lite-single.js', wasm: 'engines/sf19_small/stockfish-19-lite-single.wasm' },
    sf19_00:    { js: 'engines/sf19_00/stockfish-19-single.js',        wasm: 'engines/sf19_00/stockfish-19-single.wasm' },
    sf18_05:    { js: 'engines/sf18_05/stockfish-18-lite-single.js',   wasm: 'engines/sf18_05/stockfish-18-lite-single.wasm' },
    sf16_00:    { js: 'engines/sf16_00/stockfish-nnue-16-single.js',   wasm: 'engines/sf16_00/stockfish-nnue-16-single.wasm' },
    sf11_00:    { js: 'engines/sf11_00/stockfish.js',                  wasm: 'engines/sf11_00/stockfish.wasm' },
    sf10_02:    { js: 'engines/sf10_02/stockfish.js',                  wasm: null },
    sf9_00:     { js: 'engines/sf9_00/stockfish.js',                   wasm: null },
};

function replaceOnce(text, anchor, replacement, label) {
    const count = text.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${label}: expected exactly 1 anchor, found ${count}: ${JSON.stringify(anchor.slice(0, 80))}`);
    return text.replace(anchor, replacement);
}

export function buildBotScript(sourceText) {
    if (sourceText.includes('[EXTENSION BUILD]')) throw new Error('source already looks like an extension build — regenerate from the userscript');

    let text = sourceText;

    // 1. Header note right after the userscript metadata block.
    text = replaceOnce(text,
        '// ==/UserScript==\n',
        '// ==/UserScript==\n//\n// [EXTENSION BUILD] Generated from chess-ai-bot.user.js by extension/build.mjs.\n// Do not edit this copy directly — edit the userscript and re-run:\n//   node extension/build.mjs\n',
        'header note');

    // 2. extURL() helper right after the IIFE opens.
    text = replaceOnce(text,
        '(function () {\n    "use strict";\n',
        '(function () {\n    "use strict";\n\n    // ── Extension build ──────────────────────────────────────────────────────\n    // Engine files ship inside the extension (engines/<model>/...); extURL()\n    // resolves them at runtime. Everything else is the unmodified userscript.\n    const extURL = (p) => (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL(p) : p;\n',
        'extURL helper');

    // 3. Prepend the `bundled` source to every model's source chain.
    for (const [id, files] of Object.entries(BUNDLED)) {
        const idIdx = text.indexOf(`id:      "${id}",`);
        if (idIdx === -1) throw new Error(`model ${id} not found`);
        const srcIdx = text.indexOf('sources: [', idIdx);
        if (srcIdx === -1) throw new Error(`sources array for ${id} not found`);
        const insertAt = srcIdx + 'sources: ['.length;
        const entry = files.wasm
            ? `\n                { label: "bundled", bundled: true, js: extURL("${files.js}"), wasm: extURL("${files.wasm}") },`
            : `\n                { label: "bundled", bundled: true, js: extURL("${files.js}") },`;
        text = text.slice(0, insertAt) + entry + text.slice(insertAt);
    }

    // 4. Bundled fast path — wasm models: create the worker straight from the
    //    packaged engine file; it loads its .wasm sibling itself. Skip all
    //    caching/download code. CDN sources remain if construction fails.
    text = replaceOnce(text,
        ': [{ label: m.cdn || "cdn", js: m.jsUrl, wasm: m.wasmUrl, sha256: null }]; // legacy shape\n',
        ': [{ label: m.cdn || "cdn", js: m.jsUrl, wasm: m.wasmUrl, sha256: null }]; // legacy shape\n' +
        '\n' +
        '                // ── Extension build: bundled engine fast path ──\n' +
        '                // Engine files ship inside the extension, so the worker is\n' +
        '                // created directly from the packaged file: no download, no\n' +
        '                // blob bootstrap, no fetch mock. The engine JS runs as a\n' +
        '                // worker and loads its own .wasm sibling (proven layout).\n' +
        '                if (sources[0] && sources[0].bundled) {\n' +
        '                    console.log(`[SF Engine] Extension build: loading bundled engine directly (no download)...`);\n' +
        '                    setEngineStatus("loading", "Loading bundled engine...");\n' +
        '                    try {\n' +
        '                        state.localEngine = new Worker(sources[0].js);\n' +
        '                        state.localEngine.onerror = onEngineWorkerError;\n' +
        '                        state.localEngine.onmessage = handleLocalMessage;\n' +
        '                        console.log(`[SF Engine] Bundled engine worker created, finalizing...`);\n' +
        '                        finalizeEngine(modelId);\n' +
        '                        return;\n' +
        '                    } catch (e) {\n' +
        '                        console.warn(`[SF Engine] Direct bundled worker blocked (${e.message || e}); using the local fetch pipeline...`);\n' +
        '                    }\n' +
        '                }\n',
        'wasm bundled fast path');

    // 5. Bundled fast path — asm.js models (single JS file, no WASM at all).
    text = replaceOnce(text,
        ': [{ label: m.cdn || "cdn", js: m.jsUrl }]; // legacy shape\n',
        ': [{ label: m.cdn || "cdn", js: m.jsUrl }]; // legacy shape\n' +
        '\n' +
        '                // ── Extension build: bundled asm.js fast path ──\n' +
        '                if (asmSources[0] && asmSources[0].bundled) {\n' +
        '                    console.log(`[SF Engine] Extension build: loading bundled asm.js engine directly (no download)...`);\n' +
        '                    setEngineStatus("loading", "Loading bundled engine...");\n' +
        '                    try {\n' +
        '                        state.localEngine = new Worker(asmSources[0].js);\n' +
        '                        state.localEngine.onerror = onEngineWorkerError;\n' +
        '                        state.localEngine.onmessage = handleLocalMessage;\n' +
        '                        console.log(`[SF Engine] Bundled asm.js worker created, finalizing...`);\n' +
        '                        finalizeEngine(modelId);\n' +
        '                        return;\n' +
        '                    } catch (e) {\n' +
        '                        console.warn(`[SF Engine] Direct bundled asm.js worker blocked (${e.message || e}); using the local fetch pipeline...`);\n' +
        '                    }\n' +
        '                }\n',
        'asmjs bundled fast path');

    return text;
}

const isCheck = process.argv.includes('--check');
// The userscript uses CRLF on Windows checkouts; normalize so the transforms
// (and the generated file) are line-ending independent.
const sourceText = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
const built = buildBotScript(sourceText);

if (isCheck) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (current === built) {
        console.log('extension/src/bot.js is up to date with chess-ai-bot.user.js');
        process.exit(0);
    }
    console.error('extension/src/bot.js DIFFERS from a fresh build — run: node extension/build.mjs');
    process.exit(1);
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, built);
console.log(`built ${path.relative(ROOT, TARGET)} from ${path.relative(ROOT, SOURCE)} (${built.length} chars)`);
console.log('bundled sources added for: ' + Object.keys(BUNDLED).join(', '));
