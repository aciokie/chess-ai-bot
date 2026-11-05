#!/usr/bin/env node
/**
 * extension/download-engines.mjs
 *
 * Downloads the engine files that ship inside the extension into
 * extension/engines/<model>/<file>. Primary source: this repo's GitHub release
 * mirror (hash-verified, always available); fallback: the original CDN.
 *
 * Every file is SHA-256 verified against the same pins used by the userscript
 * and the release mirror. Already-verified files are skipped, so re-running is
 * cheap.
 *
 * Usage:
 *   node extension/download-engines.mjs           # fetch/verify everything
 *   node extension/download-engines.mjs --force   # re-download even if verified
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASE = 'https://github.com/aciokie/chess-ai-bot/releases/latest/download/';
const force = process.argv.includes('--force');

// dest path (relative to extension/), release asset name, CDN fallback URL, sha256
const FILES = [
    // Stockfish 19.0.0 Small/Lite — userscript model sf19_small
    ['engines/sf19_small/stockfish-19-lite-single.js',   'stockfish-19-lite-single.js',   'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-lite-single.js',   'd3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6'],
    ['engines/sf19_small/stockfish-19-lite-single.wasm', 'stockfish-19-lite-single.wasm', 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-lite-single.wasm', '57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387'],
    // Stockfish 19.0.0 Full — sf19_00
    ['engines/sf19_00/stockfish-19-single.js',           'stockfish-19-single.js',        'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.js',        '72772f8bdd7353e4e24245d946bb831f56bcccf02fa16a779c1b92a6c00e5cc2'],
    ['engines/sf19_00/stockfish-19-single.wasm',         'stockfish-19-single.wasm',      'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.wasm',      '8725c26572762617fd96b2ea83ff130e6640b85815890d682bf8c49db0820721'],
    // Stockfish 18.0.5 Lite — sf18_05
    ['engines/sf18_05/stockfish-18-lite-single.js',      'stockfish-18-lite-single.js',   'https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.js',   '2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe'],
    ['engines/sf18_05/stockfish-18-lite-single.wasm',    'stockfish-18-lite-single.wasm', 'https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-lite-single.wasm', 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1'],
    // Stockfish 16 — sf16_00
    ['engines/sf16_00/stockfish-nnue-16-single.js',      'stockfish-nnue-16-single.js',   'https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.js',   'e2958bb89fc6ee0faedde87284bbb7e14da2ab224f06ca1bd82e62eaca87d00b'],
    ['engines/sf16_00/stockfish-nnue-16-single.wasm',    'stockfish-nnue-16-single.wasm', 'https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm', 'a7acf7f20cb81d755b39b3dd42a4bdfd6e8c8d3d203d9fbdc525e40e1f68df08'],
    // Stockfish 11 — sf11_00 (renamed to stockfish.js/.wasm so the build finds its sibling)
    ['engines/sf11_00/stockfish.js',                     'stockfish-11.js',               'https://unpkg.com/stockfish@11.0.0/src/stockfish.js',                  'b203c697e523cc7b336c7ae3fe5057849a63c2c96f385a889512e21bc85d2003'],
    ['engines/sf11_00/stockfish.wasm',                   'stockfish-11.wasm',             'https://unpkg.com/stockfish@11.0.0/src/stockfish.wasm',                'e5f1deb483cc28bcf4dff5d3cb9abb9aee697c1fe174c60d1c5cc476da76cae8'],
    // Stockfish 10.0.2 asm.js — sf10_02
    ['engines/sf10_02/stockfish.js',                     'stockfish-10.0.2.js',           'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js', '723fda70117bfa8d5053a7bc4ae50cdc96dc9e3fd41b57627e4dfa0a0025957a'],
    // Stockfish 9.0.0 asm.js — sf9_00
    ['engines/sf9_00/stockfish.js',                      'stockfish-9.0.0.js',            'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/9.0.0/stockfish.js', '39d33ac9daf84fc8a0c6952bd0ee7a94af79ab9db7dcebad1058cf994914d590'],
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchBuffer(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

let downloaded = 0, skipped = 0, failed = 0;

for (const [destRel, asset, cdnUrl, pin] of FILES) {
    const dest = path.join(__dirname, destRel);
    if (!force && fs.existsSync(dest)) {
        const existing = sha256(fs.readFileSync(dest));
        if (existing === pin) { skipped++; console.log(`ok        ${destRel}`); continue; }
        console.log(`re-fetch  ${destRel} (hash mismatch)`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let buf = null, lastErr = null;
    for (const url of [RELEASE + asset, cdnUrl]) {
        try { buf = await fetchBuffer(url); break; }
        catch (e) { lastErr = e; console.log(`  failed ${url}: ${e.message}`); }
    }
    if (!buf) { failed++; console.error(`FAILED    ${destRel}: ${lastErr && lastErr.message}`); continue; }
    const actual = sha256(buf);
    if (actual !== pin) { failed++; console.error(`FAILED    ${destRel}: sha256 ${actual} != pinned ${pin}`); continue; }
    fs.writeFileSync(dest, buf);
    downloaded++;
    console.log(`saved     ${destRel} (${(buf.length / 1048576).toFixed(2)} MB)`);
}

console.log(`\n${downloaded} downloaded, ${skipped} already verified, ${failed} failed`);
console.log(`engine directory: ${path.join(__dirname, 'engines')} (${(FILES.reduce((s, [d]) => s + (fs.existsSync(path.join(__dirname, d)) ? fs.statSync(path.join(__dirname, d)).size : 0), 0) / 1048576).toFixed(1)} MB)`);
process.exit(failed ? 1 : 0);
