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
 *   - REAL vs-computer games play, survive navigation + resume, and with
 *     Auto-Rematch enabled the bot itself starts the next game after a resign
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

    // 5. real game: the extension must analyze and auto-play vs the computer.
    //    (MAIN-world build — the isolated-world build could not see board.game
    //    and silently did nothing in live games.)
    try {
        await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(4000);
        await p.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) => /^play$/i.test((x.textContent || '').trim()) && x.offsetParent);
            if (b) b.click();
        });
        await sleep(4000);
        const fens = [];
        const g0 = Date.now();
        while (Date.now() - g0 < 75000 && fens.length < 5) {
            const fen = await p.evaluate(() => {
                const el = document.querySelector('chess-board, wc-chess-board');
                return el && el.game && el.game.getFEN ? el.game.getFEN() : null;
            });
            if (fen && fens[fens.length - 1] !== fen) fens.push(fen);
            await p.waitForTimeout(1200);
        }
        R.game = { distinctPositions: fens.length, fens: fens.slice(0, 5).map((f) => f.slice(0, 32)) };
        const C2 = R.console.join('\n');
        check('game: extension analyzed positions', C2.includes('analyzeLocal called'));
        check('game: engine produced bestmoves', C2.includes('bestmove'));
        check('game: auto-move played (>= 3 positions reached)', fens.length >= 3, 'saw ' + fens.length);
        try { await p.screenshot({ path: path.join(ARTIFACTS, 'e2e-game-screenshot.png') }); } catch (e) { }
    } catch (e) { check('real game ran', false, String(e).slice(0, 150)); }

    // 6. stability: full navigation away & back — a fresh instance must
    //    re-engage (engine from cache, then a second game must play).
    try {
        await p.goto('https://www.chess.com/analysis', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForSelector('#enginePanel', { state: 'attached', timeout: 45000 });
        const r2 = await waitReady(45000);
        check('stability: engine ready after full navigation', r2.text.includes('Ready'), r2.text);
        await p.goto('https://www.chess.com/play/computer', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(4000);
        // Returning mid-game: chess.com shows the paused game with
        // Continue / New Game controls (getPlayingAs() reports undefined while
        // paused, so the bot correctly idles until the game resumes). Pressing
        // "Continue" must resume analysis + auto-moves — that IS this phase.
        R.resumeClick = await p.evaluate(() => {
            const t = (b) => (b.textContent || '').trim();
            const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent);
            const cont = btns.find((b) => /^continue$/i.test(t(b)));
            if (cont) { cont.click(); return 'Continue'; }
            const ng = btns.find((b) => /^new game$/i.test(t(b)));
            if (ng) { ng.click(); return 'New Game'; }
            return null;
        });
        await sleep(2500);
        if (R.resumeClick === 'New Game') {
            // Fresh-game setup: start it via the panel's Play control.
            await p.evaluate(() => {
                const t = (b) => (b.textContent || '').trim();
                const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent && !b.closest('header, nav'));
                const pl = btns.find((b) => /^play$/i.test(t(b)));
                if (pl) pl.click();
            });
            await sleep(3000);
        }
        const fens2 = [];
        const g1 = Date.now();
        while (Date.now() - g1 < 75000 && fens2.length < 4) {
            const fen = await p.evaluate(() => {
                const el = document.querySelector('chess-board, wc-chess-board');
                return el && el.game && el.game.getFEN ? el.game.getFEN() : null;
            });
            if (fen && fens2[fens2.length - 1] !== fen) fens2.push(fen);
            await p.waitForTimeout(1200);
        }
        R.stabilityGame = { clicked: R.resumeClick, positions: fens2.length };
        check('stability: resume keeps playing after navigation', fens2.length >= 3, 'saw ' + fens2.length);
    } catch (e) { check('stability: navigation recovery', false, String(e).slice(0, 150)); }

    // 7. auto-rematch: enable it via the REAL panel checkbox, resign the live
    //    game, and the bot itself must start the next one (it clicks the
    //    sidebar "Rematch" control — verified live to reset the board and
    //    resume auto-moves instantly).
    try {
        R.rematchEnabled = await p.evaluate(() => {
            const cb = document.getElementById('chkRematch');
            if (cb && !cb.checked) cb.click();
            return cb ? cb.checked : null;
        });
        R.rematchStored = await p.evaluate(() => localStorage.getItem('cabe_ext_bot_autoRematch'));
        check('auto-rematch: checkbox enabled + persisted', R.rematchEnabled === true && String(R.rematchStored).includes('true'), 'ui=' + R.rematchEnabled + ' ls=' + R.rematchStored);

        const resignOpen = await p.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent && x.getAttribute('aria-label') === 'Resign');
            if (b) { b.click(); return true; } return false;
        });
        await sleep(1200);
        const resignConfirm = await p.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent && /^resign$/i.test((x.textContent || '').trim()));
            if (b) { b.click(); return true; } return false;
        });
        check('auto-rematch: resign submitted', resignOpen && resignConfirm, 'open=' + resignOpen + ' confirm=' + resignConfirm);

        await sleep(4000); // game-over UI renders; the bot's 2-4s poll fires
        R.rematchModalSeen = await p.evaluate(() => !!document.querySelector('.game-over-modal-shell-container'));

        const fens3 = [];
        const g2 = Date.now();
        while (Date.now() - g2 < 90000 && fens3.length < 4) {
            const fen = await p.evaluate(() => {
                const el = document.querySelector('chess-board, wc-chess-board');
                return el && el.game && el.game.getFEN ? el.game.getFEN() : null;
            });
            if (fen && fens3[fens3.length - 1] !== fen) fens3.push(fen);
            await p.waitForTimeout(1200);
        }
        R.rematchGame = { positions: fens3.length, modalSeen: R.rematchModalSeen, fens: fens3.slice(0, 4).map((f) => f.slice(0, 32)) };
        const rematchLog = R.console.filter((l) => l.includes('Auto-rematch'));
        check('auto-rematch: bot clicked a rematch control', rematchLog.length > 0, 'logs: ' + R.console.slice(-5).join(' | '));
        check('auto-rematch: a fresh game is being played', fens3.length >= 3, 'saw ' + fens3.length + ' — ' + JSON.stringify(R.rematchGame.fens));
        try { await p.screenshot({ path: path.join(ARTIFACTS, 'e2e-rematch-screenshot.png') }); } catch (e) { }
    } catch (e) { check('auto-rematch phase', false, String(e).slice(0, 150)); }

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
