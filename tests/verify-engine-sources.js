'use strict';
// Live verification of every engine download source + pinned SHA-256 against
// the actual CDNs. This is the ground-truth check that the registry matches
// reality — it downloads all 12 files (~120 MB, dominated by the full SF19
// WASM), so allow a few minutes on slower connections.
//
//   node tests/verify-engine-sources.js                  # everything
//   node tests/verify-engine-sources.js --quick          # loaders only (small, fast)
//   node tests/verify-engine-sources.js --model=sf19_small
//
// Statuses:
//   OK           reachable and (for WASM) SHA-256 matches the pin
//   SKIP         GitHub release assets before the first v* tag exists
//   FAIL         anything else, including hash mismatches (exit code 1)

const crypto = require('crypto');
const { parseRegistry, readUserscript } = require('./lib/extract');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const modelArg = ((args.find((a) => a.startsWith('--model=')) || '').split('=')[1] || '');

if (typeof fetch !== 'function') {
    console.error('This test needs Node 18+ (global fetch).');
    process.exit(1);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const RELEASES = 'https://github.com/aciokie/chess-ai-bot/releases/latest/download/';

const engines = parseRegistry(readUserscript()).filter((m) => !modelArg || m.id === modelArg);
if (!engines.length) { console.error('No models match --model=' + modelArg); process.exit(1); }

async function fetchBuffer(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return { status: res.status, buffer: null };
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

let pass = 0, skip = 0, fail = 0;
const rows = [];

(async () => {
    console.log(`Verifying ${engines.length} model(s)${quick ? ' [--quick: loaders only]' : ''}...\n`);

    for (const m of engines) {
        for (const s of m.sources) {
            const row = { model: m.id, source: s.label, js: '', wasm: '' };

            try {
                const r = await fetchBuffer(s.js);
                if (!r.buffer) {
                    if (r.status === 404 && s.js.startsWith(RELEASES)) { row.js = 'SKIP (no release yet)'; skip++; }
                    else { row.js = 'FAIL HTTP ' + r.status; fail++; }
                } else {
                    row.js = `OK (${(r.buffer.length / 1024).toFixed(0)} KB)`;
                    pass++;
                }
            } catch (e) { row.js = 'FAIL ' + String(e.message || e).slice(0, 60); fail++; }

            if (!s.wasm) {
                row.wasm = '— (asm.js)';
            } else if (quick) {
                row.wasm = 'skipped (--quick)';
            } else {
                try {
                    const label = s.wasm.split('/').pop();
                    process.stdout.write(`  ↓ ${m.id} / ${s.label}: ${label} ... `);
                    const started = Date.now();
                    const r = await fetchBuffer(s.wasm);
                    if (!r.buffer) {
                        if (r.status === 404 && s.wasm.startsWith(RELEASES)) { row.wasm = 'SKIP (no release yet)'; skip++; }
                        else { row.wasm = 'FAIL HTTP ' + r.status; fail++; }
                        process.stdout.write(row.wasm + '\n');
                    } else {
                        const actual = sha256(r.buffer);
                        const ok = !s.sha256 || actual === s.sha256;
                        const secs = ((Date.now() - started) / 1000).toFixed(1);
                        row.wasm = ok
                            ? `OK hash ✓ (${(r.buffer.length / 1048576).toFixed(1)} MB, ${secs}s)`
                            : `FAIL hash ${actual.slice(0, 12)}… ≠ pinned ${String(s.sha256).slice(0, 12)}…`;
                        if (ok) pass++; else fail++;
                        process.stdout.write(row.wasm + '\n');
                    }
                } catch (e) { row.wasm = 'FAIL ' + String(e.message || e).slice(0, 60); fail++; process.stdout.write(row.wasm + '\n'); }
            }

            rows.push(row);
        }
    }

    console.log('\nModel            Source     JS                     WASM');
    console.log('---------------- ---------- ---------------------- ------------------------------------------');
    for (const r of rows) {
        console.log(
            r.model.padEnd(16) + ' ' + r.source.padEnd(10) + ' ' +
            r.js.padEnd(22) + ' ' + r.wasm);
    }
    console.log(`\n${pass} passed, ${skip} skipped, ${fail} failed` + (skip ? ' (SKIP = publish a v* tag to create the release mirror)' : ''));
    process.exit(fail ? 1 : 0);
})();
