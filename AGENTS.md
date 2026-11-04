# AGENTS.md - Chess AI Bot Userscript

## Quick Facts
- Single-file Tampermonkey/Violentmonkey userscript: `chess-ai-bot.user.js` (~287KB, ~5000 lines). No build step, no package.json, no lint config.
- Chess.com only: `@match` covers play/game/analysis/puzzles/daily pages; board selectors `chess-board, wc-chess-board`.
- Engines are downloaded at runtime via ordered multi-source chains (unpkg → jsdelivr → this repo's GitHub release mirror); WASM bytes are SHA-256 pinned before caching. No WASM is committed to the repo. See registry below.
- Auto-update: `@updateURL` / `@downloadURL` → raw.githubusercontent.com. **Bump `@version` on every push** (currently 11.7.5) or Tampermonkey won't detect the update.
- Only these GM APIs are granted: `GM_getResourceText`, `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`, `GM_info`. The `@resource stockfish.js` (unpkg SF19 single JS) is used as the bundled loader JS for `sf19_00`.

## Commands
- Syntax check (the closest thing to a lint): `node --check chess-ai-bot.user.js`
- **ALWAYS PUSH WHEN DONE — standing repo rule**: every completed task must be committed and pushed to `main` (`git push origin main`) without waiting to be asked; unpushed work is not done. Bump `@version` whenever the userscript changed. Never force-push or rewrite pushed history.
- Releases: for engine-file or release-worthy changes, also push a `v*` tag matching `@version` — it publishes the **engine mirror release** (`.github/workflows/release-engine-mirror.yml`): downloads, hash-verifies and republishes existing CDN engine files as release assets (no compilation involved). Pushing `main` alone triggers no CI.
- Tests (offline, zero deps): `node tests/run-all.js` runs registry structure, download-integrity units, the worker-bootstrap simulation, and the mirror-workflow cross-check. Individual files run directly (`node tests/<file>.js`). Live CDN + pinned-hash verification (~120 MB download): `node tests/verify-engine-sources.js` (options: `--quick`, `--model=<id>`).
- Legacy: `tests/userscript-test.spec.js` is a Playwright smoke test. No package.json — install ad hoc (`npm i -D @playwright/test && npx playwright install chromium`); test 2 assumes a manually logged-in Chess.com session.

## Engine Loading (the part that bites)
- `LOCAL_ENGINES` (~line 89): per-model ordered `sources` chains (`{label, js, wasm, sha256}`) + capability flags + defaults. The caps map drives UCI options, UI rows, and per-model settings — extend this array, don't special-case elsewhere. Every source of a model must serve byte-identical files (same sha256 pin); add new mirrors as extra sources, never change a pinned hash without re-verifying.
- Pipeline (`loadLocalEngine`): IndexedDB cache → source chain download via GM XHR (each source tried in order; any failure falls through to the next) → Worker built from a bootstrap Blob. Downloads are rejected unless Content-Length matches and the WASM SHA-256 matches the pin — corrupted bytes can never reach the cache. A compiled `WebAssembly.Module` is posted back from the worker and cached, so reloads skip the 4-5s WASM compile.
- **Fetch mock (critical)**: the bootstrap worker replaces `self.fetch` to serve only the FIRST fetch call while WASM bytes are unconsumed — the loader makes exactly one fetch, and blob-URL workers make URL matching unreliable. Everything else MUST fall through to the real fetch or Chess.com sockets/CSP break.
- **Loader patch (template-escaping trap)**: the bootstrap stubs `Module.onDoneSearching` and regex-replaces `ie[e].apply(null,fe)` with a guarded call (Emscripten function-table TypeError guard, commit 5fd1630). This code lives inside the `bootstrapCode` template literal — every backslash in the regex must be **doubled** (`\\[`, `\\s`, …) or template evaluation strips it and the patch silently stops matching. It shipped broken exactly once (fixed in 11.7.4); `tests/worker-bootstrap.test.js` now guards it.
- Heartbeat: worker posts a beacon every 3s; the main thread probes `isready` every 15s; only 6 consecutive misses with no recent beacon (~90s) declare the worker dead. Worker errors auto-restart the engine after 2s.
- Watchdog: 5-minute hard load timeout, then a 120s retry cooldown (mainly trips when IndexedDB is blocked, e.g. incognito).
- Auto-heal: a WASM Compile/Link error purges the model's cache once (`purgeModelCache`) and re-downloads; if the reload fails again, the 2s auto-restart is skipped so it can't hot-loop (`engineHealMap` tracks this per model per page).
- Settings: global `bot_<key>`, per-model `m_<modelId>_<key>` (hydrated into the `settings.local*` working copies by `loadModelSettings()`). `engineMode` is forced to `"local"` at startup.
- Turn gating: analysis and auto-move only run when `isOurTurnNow()`; FEN comes from `state.board.game.getFEN()` via `getRawBoardFEN()`. Board reads are memoized with a 2-5s backup poll.
- Anti-cheat: after every 12-25 analysis ticks `shouldPauseAnalysis()` skips 0.7-2.5s (disabled in bulletMode).

## Model Registry (LOCAL_ENGINES)
| id | label | format | maxDepth | hasNNUE | hasSlowMover | hasWDL | hasContempt | hasMinThink | hasRepetition |
|----|-------|--------|----------|---------|--------------|--------|-------------|-------------|---------------|
| sf19_small | SF 19.0.0 Small/Lite | wasm | 20 | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| sf19_00 | SF 19.0.0 | wasm | 25 | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| sf18_05 | SF 18.0.5 | wasm | 25 | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| sf16_00 | SF 16.0 | wasm | 25 | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| sf11_00 | SF 11.0 | wasm | 20 | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| sf10_02 | SF 10.0.2 | asm.js | 20 | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| sf9_00 | SF 9.0.0 | asm.js | 18 | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |

All models have Skill Level, Hash, and Move Overhead. `format: "asmjs"` models have `sources` without a `wasm` key — they load a single JS file and skip the WASM worker path entirely.

## IndexedDB Schema
- DB `sfEngineCache` (v2), store `engines`; `{cacheKey}` = model id. Keys:
  - `{cacheKey}_js` / `{cacheKey}_wasm` — raw downloaded text/bytes
  - `{cacheKey}_patched` — {jsCode, wasmBytes} patched-worker payload (fastest bytes path)
  - `{cacheKey}_patched_module` — {v: MODULE_CACHE_VERSION, module} compiled module
- Bump `MODULE_CACHE_VERSION` (currently 1) when changing the worker bootstrap so stale compiled modules are discarded.

## Debugging
- All logs are prefixed `[SF Engine]`. Markers: `loadLocalEngine START`, `Download attempt N/M via <label>`, `Source <label> failed`, `All download sources failed`, `Received uciok`, `Engine ready in Xs`, `Auto-heal: cache looks corrupted`, `engine alive at Xs, still initializing`, `heartbeat miss N/6`.
- `state` and `settings` are IIFE-scoped — not reachable from the page console. Toggle "Debug logs" in the script UI to enable the gated `log()` output.
- `node --check` only catches syntax errors; runtime issues surface in the Chess.com console.

## Common Issues & Fixes
| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Engine stuck "Loading..." for 5 min | IndexedDB blocked (incognito) | Use a normal window, or press Reinstall |
| "Engine worker unresponsive" | Worker dead/blocked >90s (broken fetch mock, CSP) | Clear cache and reload; check network |
| "All download sources failed" | Every CDN unreachable (VPN/blocker) | Check network; try an asm.js model (no WASM needed) |
| CompileError / LinkError on load | Corrupted cache or mismatched JS/WASM pair | Auto-heal purges + retries once; if it repeats, press Reinstall or run `node tests/verify-engine-sources.js` |
| Auto-move not working | Not your turn, or `autoMove` disabled | Check `isOurTurnNow()` logic and settings |

## Repo Map (beyond the userscript)
- `tests/run-all.js` — offline test suite (registry, download-integrity units, bootstrap simulation, mirror-workflow cross-check); `tests/verify-engine-sources.js` — live CDN + SHA-256 verifier; `tests/lib/extract.js` — shared source-extraction helpers; `tests/userscript-test.spec.js` — legacy Playwright smoke
- `.github/workflows/release-engine-mirror.yml` — on `v*` tags: downloads, hash-verifies and republishes the engine files as release assets (the userscript's `github`/`mirror` sources). Hashes there are cross-checked against the userscript by `tests/mirror-workflow.test.js`
- `README.md` — user-facing docs; version/badges lag behind the userscript
- History note: a custom SF19 WASM build pipeline (`build-sf19*.yml`, `src/glue.cpp`, `BUILD.md`, …) was removed in v11.7.5 — it never compiled (its glue targeted APIs absent from the `sf_19` branch). If revived, port the glue from `lichess-org/stockfish-web`.
