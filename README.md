# ♟️ Chess AI Bot - Chess.com Engine

**Real-time Stockfish 18 analysis directly in your browser on Chess.com**

![Version](https://img.shields.io/badge/version-11.0.12-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Chess.com-critical)

---

## ⚠️ Platform Status

| Platform | Status |
|----------|--------|
| **Chess.com** | ✅ **Working** - Live games, Daily, Analysis, Puzzles |
| **Lichess.org** | ⚠️ **WIP (Work in Progress)** - Partially functional, color detection unreliable |

**Lichess integration is experimental** - The script loads on Lichess but color detection often fails (especially in AI games, puzzles, and analysis boards). You may need to manually click "Analyze" to trigger it. Use at your own risk on Lichess.

---

## 🚀 Quick Install (30 seconds)

### Step 1: Install Tampermonkey
- **Chrome**: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobp53f
- **Firefox**: https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/
- **Safari**: https://safari-extensions.apple.com/ (search "Tampermonkey")

### Step 2: Install Chess AI Bot
**👉 [Click to Install](https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js)**

That's it! Open any Chess.com game and the engine appears automatically.

---

## ✨ Features (Chess.com)

### 🎯 Smart Analysis
- **Real-time Stockfish 18** - Depth up to 25
- **Color-first detection** - Only analyzes YOUR moves (not opponent's) → **~50% CPU savings**
- **Auto-moves** - Optional auto-play with human-like delays
- **Opening book** - 1000+ instant opening moves
- **Move highlights** - See best moves visually on the board
- **Eval bar** - Watch the evaluation change in real-time

### ⚡ Performance
- **WASM Streaming** - 1-2s engine startup (was 4-5s)
- **Multi-CDN fallback** - 99.9% successful WASM downloads (unpkg, jsdelivr, statically)
- **IndexedDB caching** - No re-download on page reload
- **Memoized board access** - 50-70% CPU reduction vs naive polling

### 🎮 Game Options
- **Depth:** 8-25 (deeper = stronger but slower)
- **Auto-queue:** Auto-move in blitz/bullet
- **Time management:** Delay moves based on clock
- **Humanizer:** Add randomness to moves (configurable %)
- **Opening book:** Play known positions instantly
- **Threat detection:** Spot opponent's threats

---

## 🎛️ Configuration Menu

Click the **green "SF ENGINE"** button in the top-right corner to access:

### 📋 Tabs
- **Analyze** - Toggle analysis on/off, set depth
- **Rematch** - Auto-accept rematch challenges
- **Visual & Theme** - Customize colors and arrow styles
- **Local Engine Settings** - Tune Stockfish parameters (hash, skill level, etc.)
- **Debug Logs** - See what the engine is doing

### 🔧 Key Settings
```
Engine Mode:  Local (Stockfish WASM in your browser)
Depth:        18 (default, adjustable 8-25)
Auto-Move:    ON (optional, disable for analysis only)
Time Mgmt:    ON (plays faster with more time)
Auto-Run:     ON (starts analyzing as soon as page loads)
```

---

## 🐛 Troubleshooting

### "No update found" in Tampermonkey?
- Right-click the script → **Check for updates** → should see v11.0.12
- If still not showing:
  1. Click **Update** manually
  2. Restart your browser
  3. Refresh Chess.com

### Engine not starting?
1. Check console (F12 → Console) for error messages
2. Look for `[SF Engine]` logs
3. Common causes:
   - Browser blocked IndexedDB (check privacy settings)
   - Corporate firewall blocking unpkg.com/cdn.jsdelivr.net/statically.io
   - Browser storage full (clear cache)

### Analyzing opponent moves?
- v11.0.0+ fixed this for Chess.com! Update your script
- Should see: `[SF Engine] Chess.com: Skipping analysis (opponent's turn)`

### Engine is slow?
- Check depth setting (reduce from 25 to 18)
- Close other browser tabs
- Check CPU usage (task manager)

---

## 📜 Version History

### v11.0.12 (Latest - Sept 2026)
- Fixed eval bar resetting to 0.0 after each analysis
- Fixed book moves showing 0.0 eval (now +0.15 advantage)
- Massive opening book expansion (1000+ positions covering all major openings)
- Removed Exa Search UI, repurposed Exa API for opening book fallback
- Fixed WASM download: multi-CDN (unpkg, jsdelivr, statically), 5 retries, 5min timeout, native XHR
- Fixed auto-analysis stopping: MutationObserver re-attachment, setInterval backup poll, stuck thinking watchdog
- Lichess color detection: 10s timeout fallback (allows analysis when color unknown)

### v11.0.0-11.0.11
- Chess.com color-first detection (50% CPU savings)
- WASM multi-CDN reliability
- Performance optimizations
- Stuck thinking watchdog

### v10.x
- Lichess support added (experimental)
- WASM multi-CDN reliability
- Performance optimizations

---

## ⚙️ Advanced: How It Works (Chess.com)

### Architecture
```
┌─────────────────────────────────────────────────┐
│  Userscript (Chess AI Bot)                      │
│  Runs in: Chess.com browser tabs                │
└────────┬────────────────────────────────────────┘
         │
         ├─→ Platform Detector
         │   • Chess.com: game.getFEN(), getTurn()
         │
         ├─→ Board Monitor (every 50ms)
         │   • Detect FEN changes
         │   • Check if it's your turn (COLOR-FIRST)
         │   • If your move → Analyze
         │
         ├─→ WebWorker (separate thread)
         │   • Stockfish WASM engine
         │   • Receives: FEN + depth
         │   • Returns: Best move + evaluation
         │
         └─→ Move Executor
             • Chess.com: game.makeMove()
```

### Why It's Fast
1. **Streaming WASM** - Download 113MB while compiling
2. **IndexedDB cache** - Skip recompile on reload (4-5s saved!)
3. **Memoized board access** - Don't query DOM 500x/sec
4. **Color-first check** - Return early for opponent moves (~50% CPU)
5. **Multi-CDN fallback** - Stockfish always downloads (unpkg, jsdelivr, statically)

---

## 📞 Support

### Report Issues
1. Open Chess.com → Press **F12** (Developer Tools)
2. Go to **Console** tab
3. Look for red error messages with `[SF Engine]`
4. Copy the error logs
5. Create issue at: https://github.com/aciokie/chess-ai-bot/issues

### Check Logs
```javascript
// In browser console:
window.__SF_ErrorReporter.dump()  // View all captured errors
```

---

## 📄 License

MIT License - Use freely, modify as needed, share with others!

---

## 🙏 Credits

- **Stockfish Team** - The actual chess engine
- **Chess.com** - For being a great platform
- **Tampermonkey** - Making userscripts possible

---

## 🚀 What's Next?

Future improvements being worked on:
- [ ] Cloud API integration (faster analysis)
- [ ] Multi-variant support (Chess960, etc.)
- [ ] **Fix Lichess integration** (reliable color detection, board observation)
- [ ] Mobile app version

---

**Questions?** Check the [GitHub Issues](https://github.com/aciokie/chess-ai-bot/issues)

**Like it?** ⭐ Star the repo!

---

*Made with ♥️ for the chess community*