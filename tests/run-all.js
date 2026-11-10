'use strict';
// Runs the full offline engine-reliability test suite (no network needed).
//
//   node tests/run-all.js
//
// The live CDN + hash verification is separate (it downloads ~120 MB):
//   node tests/verify-engine-sources.js

const path = require('path');
const { spawnSync } = require('child_process');

const FILES = [
    'engine-sources.test.js',
    'engine-loading.unit.test.js',
    'worker-bootstrap.test.js',
    'mirror-workflow.test.js',
    'extension.test.js',
    'lichess-uci-fen.test.js',
];

let failed = 0;
for (const f of FILES) {
    console.log('\n' + '─'.repeat(16) + ' ' + f + ' ' + '─'.repeat(16));
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
}

console.log('\n' + '='.repeat(60));
console.log(failed ? `${failed} test file(s) FAILED` : `All ${FILES.length} offline test files passed`);
console.log('Live CDN + hash verification (network, ~120 MB): node tests/verify-engine-sources.js');
process.exit(failed ? 1 : 0);
