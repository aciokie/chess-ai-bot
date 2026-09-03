# INSTRUCTIONS.md - Persistent Rules for This Repository

## Mandatory Actions on Every Change

### 1. Version Bump Required
- **ALWAYS** increment `@version` in the userscript header on every push
- Format: `10.0.x` → `10.0.(x+1)`
- Without version bump, Tampermonkey will NOT auto-update users

### 2. Push to GitHub
- After every edit: copy `VUUGY.js` → `chess-ai-bot.user.js` → git commit → git push
- Deploy command sequence:
```bash
Copy-Item "D:\Downlaods\test\improving\VUUGY.js" "D:\Downlaods\test\improving\chess-ai-bot-temp\chess-ai-bot.user.js" -Force
cd "D:\Downlaods\test\improving\chess-ai-bot-temp"
git add chess-ai-bot.user.js
git commit -m "Descriptive message"
git push https://$env:GITHUB_TOKEN@github.com/aciokie/chess-ai-bot.git main
```

### 3. Verify Syntax
- Run `node --check "D:\Downlaods\test\improving\VUUGY.js"` before pushing
- No output = valid syntax

## Error Reporting (Always Active)

The script includes `ErrorReporter` that:
- Auto-dumps to console every 30 seconds
- Instantly dumps when engine status → "error"
- Captures all `window.onerror` and `unhandledrejection`
- Accessible via `window.__SF_ErrorReporter.dump()` in console

## Code Conventions

### Platform Abstraction
- ALL board interactions go through `Platform` object
- Methods: `getFEN()`, `getTurn()`, `getPlayingAs()`, `getLegalMoves()`, `makeMove()`, `isFlipped()`, `getBoardSelectors()`
- Never use `board.game` directly

### Fetch Mock (Critical for Lichess CSP)
- Worker fetch mock ONLY intercepts exact `m.wasmUrl`
- Pattern matching (`.wasm`, `stockfish`, `unpkg.com`) BLOCKS Lichess sockets
- Pass through to real `fetch` for everything else

### Engine Loading
- WASM engines: parallel JS+WASM download → IndexedDB cache → fetch patch → Worker → `uci`/`isready`
- asm.js engines: direct Worker from JS text
- Heartbeat: 3s beacon + 15s `isready` probe; kill after 2 consecutive misses
- WebAssembly.Module caching in IndexedDB for instant reload

### Settings Storage
- Global: `bot_<key>` via `GM_setValue`
- Per-model: `m_<modelId>_<key>` via `GM_setValue`
- Switching models: `loadModelSettings(newId)` hydrates working copies

## Testing Protocol
- Manual only: install in Tampermonkey → open Chess.com/Lichess game
- Verify: `[SF Engine] Engine ready in Xs`, auto-move works, eval bar renders
- Console logs prefixed `[SF Engine]` for debugging

## File Map
- `VUUGY.js` / `chess-ai-bot.user.js` - Single-file userscript (all logic)
- `README.md` - User-facing docs
- `LICENSE` - MIT
- `AGENTS.md` - Agent context (this repo's instructions)
- `INSTRUCTIONS.md` - This file (persistent rules)

## Gotchas to Never Forget
1. **Lichess CSP**: Fetch mock MUST only intercept exact wasm URL
2. **Platform detection**: Runs at top-level `Platform.init()` before any board access
3. **Module transfer**: `postMessage` with transfer fails in some contexts → fallback without transfer
4. **Per-model settings**: `bot_<key>` global, `m_<modelId>_<key>` per-model
5. **GM APIs required**: `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`, `GM_getResourceText`, `GM_info`, `GM_openInTab`

## Version History
- 10.0.0 - Lichess support + Exa AI + Platform abstraction
- 10.0.1 - Fix fetch mock scope (exact wasm URL only)
- 10.0.2 - Fix buildWasmPatchedEngine wasmUrl scope + ErrorReporter