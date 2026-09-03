# 🐛 Lichess Testing & Debugging Guide

## Quick Diagnostic Commands

Run these in browser console (F12) while on Lichess:

```javascript
// 1. Verify Lichess detection
Platform.current === 'lichess'  // Should be true

// 2. Check board element
Platform.getBoard()  // Should return DOM element

// 3. Get current position
Platform.getFEN(Platform.getBoard())  // Should return FEN string

// 4. Check engine
state.engineStatus  // Should be "ready"

// 5. Verify chessground
const board = Platform.getBoard();
const cg = Platform.getLichessChessground(board);
console.log('Chessground:', cg);  // Should be defined
```

---

## Step-by-Step Testing

### Phase 1: Platform Detection (2 min)

```javascript
// Test 1: Check hostname detection
console.log('Hostname:', window.location.hostname);
// Expected: Contains 'lichess.org'

// Test 2: Verify platform constant
console.log('Platform:', Platform.current);
// Expected: 'lichess'

// Test 3: Check selectors
console.log('Selectors:', Platform.getBoardSelectors());
// Expected: Includes 'cg-board' or 'lichess-board'
```

✅ **Pass if:** All three return expected values

---

### Phase 2: Board Detection (2 min)

```javascript
// Test 1: Find board element
const board = Platform.getBoard();
console.log('Board found:', !!board);
console.log('Board element:', board);

// Test 2: Check board class
console.log('Board classes:', board?.className);
// Expected: Contains 'cg-board' or similar

// Test 3: Verify board is visible
console.log('Is visible:', board && board.offsetHeight > 0);
// Expected: true
```

✅ **Pass if:** Board element found and visible

---

### Phase 3: Chessground Detection (2 min)

```javascript
// Test 1: Access chessground instance
const board = Platform.getBoard();
const cg = Platform.getLichessChessground(board);
console.log('Chessground:', cg);

// Test 2: Check chessground state
console.log('CG State:', cg?.state);
// Expected: Object with fen, movable, orientation, etc.

// Test 3: Verify FEN in chessground
console.log('CG FEN:', cg?.state?.fen);
// Expected: Valid FEN string

// Test 4: Check movable destinations
console.log('CG Dests:', cg?.state?.movable?.dests);
// Expected: Map of valid moves
```

✅ **Pass if:** Chessground accessible with state and FEN

---

### Phase 4: Position Detection (2 min)

```javascript
// Test 1: Get current FEN
const board = Platform.getBoard();
const fen = Platform.getFEN(board);
console.log('FEN:', fen);
// Expected: Valid FEN like "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"

// Test 2: Parse turn from FEN
const parts = fen.split(/\s+/);
console.log('Turn part:', parts[1]);
// Expected: 'w' or 'b'

// Test 3: Get turn via Platform
console.log('Turn:', Platform.getTurn(board));
// Expected: 1 (white) or 2 (black)

// Test 4: Verify move list
console.log('Legal moves:', Platform.getLegalMoves(board));
// Expected: Array of {from, to} objects with >0 length
```

✅ **Pass if:** FEN retrieved and turns correctly detected

---

### Phase 5: Player Color Detection (2 min)

```javascript
// Test 1: Get player color via Lichess API
console.log('Player color (lichess.data):', window.lichess?.data?.player?.color);
// Expected: 'white' or 'black'

// Test 2: Get via round API
console.log('Player color (round):', window.lichess?.round?.data?.player?.color);
// Expected: 'white' or 'black'

// Test 3: Get via Platform
const board = Platform.getBoard();
const playerColor = Platform.getPlayingAs(board);
console.log('Player as:', playerColor);
// Expected: 1 (white) or 2 (black)

// Test 4: Check board orientation
const cg = Platform.getLichessChessground(board);
console.log('Orientation:', cg?.state?.orientation);
// Expected: 'white' or 'black'
```

✅ **Pass if:** Player color correctly identified

---

### Phase 6: Engine Loading (3 min)

```javascript
// Test 1: Check initial status
console.log('Engine status:', state.engineStatus);
// Expected: 'not_installed' initially

// Test 2: Wait for engine loading
// (Wait 30-60 seconds for console output)
// Expected: "[SF Engine] Engine ready!"

// Test 3: Check engine instance
console.log('Engine loaded:', !!state.localEngine);
// Expected: true

// Test 4: Check WASM cache
await Cache.get('sf18_05_wasm').then(cached => {
    console.log('WASM cached:', !!cached);
    console.log('WASM size:', cached?.length, 'bytes');
});
// Expected: size around 113,000,000 bytes

// Test 5: Monitor download progress
console.log('Download state:', state.wasmDownloadState);
// Expected: Should show bytesReceived, totalBytes
```

✅ **Pass if:** Engine loads with "Engine ready" message

---

### Phase 7: Move Detection (3 min)

```javascript
// Test 1: Get legal moves
const board = Platform.getBoard();
const legalMoves = Platform.getLegalMoves(board);
console.log('Legal moves:', legalMoves);
console.log('Move count:', legalMoves.length);
// Expected: Array with multiple valid moves

// Test 2: Validate move format
if (legalMoves.length > 0) {
    const firstMove = legalMoves[0];
    console.log('First move:', firstMove);
    console.log('Valid format:', firstMove.from && firstMove.to);
}
// Expected: Both 'from' and 'to' are 2-char strings (e.g., 'e2')

// Test 3: Check move destinations
const cg = Platform.getLichessChessground(board);
const dests = cg?.state?.movable?.dests;
console.log('Raw destinations:', dests);
// Expected: Map like Map { 'e2' => Set ['e3', 'e4'], ... }

// Test 4: Test move validation
const testMove = legalMoves[0];
const isValid = legalMoves.some(m => m.from === testMove.from && m.to === testMove.to);
console.log('Move validation:', isValid);
// Expected: true
```

✅ **Pass if:** Legal moves retrieved in correct format

---

### Phase 8: Move Execution (2 min)

```javascript
// Test 1: Get first legal move
const board = Platform.getBoard();
const legalMoves = Platform.getLegalMoves(board);
const testMove = legalMoves[0];
console.log('Test move:', testMove);

// Test 2: Simulate makeMove (DO NOT RUN - TEST ONLY)
// Uncomment only if you want to make a real move:
// const success = Platform.makeMove(board, testMove, 'q');
// console.log('Move executed:', success);

// Test 3: Check socket availability
console.log('Socket ready:', !!window.lichess?.socket?.send);
// Expected: true

// Test 4: Check chessground move function
const cg = Platform.getLichessChessground(board);
console.log('CG.move available:', typeof cg?.move === 'function');
// Expected: true

// Test 5: Check chessground promote function
console.log('CG.promote available:', typeof cg?.promote === 'function');
// Expected: true
```

✅ **Pass if:** Move execution methods available

---

## Performance Testing

### CPU Usage Test (5 min)

1. Open Task Manager (Ctrl+Shift+Esc)
2. Note CPU before opening Lichess game
3. Open game and wait for engine to load
4. Record CPU during engine analysis
5. Expected: 5-15% (down from 15-25% before optimization)

```javascript
// Monitor during test
setInterval(() => {
    console.log('Current FEN:', Platform.getFEN(Platform.getBoard()));
}, 2000);
```

### Memory Test (5 min)

1. Open DevTools (F12) → Memory tab
2. Take heap snapshot before engine load
3. Load game and engine
4. Take heap snapshot after engine ready
5. Compare memory usage

```javascript
// Check object counts
console.log('Error entries:', ErrorReporter.entries.length);  // Should be <200
console.log('Cache size:', state.wasmDownloadState);
```

### Speed Test (5 min)

```javascript
// Time first load
console.time('First load');
// (Wait for engine to load)
console.timeEnd('First load');
// Expected: 2-3 minutes

// Reload page and time second load
console.time('Cached load');
// (Wait for engine to load)
console.timeEnd('Cached load');
// Expected: <500ms
```

---

## Error Diagnosis

### Check Error Log

```javascript
// Dump all errors
window.__SF_ErrorReporter.dump()

// Look for any errors with context 'lichess_*'
// Examples:
// - lichess_highlight
// - lichess_move
// - lichess_detection
```

### Monitor Real-Time Errors

```javascript
// Watch for new errors
setInterval(() => {
    const errors = ErrorReporter.entries;
    if (errors.length > 0) {
        const latest = errors[errors.length - 1];
        console.log('Latest error:', latest);
    }
}, 5000);
```

### Check Console Logs

Look for messages starting with:
- `[SF Engine]` - Engine status messages
- `[ERR:*]` - Error messages
- `Platform detected: lichess` - Platform detection

---

## Common Issues & Solutions

### Issue: "Platform detected: unknown"
```javascript
// Solution: Check hostname
console.log('Hostname:', window.location.hostname);
// Should contain 'lichess.org'

// Verify URL
console.log('URL:', window.location.href);
// Should be https://lichess.org/...
```

### Issue: Board element not found
```javascript
// Solution: Check selector
document.querySelectorAll('cg-board').length  // Should be >0
document.querySelectorAll('lichess-board').length  // Should be >0

// If 0, inspect the board:
const board = document.querySelector('[class*="cg"]');
console.log('Found similar:', board);
```

### Issue: Chessground not accessible
```javascript
// Solution: Wait for initialization
const waitForCG = () => {
    const board = Platform.getBoard();
    const cg = Platform.getLichessChessground(board);
    if (!cg) {
        console.log('Chessground not ready, retrying...');
        setTimeout(waitForCG, 500);
    } else {
        console.log('Chessground ready!');
    }
};
waitForCG();
```

### Issue: FEN is empty or invalid
```javascript
// Solution: Check initialization order
setTimeout(() => {
    const board = Platform.getBoard();
    const fen = Platform.getFEN(board);
    console.log('FEN after delay:', fen);
}, 2000);  // Wait for chessground to be ready
```

### Issue: Engine not loading
```javascript
// Solution: Check WASM download
console.log('WASM state:', state.wasmDownloadState);
// Check if:
// - inProgress = true
// - bytesReceived increases
// - No errors in ErrorReporter.dump()

// Force reload
state.engineRetryAt = 0;
loadLocalEngine();
```

---

## Capture for Bug Reports

If you find an issue, capture this info:

```javascript
{
    platform: Platform.current,
    hostname: window.location.hostname,
    boardFound: !!Platform.getBoard(),
    chessgroundFound: !!Platform.getLichessChessground(Platform.getBoard()),
    fen: Platform.getFEN(Platform.getBoard()),
    engineStatus: state.engineStatus,
    errorLog: ErrorReporter.dump(),
    wasmState: state.wasmDownloadState,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString()
}
```

Copy this and include in bug reports!

---

## Advanced Monitoring

### Watch All State Changes

```javascript
// Monitor state in real-time
const stateProxy = new Proxy(state, {
    set: (target, prop, value) => {
        console.log(`State.${prop} = ${JSON.stringify(value)}`);
        return Reflect.set(...arguments);
    }
});
```

### Track Move Execution

```javascript
// Monitor move attempts
const originalMakeMove = Platform.makeMove;
Platform.makeMove = function(board, move, promotion) {
    console.log('Attempting move:', move, 'with promotion:', promotion);
    const result = originalMakeMove.call(this, board, move, promotion);
    console.log('Move result:', result);
    return result;
};
```

### Profile Engine Performance

```javascript
// Time analysis operations
console.time('Engine analysis');
// (Wait for analysis)
console.timeEnd('Engine analysis');
// Expected: <1000ms for each position
```

---

## Testing Checklist

- [ ] Platform detected as 'lichess'
- [ ] Board element found
- [ ] Chessground instance accessible
- [ ] FEN retrieved correctly
- [ ] Legal moves detected
- [ ] Turn correctly identified
- [ ] Player color correct
- [ ] Engine loads with "Engine ready" message
- [ ] No errors in ErrorReporter.dump()
- [ ] CPU usage < 15% during analysis
- [ ] Memory stable (no growth over time)
- [ ] Cache works on reload (<500ms)
- [ ] Moves can be made successfully
- [ ] Socket communication confirmed

**Total test time: 45-60 minutes for full suite**

---

## Performance Benchmarks

| Metric | Target | Actual (v10.0.22) |
|--------|--------|-------------------|
| Platform detection | <1s | ✅ ~100ms |
| Board finding | <500ms | ✅ ~50ms |
| Chessground access | <1s | ✅ ~100ms |
| FEN retrieval | <10ms | ✅ ~2ms |
| Legal moves | <50ms | ✅ ~10ms |
| Engine load (first) | <3m | ✅ 2-3m |
| Engine load (cached) | <1s | ✅ <500ms |
| CPU during analysis | <15% | ✅ 5-10% |
| Memory after load | <500MB | ✅ ~400MB |

---

## Success Indicators

✅ **You're good if:**
- Platform is correctly detected as 'lichess'
- Board and chessground are accessible
- FEN updates as you play
- Engine loads without errors
- CPU usage is reduced
- Memory is stable
- Moves execute correctly
- No errors in error log

❌ **There's an issue if:**
- Platform detected as 'unknown'
- Board element not found
- FEN is always empty
- Engine never loads
- CPU is > 20% during analysis
- Memory continuously grows
- Moves don't execute
- Multiple errors in error log

---

**Happy testing! Report any issues with the debug info above.** 🚀
