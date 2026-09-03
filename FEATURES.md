# Chess AI Bot - Complete Feature Documentation

## Overview
Tampermonkey/Violentmonkey userscript that adds Stockfish chess engine analysis and auto-play to Chess.com and Lichess. Runs entirely in-browser via WebAssembly.

---

## Platform Support

### Chess.com
- Live games, daily games, puzzles, analysis boards
- Board selectors: `chess-board`, `wc-chess-board`

### Lichess
- Live games, AI games (vs computer), analysis boards
- Board selectors: `cg-board`, `lichess-board`
- **AI Game Support**: Works on "Play with Computer" pages where standard Lichess API is unavailable

---

## Engine System

### Local Engine (Primary)
- **Stockfish 18.0.5 (WASM)** - Default, NNUE enabled, depth up to 25
- **Stockfish 16.0 (WASM)** - Slow Mover supported
- **Stockfish 11.0 (WASM)** - Classical eval, Contempt, Min Think Time
- **Stockfish 10.0.2 (asm.js)** - Legacy fallback, no WASM needed
- **Stockfish 9.0.0 (asm.js)** - Oldest fallback

### Engine Loading
- Downloads JS + WASM in parallel
- Caches in IndexedDB (separate per model)
- **Compiled WebAssembly.Module caching** - Skips 4-5s compile on reload
- **Patched Worker blob caching** - Instant load from cache
- Only intercepts exact WASM URL in worker fetch mock (critical for Lichess CSP)

### Per-Model Settings
Each engine model has independent settings:
- Hash size, Move Overhead, Skill Level
- Limit Strength / Elo (NNUE models)
- Show WDL (SF12+)
- Slow Mover (SF16 and older)
- Contempt (SF13 and older)
- Min Think Time (SF11 and older)

---

## Color Detection (Lichess)

### Multi-Priority Detection
1. **HTML meta tags** - Before JS loads
2. **Lichess API** - `window.lichess.data.player.color` (ground truth)
3. **Chessground orientation + visual cross-check** - Board orientation vs piece positions
4. **DOM Piece Detection (NEW)** - Analyzes piece Y positions in DOM for AI games
5. **Visual pieces only** - Fallback when orientation unavailable

### AI Game Support
- Detects player color on "Play with Computer" pages
- Works when `window.lichess` and `chessground` are not accessible
- Reads piece positions from shadow DOM (cg-board) or light DOM (lichess-board)
- Falls back to `getBoundingClientRect` if transform parsing fails

### Color-First Analysis
- Detects YOUR color first, then only analyzes YOUR moves
- Prevents analyzing opponent moves (50% CPU savings)
- Returns `false` from `isYourTurn()` when color unknown

---

## Analysis Features

### Auto-Analysis
- Triggers on position change (FEN change detection)
- Configurable depth (1-25)
- Smart depth computation
- Watchdog timeout (30s cloud, 90s local)

### Opening Book
- 1000+ pre-loaded opening positions
- Instant moves for known positions (depth ≤ 12)
- Covers Italian, Sicilian, French, Caro-Kann, English, King's Indian, etc.
- Validates move is legal before playing

### Threat Detection
- Detects opponent threats from MultiPV analysis
- Highlights threatening piece and target square in red
- Shows threat move and score in status
- Auto-clears when threat resolved

### Time Management
- Adjusts move delay based on clock difference
- Behind on time → faster moves
- Ahead on time → slower, more human-like delays
- Caps delay at 5% of remaining time

---

## Auto-Move System

### Auto-Play
- Plays best move automatically after analysis
- Configurable min/max delay (human-like)
- Randomized delay within range
- Re-verifies it's still your turn at execution time

### Humanizer
- Occasionally plays 2nd/3rd best MultiPV move
- Configurable rate (default 15%)
- Simulates human imperfection

### Auto-Rematch
- Accepts rematch offers automatically
- Configurable

---

## Visual Features

### Move Highlights
- **Outline** - Colored border with optional glow
- **Radial Gradient** - Center-bright fade
- **Arrow** - SVG arrow from source to target
- **Native Arrow** - Uses Chess.com's built-in markings API
- Auto-fade with configurable duration
- Survives board re-renders via MutationObserver

### Principal Variation (PV) Arrows
- Shows top N engine lines as colored arrows
- Configurable depth (1-5)
- Gradient colors (yellow→red) or custom
- Optional move numbers on arrows
- Auto-refreshes every 100ms

### Evaluation Bar
- Floating vertical bar attached to board side
- Shows win probability for YOUR color
- **Colors flip** when playing as Black (white at bottom = your color)
- Displays centipawn score or mate distance
- Knob at balance point changes color based on advantage
- Smooth animated transitions
- Works on both platforms without platform CSS dependencies

---

## UI / Menu

### Floating Menu
- Draggable, positionable (top-right, top-left, bottom-right, bottom-left)
- Dark theme with configurable opacity
- Collapsible sections

### Settings Categories
- **Engine**: Mode (Local/Cloud), Model, Depth, Max Thinking Time
- **Auto**: Auto-run, Auto-move, Auto-queue, Hide after move
- **Visuals**: Highlights, PV arrows, Eval bar, Visual type, Colors
- **Timing**: Min/Max delay, Time management
- **Advanced**: Humanizer, Opening book, Threat detection, Anti-cheat pauses
- **Local Engine**: Hash, Move Overhead, Skill, Limit Strength, Elo, WDL, Slow Mover, Contempt, Min Think
- **Exa AI**: API key, search enable

### Per-Model Settings Persistence
- Global settings: `bot_<key>`
- Per-model settings: `m_<modelId>_<key>`
- Auto-loads when switching models

---

## Anti-Cheat Measures

### Analysis Pauses
- Random brief pauses every 12-25 analyses
- 0.7-2.5 second pauses
- Prevents constant engine signature

### Human-Like Delays
- Randomized move delays
- Time management based on clock
- Humanizer for non-best moves

---

## Error Handling & Diagnostics

### Error Reporter
- Captures all errors with full context (stack, platform, engine state, model)
- Stores last 500 errors in memory
- Auto-dumps to console every 30 seconds
- Dumps on engine status change to error
- Global access: `window.__SF_ErrorReporter.dump()`

### Global Error Handlers
- `window.onerror` capture
- `unhandledrejection` capture

### Debug Logging
- Toggleable verbose logging
- Console prefix: `[SF Engine]`

---

## Exa AI Search Integration

### Web Search
- Opening theory lookup
- Player profile search
- Endgame tablebase search
- Configurable domains per search type
- Requires Exa API key

---

## Technical Architecture

### Platform Abstraction
Single `Platform` object with:
- `getFEN()` - Current position
- `getTurn()` - Side to move
- `getPlayingAs()` - Your color
- `getLegalMoves()` - Legal moves
- `makeMove()` - Execute move
- `isFlipped()` - Board orientation
- `getBoardSelectors()` - Platform-specific selectors

### Shadow DOM Isolation
- All visuals rendered in Shadow DOM
- No CSS conflicts with site styles
- Separate shadow roots for eval bar and board highlights

### Heartbeat System
- 3-second worker beacon
- 15-second main-thread `isready` probe
- Kills engine after 2 consecutive missed heartbeats

---

## Keyboard Shortcuts / Console Commands

### Global Access
- `window.__SF_ErrorReporter.dump()` - View all captured errors
- `window.__SF_ErrorReporter.clear()` - Clear error log
- `window.__SF_ErrorReporter.getSummary()` - Error count by context

---

## Configuration Persistence

### GM Storage
- All settings via `GM_getValue` / `GM_setValue`
- Survives browser restarts
- Per-model isolation

### Version Detection
- `@version` bump triggers Tampermonkey update
- Auto-update via `@updateURL` / `@downloadURL` (jsDelivr CDN)

---

## Requirements

### Tampermonkey Permissions
- `GM_getValue`, `GM_setValue`
- `GM_xmlhttpRequest` (engine downloads)
- `GM_getResourceText` (bundled Stockfish JS)
- `GM_info`, `GM_openInTab`

### Browser Support
- WebAssembly support required
- IndexedDB for caching
- Shadow DOM v1
- ES6+ features

---

## File Structure

```
chess-ai-bot.user.js   # Deployed userscript (single file, ~270KB)
VUUGY.js               # Development source (identical to deployed)
README.md              # User documentation
LICENSE                # MIT
playwright.config.js   # Test config (Brave browser)
tests/
  brave-smoke.spec.js  # Smoke test
```