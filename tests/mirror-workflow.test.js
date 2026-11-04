'use strict';
// Cross-checks .github/workflows/release-engine-mirror.yml against the engine
// registry in chess-ai-bot.user.js:
//   - every `releases/latest/download/<asset>` URL the userscript uses is
//     produced by the workflow
//   - the workflow's SHA-256 verify list matches the userscript's pins
//   - the bash in every `run:` step is syntactically valid (Git bash, if found)
//
//   node tests/mirror-workflow.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseRegistry, readUserscript } = require('./lib/extract');

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { failures++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const WF_PATH = path.join(__dirname, '..', '.github', 'workflows', 'release-engine-mirror.yml');
const wf = fs.readFileSync(WF_PATH, 'utf8');
const engines = parseRegistry(readUserscript());
const RELEASES = 'https://github.com/aciokie/chess-ai-bot/releases/latest/download/';

// `get <name> "<url>"` download lines
const downloads = [...wf.matchAll(/get\s+(\S+)\s+"([^"]+)"/g)].map((m) => ({ name: m[1], url: m[2] }));
// `check <hash> <name>` verification lines
const verifications = [...wf.matchAll(/check\s+([0-9a-f]{64})\s+(\S+)/g)].map((m) => ({ hash: m[1], name: m[2] }));

console.log('\n== Workflow structure ==');
check('triggers on v* tags and workflow_dispatch', () => {
    assert(/on:\s*\n\s*push:\s*\n\s*tags:\s*\['v\*'\]/.test(wf), 'tag trigger missing');
    assert(/workflow_dispatch:/.test(wf), 'workflow_dispatch missing');
});
check('has release permissions + release step', () => {
    assert(/permissions:\s*\n\s*contents:\s*write/.test(wf), 'contents: write missing');
    assert(/softprops\/action-gh-release/.test(wf), 'release action missing');
    assert(/if:\s*startsWith\(github\.ref, 'refs\/tags\/'\)/.test(wf), 'release step must be tag-gated');
});
check('downloads every registry mirror asset (' + downloads.length + ' files)', () => {
    assert(downloads.length === 12, 'expected 12 download entries, got ' + downloads.length);
});
check('every downloaded file is hash-verified', () => {
    const verified = new Set(verifications.map((v) => v.name));
    for (const d of downloads) assert(verified.has(d.name), 'not verified: ' + d.name);
});

console.log('\n== Registry <-> workflow consistency ==');
for (const m of engines) {
    for (const s of m.sources) {
        for (const kind of ['js', 'wasm']) {
            const url = s[kind];
            if (!url || !url.startsWith(RELEASES)) continue;
            const asset = url.slice(RELEASES.length);
            check(`${m.id}/${s.label} ${kind} asset "${asset}" is produced by the mirror`, () => {
                assert(downloads.some((d) => d.name === asset), 'workflow does not download ' + asset);
            });
            if (kind === 'wasm' && s.sha256) {
                check(`${m.id}/${s.label} wasm pin matches workflow hash`, () => {
                    const v = verifications.find((x) => x.name === asset);
                    assert(v, 'no workflow hash for ' + asset);
                    assert(v.hash === s.sha256, `workflow ${v.hash.slice(0, 12)}… ≠ registry ${s.sha256.slice(0, 12)}…`);
                });
            }
        }
    }
}

console.log('\n== Bash syntax (run: blocks) ==');
function extractRunBlocks(yaml) {
    const lines = yaml.split(/\r?\n/);
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*run: \|\s*$/.test(lines[i])) {
            const indent = lines[i].match(/^(\s*)/)[1].length;
            const body = [];
            for (let j = i + 1; j < lines.length; j++) {
                const line = lines[j];
                if (line.trim() === '') { body.push(''); continue; }
                if (line.match(/^(\s*)/)[1].length <= indent) break;
                body.push(line);
            }
            while (body.length && body[body.length - 1] === '') body.pop();
            blocks.push(body.join('\n'));
        }
    }
    return blocks;
}
const bashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
const bash = bashCandidates.find((p) => fs.existsSync(p)) || (process.platform === 'linux' ? 'bash' : null);
const blocks = extractRunBlocks(wf);
check('run blocks extracted', () => assert(blocks.length >= 2, 'expected >= 2 run blocks, got ' + blocks.length));
if (bash) {
    blocks.forEach((block, idx) => {
        check(`run block #${idx + 1} passes bash -n`, () => {
            const tmp = path.join(os.tmpdir(), `mirror-block-${idx}.sh`);
            fs.writeFileSync(tmp, block);
            const r = spawnSync(bash, ['-n', tmp]);
            fs.unlinkSync(tmp);
            assert(r.status === 0, (r.stderr || '').toString().slice(0, 200));
        });
    });
} else {
    console.log('  SKIP  bash not found — cannot syntax-check run blocks on this machine');
}

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
