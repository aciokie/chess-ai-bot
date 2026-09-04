# ♟️ Chess AI Bot - Chess.com Engine

**Real-time Stockfish 18 analysis directly in your browser on Chess.com**

![Version](https://img.shields.io/badge/version-11.0.13-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Chess.com-critical)

---

## 🚀 Quick Install (30 seconds)

### Step 1: Install Tampermonkey
- **Chrome**: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobp53f
- **Firefox**: https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/
- **Safari**: https://safari-extensions.apple.com/ (search "Tampermonkey")

### Step 2: Install Chess AI Bot
**👉 [Click to Install](https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js)**

That's it! Open any Chess.com game and the engine appears automatically. ✅

---

## ✨ Features

### 🎯 Smart Analysis
- **Real-time Stockfish 18** - Depth up to 30
- **Auto-moves** - Optional auto-play with human-like delays
- **Opening book** - Instant opening moves (1000+ positions)
- **Move highlights** - See best moves visually on the board
- **Eval bar** - Watch the evaluation change in real-time
- **Only your turn** - Only analyzes when it's your move (saves CPU)

### ⚡ Performance
- **WASM Streaming** - 1-2s engine startup
- **Multi-CDN fallback** - 99.9% successful WASM downloads (unpkg, jsdelivr, statically)
- **IndexedDB caching** - No re-download on page reload
- **Memoized board access** - Efficient board monitoring

### 🎮 Game Options
- **Depth:** 8-30 (deeper = stronger but slower)
- **Auto-queue:** Auto-move in blitz/bullet
- **Time management:** Delay moves based on clock
- **Humanizer:** Add randomness to moves
- **Opening book:** Play known positions instantly
- **Engine selection:** Auto / CDN / Local (self-hosted)

---

## 🎛️ Configuration Menu

Click the **Chess AI Bot** panel in the top-right corner to access:

### 📋 Main Controls
- **Auto Play** - Toggle auto-move on/off
- **Analysis** - Toggle real-time analysis on/off
- **Enabled** - Master enable/disable switch
- **Eval Bar** - Show/hide evaluation bar
- **Best Move** - Show/hide best move arrow
- **Opening Book** - Enable/disable opening book
- **Only My Turn** - Only analyze on your turns

### ⚙️ Engine Settings
- **Depth:** 1-30 (default 20)
- **Movetime:** 50-5000ms (default 100ms)
- **Skill Level:** 0-20 (default 20)
- **Engine Source:** Auto / WASM (CDN) / Local (GitHub)

### 🔧 Key Settings
```
Engine Mode:  Auto (prefers local, falls back to CDN)
Depth:        20 (adjustable 1-30)
Auto-Move:    OFF (optional, enable for auto-play)
Time Mgmt:    ON (respects clock time)
Auto-Run:     ON (starts analyzing as soon as page loads)
```

---

## 🐛 Troubleshooting

### "No update found" in Tampermonkey?
- Right-click the script → **Check for updates** → should see v11.0.13
- If still not showing:
  1. Click **Update** manually
  2. Restart your browser
  3. Refresh Chess.com

### Engine not starting?
1. Check console (F12 → Console) for error messages
2. Look for `[Chess AI Bot]` logs
3. Common causes:
   - Browser blocked IndexedDB (check privacy settings)
   - Corporate firewall blocking unpkg.com/cdn.jsdelivr.net
   - Browser storage full (clear cache)
   - Try switching Engine Source to "Local" in settings

### Engine is slow?
- Check depth setting (reduce from 30 to 18)
- Close other browser tabs
- Check CPU usage (task manager)
- Try "Local" engine source for faster loads

---

## 📜 Updates & Version History

### v11.0.13 (Latest)
- Chess.com-only build (removed Lichess integration)
- Fixed @updateURL and @downloadURL for proper auto-updates
- Multi-CDN WASM download with 5 retries and 5-minute timeout
- Fixed auto-analysis stopping (MutationObserver re-attach, backup poll, watchdog)
- Fixed eval bar resetting to 0.00
- Expanded opening book (1000+ positions)
- Fixed ReferenceError: getRawBoardFEN → BoardManager.getFEN()
- Playwright tests pass (no ReferenceError on Chess.com)

### v11.0.12
- Version bump for update detection

### v9.3.18 (Original working version)
- Chess.com support
- Stockfish WASM engine
- Auto-play with humanizer
- Eval bar and analysis

---

## ⚙️ Advanced: How It Works

### Architecture
```
┌─────────────────────────────────────────────────┐
│  Userscript (Chess AI Bot)                      │
│  Runs in: Chess.com browser tabs                │
└────────┬────────────────────────────────────────┘
         │
         ├─→ Board Detector (wc-chess-board / chess-board)
         │
         ├─→ Board Monitor (event-driven + backup poll)
         │   • Detect FEN changes via MutationObserver
         │   • Backup setInterval every 2s
         │   • Check if it's your turn
         │   • If your move → Analyze / Auto-play
         │
         ├─→ WebWorker (separate thread)
         │   • Stockfish WASM engine (v16.1.0 NNUE)
         │   • Receives: FEN + depth + movetime
         │   • Returns: Best move + evaluation + PV
         │
         └─→ Move Executor
             • Chess.com: game.makeMove() or click simulation
```

### Why It's Fast
1. **Streaming WASM** - Download while compiling
2. **IndexedDB cache** - Skip recompile on reload
3. **Memoized board access** - Don't query DOM excessively
4. **Color-first check** - Return early for opponent moves
5. **Multi-CDN fallback** - Stockfish always downloads

---

## 📞 Support

### Report Issues
1. Open Chess.com → Press **F12** (Developer Tools)
2. Go to **Console** tab
3. Look for red error messages with `[Chess AI Bot]`
4. Copy the error logs
5. Create issue at: https://github.com/aciokie/chess-ai-bot/issues

### Check Logs
```javascript
// In browser console:
localStorage.debug = 'chess-ai-bot:*'  // Enable debug
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
- [ ] Chess.com studies integration
- [ ] Mobile app version
- [ ] Real-time multiplayer analysis

---

**Questions?** Check the [GitHub Issues](https://github.com/aciokie/chess-ai-bot/issues)

**Like it?** ⭐ Star the repo!

---

*Made with ♥️ for the chess community*