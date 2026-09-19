# AGENTS.md - Chess AI Bot Userscript

## Quick Facts
- **Type**: Tampermonkey/Violentmonkey userscript (~277KB)
- **Targets**: Chess.com only (`chess-board`, `wc-chess-board`) — Lichess support removed in v11.0.13
- **Engine**: Stockfish WASM (18.0.5 primary) + 4 fallback models (16.0, 11.0, 10.0.2 asm.js, 9.0 asm.js)
- **Auto-updates**: `@updateURL` / `@downloadURL` → `https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js`
- **Version**: `11.x.x` (bump on every push for TM to detect; current in `chess-ai-bot.user.js`)
- **Source**: `chess-ai-bot.user.js` (single file, no build step)
- **Runtime deps**: `acorn` (AST parsing), `chess.js` (move validation) - bundled in userscript via @resource

## Architecture
- **Platform abstraction**: `Platform` object detects Chess.com, exposes `getFEN()`, `getTurn()`, `getPlayingAs()`, `getLegalMoves()`, `makeMove()`, `isFlipped()`, `getBoardSelectors()`, memoized `getBoard()` with 500ms TTL
- **Engine loading**: `loadLocalEngine()` → downloads JS+WASM in parallel with multi-CDN fallback & retry → caches in IndexedDB (separate per model: `js`, `wasm`, `patched`, `module`) → builds patched Worker → compiles WebAssembly → sends `uci`/`isready`
- **WebAssembly.Module caching**: On reload, tries to load compiled module from IndexedDB (`_module` key) to skip 4-5s compile. Falls back to bytes if `postMessage` transfer fails.
- **Heartbeat**: 3s worker beacon (`__probe:beacon`) + 15s main-thread `isready` probe; only kills after 2 consecutive missed heartbeats (6 misses = 90s)
- **Fetch mock**: Inside worker, only intercepts the **exact** `m.wasmUrl` passed at launch; all other fetches pass through to real `fetch` (critical for Chess.com CSP)
- **Multi-model**: Each model has independent caps (`hasNNUE`, `hasSlowMover`, `hasWDL`, `hasContempt`, `hasMinThink`, `hasRepetition`) and per-model GM settings keys (`m_<modelId>_<key>`)
- **Color-first detection**: Only analyzes when it's YOUR turn (saves CPU)
- **Anti-cheat**: Random brief pauses (12-25 analysis cycles) to simulate human behavior

## Key Commands
```bash
# No build/lint - pure userscript
# Verify syntax only:
node --check chess-ai-bot.user.js

# Deploy: git push main (auto-updates via raw.githubusercontent.com)

# Playwright test (uses Brave browser, headless: false):
npm test
```

## Critical Gotchas
1. **CSP fetch mock**: The worker's `fetch` mock MUST only intercept the exact wasm URL. Broad patterns (`.wasm`, `stockfish`, `unpkg.com`) block Chess.com socket connections → engine fails to load.
2. **Platform detection**: Runs at top-level `Platform.init()` before any board access. `CONFIG.BOARD_SEL` includes selectors but `Platform.getBoardSelectors()` returns platform-specific selector.
3. **WebAssembly.Module caching**: On reload, tries to load compiled module from IndexedDB to skip 4-5s compile. Falls back to bytes if `postMessage` transfer fails (not transferable in all contexts).
4. **Per-model settings**: Global settings use `bot_<key>`, per-model use `m_<modelId>_<key>`. Switching models calls `loadModelSettings(newId)` to hydrate working copies.
5. **GM APIs required**: `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`, `GM_getResourceText`, `GM_info`, `GM_openInTab`
6. **Engine load watchdog**: 5-minute hard timeout prevents stuck loads (incognito/private mode often blocks IndexedDB)
7. **Auto-restart**: Engine auto-restarts 2s after crash (especially after mate sequence)

## File Map
- `chess-ai-bot.user.js` - Single-file userscript (all logic, ~4800 lines)
- `README.md` - User-facing docs
- `LICENSE` - MIT
- `package.json` - Playwright test deps only
- `playwright.config.js` - Playwright test config (Brave browser, headless: false)
- `tests/brave-smoke.spec.js` - Basic smoke test
- `tests/engine-load-test.spec.js` - Chess.com + Lichess engine load test
- `tests/chess-com-engine-test.spec.js` - Chess.com specific tests
- `tests/userscript-test.spec.js` - ReferenceError detection test

## Testing
- **Manual**: Install in Tampermonkey, open Chess.com game, verify engine loads (`[SF Engine] Engine ready in Xs`), auto-move works, eval bar renders.
- **Console logs**: Prefixed `[SF Engine]` for debugging. Key markers: `loadLocalEngine START`, `uciok`, `Engine ready in Xs`, `worker alive at Xs (compiling)`
- **Playwright**: Runs against Brave browser (headless: false) via `npm test`. Tests inject GM mock, navigate to Chess.com/Lichess, wait for engine logs.
- **Debug commands** (in browser console):
  ```js
  console.log(state.engineStatus)        // "ready" | "loading" | "error"
  console.log(settings)                  // All current settings
  console.log(state.wasmDownloadState)   // Download progress
  window.__SF_ErrorReporter?.dump()      // Error table
  ```

## Model Registry (LOCAL_ENGINES)
| id | label | format | maxDepth | hasNNUE | hasSlowMover | hasWDL | hasContempt | hasMinThink |
|----|-------|--------|----------|---------|--------------|--------|-------------|-------------|
| sf18_05 | Stockfish 18.0.5 | wasm | 25 | ✓ | ✗ | ✓ | ✓ | ✗ |
| sf16_00 | Stockfish 16.0 | wasm | 25 | ✓ | ✓ | ✓ | ✓ | ✗ |
| sf11_00 | Stockfish 11.0 | wasm | 20 | ✗ | ✓ | ✗ | ✓ | ✓ |
| sf10_02 | Stockfish 10.0.2 | asmjs | 20 | ✗ | ✓ | ✗ | ✓ | ✓ |
| sf9_00 | Stockfish 9.0.0 | asmjs | 18 | ✗ | ✓ | ✗ | ✓ | ✓ |

## IndexedDB Schema
- DB: `sfEngineCache` (v2)
- Store: `engines`
- Keys per model:
  - `{cacheKey}_js` - JS loader text
  - `{cacheKey}_wasm` - WASM bytes (Uint8Array)
  - `{cacheKey}_patched` - {jsCode, wasmBytes} for instant worker build
  - `{cacheKey}_patched_module` - {v: MODULE_CACHE_VERSION, module: WebAssembly.Module}

## Common Issues & Fixes
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Engine stuck "Loading..." | IndexedDB blocked (incognito) | Wait 5min for watchdog, or use normal window |
| "Engine worker unresponsive" | WASM compile taking >90s | Clear cache, reload; check network |
| No eval bar | `settings.showEvalBar = false` | Toggle in UI |
| Auto-move not working | Not your turn / `autoMove: false` | Check `isOurTurnNow()` logic |
| ReferenceError: getRawBoardFEN | Old API call | Use `Platform.getFEN()` or `BoardManager.getFEN()` |