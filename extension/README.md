# Chess AI Bot — Browser Extension (MV3)

A **full port of the userscript** (`chess-ai-bot.user.js`) as a Chrome/Edge/Brave
extension. Every feature, setting, and UI behavior is preserved — the extension
build is generated from the userscript by `build.mjs`, and `tests/extension.test.js`
enforces regeneration parity plus feature checks.

**Key difference from the userscript:** all 7 engine models ship **inside the
extension** (`engines/<model>/…`). Engine load = compile + run of local files:
no downloads, no CDN dependency, ~200 ms from click to ready.

## Install (unpacked)

1. Fetch the engine files once (~110 MB, hash-verified):
   ```
   node extension/download-engines.mjs
   ```
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this `extension/` folder.
3. Open any Chess.com game / analysis page. The engine loads automatically.
   Press **H** to toggle the UI panel (it starts hidden; `✕` hides it too).

## Rebuilding

| Task | Command |
|------|---------|
| Regenerate the content script from the userscript | `node extension/build.mjs` |
| Verify it is in sync (CI/agent check) | `node extension/build.mjs --check` |
| Fetch / re-verify engine files | `node extension/download-engines.mjs [--force]` |
| Real-browser E2E (loads the extension in Chromium) | `node extension/e2e-test.mjs` |

The E2E runner needs a Playwright install (`--playwright=<path>` or a local `playwright-core`) and auto-discovers Playwright's own Chromium (or Brave/Edge). It verifies panel injection on live Chess.com, the H keybind, the bundled local engine load, a model switch, and the cached reload path; results + a screenshot land in `e2e-artifacts/` (git-ignored).

**Never edit `src/bot.js` directly** — edit `chess-ai-bot.user.js`, then rebuild.

## Layout

```
extension/
  manifest.json           MV3 manifest (chess.com content scripts, bundled-engine CSP)
  src/gm-polyfill.js      GM_* shims (localStorage storage, fetch-based XHR)
  src/bot.js              generated — full userscript w/ bundled-engine fast path
  engines/                bundled engine files (git-ignored; fetch via download-engines.mjs)
  build.mjs               userscript -> bot.js generator
  download-engines.mjs    hash-verified engine fetcher (release mirror -> CDN fallback)
```

## Notes

- Engine files are **not committed to git** (see `.gitignore`) — `download-engines.mjs`
  rebuilds them from this repo's [release mirror](https://github.com/aciokie/chess-ai-bot/releases/latest)
  with SHA-256 verification (same pins as the userscript + mirror workflow).
- If a bundled engine ever fails to construct, the loader automatically falls
  back to the userscript's original multi-CDN source chain.
- Settings persist per Chess.com origin in `localStorage` (`cabe_ext_*` keys).
