#!/usr/bin/env node
/**
 * extension/e2e-test.mjs — real-browser end-to-end test for the extension.
 *
 * Launches a Chromium-family browser with the extension loaded (unpacked) and
 * verifies on live Chess.com:
 *   - the extension is registered and the content script injects the panel
 *   - the panel starts hidden; H toggles it; ✕ hides it; H restores it
 *   - the bundled engine loads LOCALLY (no CDN) and reaches "Ready"
 *   - switching models to the asm.js engine (sf9_00) works
 *   - a page reload uses the IndexedDB-cached instant-load path
 * Writes results + a screenshot to extension/e2e-artifacts/.
 *
 * Usage:
 *   node extension/e2e-test.mjs
 *   node extension/e2e-test.mjs --playwright=<path-to-playwright-core-or-playwright>
 *   node extension/e2e-test.mjs --browser=<chrome.exe path> --keep
 *
 * Requirements:
 *   - a Playwright install resolvable via --playwright, PLAYWRIGHT_CORE env,
 *     or a local `playwright-core`/`playwright` package
 *   - a Chromium-family browser: auto-discovers Playwright's own Chromium in
 *     %LOCALAPPDATA%\ms-playwright, then Brave, then Edge (override: --browser)
 *   - network access to chess.com (the page itself; engines are local)
 *
 * Exit code 0 = all checks passed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT = __dirname;
const ARTIFACTS = path.join(EXT, 'e2e-artifacts');
const require_ = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const arg = (name) => { const a = argv.find((x) => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
const keepOpen = argv.includes('--keep');

// ── Resolve playwright ────────────────────────────────────────────────────────
function loadPlaywright() {
    const tries = [arg('--playwright'), process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', '@playwright/test'].filter(Boolean);
    for (const t of tries) {
        try { return require_(t); } catch (e) { }
    }
    console.error('Could not load playwright. Install one (npm i -D playwright-core) or pass --playwright=<path>.');
    process.exit(2);
}
const { chromium } = loadPlaywright();

// ── Resolve a Chromium-family browser ────────────────────────────────────────
function findBrowser() {
    if (arg('--browser')) return arg('--browser');
    const local = process.env.LOCALAPPDATA || '';
    const ms = path.join(local, 'ms-playwright');
    if (fs.existsSync(ms)) {
        const builds = fs.readdirSync(ms).filter((d) => d.startsWith('chromium-')).sort().reverse();
        for (const b of builds) {
            const exe = path.join(ms, b, 'chrome-win64', 'chrome.exe');
            if (fs.existsSync(exe)) return exe;
        }
    }
    const fallbacks = [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    return fallbacks.find((p) => fs.existsSync(p)) || null;
}
const BROWSER = findBrowser();
if (!BROWSER) { console.error('No Chromium-family browser found (use --browser=<path>).'); process.exit(2); }

const PROFILE = path.join(ARTIFACTS, 'profile-' + Date.now());
const SHOT = path.join(ARTIFACTS, 'e2e-screenshot.png');
const RESULTS = path.join(ARTIFACTS, 'e2e-results.json');

const R = { startedAt: new Date().toISOString(), browser: BROWSER, steps: [], console: [], errors: [], engineWarnings: [] };
let failures = 0;
function check(name, ok, detail) {
    if (ok) console.log('  PASS  ' + name);
    else { failures++; console.error('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WALK_SHADOW = `(() => { const w = (root) => { let t = root.textContent || ''; if (root.querySelectorAll) root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) t += ' [' + w(el.shadowRoot) + '] '; }); return t; }; return w(document); })()`;

(async () => {
    fs.mkdirSync(ARTIFACTS, { recursive: true });

    const ctx = await chromium.launchPersistentContext(PROFILE, {
        headless: false, // extensions load in new headless; Playwright adds no GUI window anyway on CI
        executablePath: BROWSER,
        // Playwright passes --disable-extensions by default; on Chromium that
        // prevents --load-extension from working. Strip it (same as Playwright's
        // own extension tests do).
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
            '--headless=new',
            '--disable-extensions-except=' + EXT,
            '--load-extension=' + EXT,
            '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble',
        ],
        viewport: { width: 1280, height: 900 },
        timeout: 90000,
    });

    const p = ctx.pages()[0] || await ctx.newPage();
    p.on('console', (m) => {
        const t = m.text();
        if (t.includes('[SF Engine]')) R.console.push(t.slice(0, 220));
        if (m.type() === 'error') R.errors.push(t.slice(0, 200));
        if (m.type() === 'warning' && t.includes('[SF Engine]')) R.engineWarnings.push(t.slice(0, 200));
    });
    p.on('pageerror', (e) => R.errors.push('PAGEERROR ' + String(e).slice(0, 200)));

    const waitReady = async (budgetMs) => {
        const t0 = Date.now();
        let s = '';
        while (Date.now() - t0 < budgetMs) {
            s = await p.evaluate(() => (document.getElementById('localEngineStatus') || {}).textContent || '');
            if (s.includes('Ready') || s.includes('Error')) break;
            await p.waitForTimeout(1000);
        }
        return { text: s, ms: Date.now() - t0 };
    };

    // 0. extension registered?
    try {
        const scheme = BROWSER.toLowerCase().includes('brave') ? 'brave' : 'chrome';
        await p.goto(scheme + '://extensions/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await p.waitForTimeout(1500);
        R.extensionsPage = await p.evaluate(WALK_SHADOW);
    } catch (e) { R.steps.push('extensions page: ' + String(e).slice(0, 100)); }
    check('extension registered', (R.extensionsPage || '').includes('Chess AI Bot'), 'not listed on extensions page');

    // 1. panel injection + bundled engine load on live chess.com
    await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForSelector('#enginePanel', { state: 'attached', timeout: 45000 });
    // chess.com may show its own modal (cc-modal-component) covering the panel;
    // Esc usually dismisses it. Button clicks below use DOM clicks regardless.
    try { await p.keyboard.press('Escape'); await sleep(400); } catch (e) { }
    check('panel injected on chess.com', true);
    R.hiddenInitial = await p.evaluate(() => document.getElementById('enginePanel').classList.contains('bot-hidden'));
    check('panel starts hidden', R.hiddenInitial === true);
    R.engine1 = await waitReady(90000);
    check('engine ready (bundled, local)', R.engine1.text.includes('Ready'), R.engine1.text);
    const C1 = R.console.join('\n');
    check('no CDN download needed', !C1.includes('Download attempt 2'));
    check('local bundled source used', C1.includes('downloading from bundled'));

    // 2. H keybind + ✕ cycle (blur first: the script ignores keys in inputs)
    await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await p.keyboard.press('h'); await sleep(300);
    R.visibleAfterH1 = await p.evaluate(() => !document.getElementById('enginePanel').classList.contains('bot-hidden'));
    check('H shows the panel', R.visibleAfterH1 === true);
    await p.keyboard.press('h'); await sleep(300);
    R.hiddenAfterH2 = await p.evaluate(() => document.getElementById('enginePanel').classList.contains('bot-hidden'));
    check('H hides the panel', R.hiddenAfterH2 === true);
    await p.keyboard.press('h'); await sleep(300);
    R.visibleAfterH3 = await p.evaluate(() => !document.getElementById('enginePanel').classList.contains('bot-hidden'));
    check('H toggles back on', R.visibleAfterH3 === true);
    R.panelHiddenLS = await p.evaluate(() => localStorage.getItem('cabe_ext_bot_panelHidden'));
    check('panel state persisted (localStorage shim)', R.panelHiddenLS !== null, String(R.panelHiddenLS));
    try {
        // DOM click: chess.com's own modal overlay can intercept pointer events.
        await p.evaluate(() => document.getElementById('minBtn').click()); await sleep(300);
        R.hiddenAfterMinBtn = await p.evaluate(() => document.getElementById('enginePanel').classList.contains('bot-hidden'));
        check('✕ hides the panel', R.hiddenAfterMinBtn === true);
        await p.keyboard.press('h'); await sleep(300);
        R.visibleAfterMinThenH = await p.evaluate(() => !document.getElementById('enginePanel').classList.contains('bot-hidden'));
        check('H restores after ✕', R.visibleAfterMinThenH === true);
    } catch (e) { check('✕ hide button', false, String(e).slice(0, 120)); }

    R.checkboxes = await p.evaluate(() => ['chkMove', 'chkRun', 'chkQueue', 'chkPV', 'chkEvalBar', 'chkMoveHighlights', 'chkDebug']
        .map((id) => id + '=' + !!document.getElementById(id)));
    check('feature toggles present', R.checkboxes.every((c) => c.endsWith('true')), R.checkboxes.join(' '));
    try { await p.screenshot({ path: SHOT }); } catch (e) { }

    // 3. local modal + switch to the asm.js engine (sf9_00)
    try {
        await p.evaluate(() => document.getElementById('localBtn').click()); await sleep(400);
        R.modalOpen = await p.evaluate(() => { const m = document.getElementById('localModalOv'); return !!m && getComputedStyle(m).display !== 'none'; });
        check('local-engine modal opens', R.modalOpen === true);
        R.modelCount = await p.evaluate(() => document.querySelectorAll('#localModelSel option').length);
        check('all 7 models listed', R.modelCount === 7, 'got ' + R.modelCount);
        await p.selectOption('#localModelSel', 'sf9_00');
        R.engine2 = await waitReady(60000);
        check('asm.js model (sf9_00) ready', R.engine2.text.includes('Ready'), R.engine2.text);
        await p.evaluate(() => document.getElementById('localModalClose').click()); await sleep(200);
    } catch (e) { check('model switch', false, String(e).slice(0, 150)); }

    // 4. reload -> cached instant load
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForSelector('#enginePanel', { state: 'attached', timeout: 45000 });
    R.engine3 = await waitReady(60000);
    check('reload uses cache path', R.console.join('\n').includes('cached PATCHED worker') || R.console.join('\n').includes('cached'));
    check('engine ready after reload', R.engine3.text.includes('Ready'), R.engine3.text);

    check('no console errors', R.errors.length === 0, R.errors.slice(0, 3).join(' | '));
    check('no engine warnings', R.engineWarnings.length === 0, R.engineWarnings.slice(0, 3).join(' | '));

    if (!keepOpen) await ctx.close();
    R.failures = failures;
    fs.writeFileSync(RESULTS, JSON.stringify(R, null, 1));
    console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All browser checks passed'));
    console.log('results:    ' + RESULTS + '\nscreenshot: ' + SHOT);
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error('FATAL: ' + String(e).slice(0, 400));
    try { fs.mkdirSync(ARTIFACTS, { recursive: true }); fs.writeFileSync(RESULTS, JSON.stringify(Object.assign(R, { fatal: String(e) }), null, 1)); } catch (_) { }
    process.exit(1);
});
