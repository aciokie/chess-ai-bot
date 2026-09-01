# AGENTS.md - Chess AI Bot Userscript

## Quick Facts
- **Type**: Tampermonkey/Violentmonkey userscript (~270KB)
- **Targets**: Chess.com (`chess-board`, `wc-chess-board`) + Lichess (`cg-board`, `lichess-board`)
- **Engine**: Stockfish WASM (18.0.5) + asm.js fallbacks
- **Auto-updates**: `@updateURL` / `@downloadURL` → `https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js`
- **Version**: `11.0.0` (bump on every push for TM to detect)
- **Source**: `VUUGY.js` (dev) → `chess-ai-bot.user.js` (deploy)

## Architecture
- **Platform abstraction**: `Platform` object detects chess.com vs lichess, exposes `getFEN()`, `getTurn()`, `getPlayingAs()`, `getLegalMoves()`, `makeMove()`, `isFlipped()`, `getBoardSelectors()`
- **Engine loading**: `loadLocalEngine()` → downloads JS+WASM in parallel → caches in IndexedDB (separate per model) → patches `fetch` in Worker → compiles WebAssembly → sends `uci`/`isready`
- **Heartbeat**: 3s worker beacon + 15s main-thread `isready` probe; only kills after 2 consecutive missed heartbeats
- **Fetch mock**: Inside worker, only intercepts the **exact** `m.wasmUrl` passed at launch; all other fetches pass through to real `fetch` (critical for Lichess CSP)
- **Multi-model**: Each model has independent caps (`hasNNUE`, `hasSlowMover`, `hasWDL`, etc.) and per-model GM settings keys (`m_<modelId>_<key>`)
- **Color-first detection**: Lichess now analyzes only YOUR moves (50% CPU savings) via `window.__LichessDebug.showStatus()`

## Key Commands
```bash
# No build/test/lint - pure userscript
# Verify syntax only:
node --check VUUGY.js

# Deploy: copy VUUGY.js → chess-ai-bot.user.js → git push main

# Playwright test (uses Brave browser):
npm test
```

## Critical Gotchas
1. **Lichess CSP**: The worker's `fetch` mock MUST only intercept the exact wasm URL. Broad patterns (`.wasm`, `stockfish`, `unpkg.com`) block Lichess socket connections → engine fails to load.
2. **Platform detection**: Runs at top-level `Platform.init()` before any board access. `CONFIG.BOARD_SEL` includes both platforms but `Platform.getBoardSelectors()` returns platform-specific selector.
3. **WebAssembly.Module caching**: On reload, tries to load compiled module from IndexedDB to skip 4-5s compile. Falls back to bytes if `postMessage` transfer fails (not transferable in all contexts).
4. **Per-model settings**: Global settings use `bot_<key>`, per-model use `m_<modelId>_<key>`. Switching models calls `loadModelSettings(newId)` to hydrate working copies.
5. **GM APIs required**: `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`, `GM_getResourceText`, `GM_info`, `GM_openInTab`

## File Map
- `VUUGY.js` / `chess-ai-bot.user.js` - Single-file userscript (all logic)
- `README.md` - User-facing docs
- `LICENSE` - MIT
- `playwright.config.js` - Playwright test config (Brave browser)
- `tests/brave-smoke.spec.js` - Smoke test

## Testing
- Manual only: install in Tampermonkey, open Chess.com/Lichess game, verify engine loads (`[SF Engine] Engine ready in Xs`), auto-move works, eval bar renders.
- Console logs prefixed `[SF Engine]` for debugging.
- Playwright smoke test runs against Brave browser (headless: false) via `npm test`