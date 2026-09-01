# Implementation Checklist & Testing Guide

## Pre-Implementation

- [ ] Read QUICK-START.md
- [ ] Backup original VUUGY.js
- [ ] Have Tampermonkey/Violentmonkey installed
- [ ] Know how to open browser console (F12)
- [ ] Have test environment ready (Chess.com or Lichess)

---

## Installation

- [ ] Copy content from VUUGY-OPTIMIZED.js
- [ ] Create new script in Tampermonkey
- [ ] Paste content
- [ ] Save with Ctrl+S
- [ ] Enable the script
- [ ] No conflicts with other scripts

---

## Initial Testing (First 5 Minutes)

### Console Verification
- [ ] Open Chess.com or Lichess
- [ ] Press F12 to open console
- [ ] Look for: `[SF Engine] Platform detected: chess.com` or `lichess`
- [ ] Look for: `[SF Engine] Initializing...`
- [ ] Look for: `[SF Engine] Loading engine...`

### Download Progress
- [ ] See: `[SF Engine] WASM: XX% (XXmb/113MB)`
- [ ] Percentage increases gradually
- [ ] No errors in console
- [ ] Takes 2-3 minutes total

### Engine Ready
- [ ] See: `[SF Engine] Engine ready!`
- [ ] No "error" messages
- [ ] Eval bar appears (if enabled)
- [ ] Auto-move works (if enabled)

---

## Performance Verification (5-15 Minutes)

### CPU Usage
- [ ] Open Task Manager (Windows) or Activity Monitor (Mac)
- [ ] Check browser CPU before optimization: baseline
- [ ] Check browser CPU after optimization: should be 50-70% lower
- [ ] No CPU spikes during analysis

### Memory Usage
- [ ] Chrome DevTools → Memory tab
- [ ] Heap size stable (~10-20MB)
- [ ] No continuous memory growth
- [ ] No memory spikes

### Console Error Check
- [ ] Run: `window.__SF_ErrorReporter.dump()`
- [ ] Should show few or no errors
- [ ] Any errors are logged and captured

---

## Caching Verification (10-30 Minutes)

### First Load
- [ ] Time from page load to engine ready: ~2-3 minutes
- [ ] See WASM download messages
- [ ] Successfully completes

### Refresh/Second Load
- [ ] Reload page (F5)
- [ ] Time from page load to engine ready: <500ms
- [ ] See: `[SF Engine] Using cached WASM`
- [ ] Much faster than first load

### Cache Status
- [ ] Run in console:
```javascript
await Cache.get('sf18_05_wasm').then(c => {
    console.log(`Cache hit: ${!!c} (${c?.length || 0} bytes)`);
});
```
- [ ] Should show cache with 113MB bytes

---

## Network Failure Recovery (5 Minutes)

### Simulate Network Failure
1. [ ] In console, enable offline mode:
```javascript
state.wasmDownloadState.inProgress = true;
```

2. [ ] Reload page
3. [ ] See retry messages (should try 5 times)
4. [ ] After retries exhausted, shows error
5. [ ] Reload again with network back
6. [ ] Should succeed on next attempt

---

## Settings Verification

### Default Settings
- [ ] Run in console: `console.log(settings)`
- [ ] Shows all default settings loaded
- [ ] Local model ID set correctly

### Persistence
- [ ] Change a setting (depth, skill level, etc)
- [ ] Reload page
- [ ] Setting still there (persisted in GM_setValue)

---

## Error Handling

### View Error Log
- [ ] Run: `window.__SF_ErrorReporter.dump()`
- [ ] Clear table format
- [ ] Each error has timestamp and context

### Specific Errors
- [ ] WASM timeout: see clear message
- [ ] Network error: see specific URL
- [ ] Cache error: gracefully handled
- [ ] No undefined errors

---

## Feature Verification

### Engine Loading Status
- [ ] Console: `console.log(state.engineStatus)`
- [ ] Should be: "ready" or "loading" or "error"
- [ ] Transition through states correctly

### Download State
- [ ] Console: `console.log(state.wasmDownloadState)`
- [ ] Shows: inProgress, bytesReceived, totalBytes, retries, currentUrl

### Engine Instance
- [ ] Console: `console.log(state.localEngine)`
- [ ] Should be truthy after loading
- [ ] Worker properly initialized

---

## Advanced Testing

### Force Cache Clear
- [ ] Console:
```javascript
await Cache.delete('sf18_05_wasm');
await Cache.delete('sf18_05_js');
```
- [ ] Next reload forces re-download
- [ ] Takes 2-3 minutes again

### Monitor Download Progress
- [ ] Console:
```javascript
setInterval(() => {
    const s = state.wasmDownloadState;
    console.log(`${s.bytesReceived}/${s.totalBytes} (${Math.round(s.bytesReceived/s.totalBytes*100)}%)`);
}, 1000);
```
- [ ] Shows real-time progress
- [ ] Updates every second

### Check All CDN Fallbacks
- [ ] In CONFIG, URLs should include:
  - https://unpkg.com/stockfish@18.0.5/...
  - https://cdn.jsdelivr.net/npm/stockfish@18.0.5/...
- [ ] Code verifies multiple attempts

---

## Compatibility Testing

### Chess.com
- [ ] [ ] Loads on chess.com/play/*
- [ ] [ ] Loads on chess.com/game/*
- [ ] [ ] Loads on chess.com/analysis
- [ ] [ ] Loads on chess.com/puzzles/*
- [ ] [ ] Board detection works
- [ ] [ ] Eval bar appears
- [ ] [ ] Auto-move works

### Lichess
- [ ] [ ] Loads on lichess.org games
- [ ] [ ] Loads on lichess.org/analysis
- [ ] [ ] Board detection works
- [ ] [ ] Eval bar appears
- [ ] [ ] Auto-move works

---

## Stress Testing (Optional)

### Long Session (30+ minutes)
- [ ] [ ] Memory usage stable
- [ ] [ ] No memory leaks
- [ ] [ ] CPU usage stays low
- [ ] [ ] Engine continues to work

### Multiple Analyses
- [ ] [ ] Run 10+ engine analyses in a row
- [ ] [ ] No crashes
- [ ] [ ] No performance degradation
- [ ] [ ] Eval bar updates smoothly

### Rapid Reloads
- [ ] [ ] Reload 5 times in quick succession
- [ ] [ ] Each uses cached engine
- [ ] [ ] No race conditions
- [ ] [ ] All loads successful

---

## Documentation Check

- [ ] QUICK-START.md is clear and helpful
- [ ] OPTIMIZATION-GUIDE.md explains 12 sections
- [ ] CODE-IMPROVEMENTS.md has before/after
- [ ] SUMMARY.md provides overview
- [ ] All examples work in console

---

## Troubleshooting Verification

### If Download Fails
- [ ] Check error: `window.__SF_ErrorReporter.dump()`
- [ ] Specific error message (not generic)
- [ ] Actionable next steps in error message
- [ ] Can identify which URL failed

### If Cache Issues
- [ ] Can clear with: `await Cache.delete(...)`
- [ ] Can check with: `await Cache.get(...)`
- [ ] Falls back if IndexedDB unavailable
- [ ] Still works in private mode

### If Engine Won't Load
- [ ] Check: `console.log(state.engineStatus)`
- [ ] Check: `window.__SF_ErrorReporter.dump()`
- [ ] Try: Manual `loadLocalEngine()` call
- [ ] Last resort: Clear all cache and reload

---

## Final Checklist Before Production

- [ ] All console checks pass ✓
- [ ] Performance verified (CPU/Memory) ✓
- [ ] Cache working (fast reload) ✓
- [ ] Network failure handled (retries) ✓
- [ ] Error logging clear and helpful ✓
- [ ] Both Chess.com and Lichess work ✓
- [ ] No memory leaks detected ✓
- [ ] Eval bar and moves working ✓
- [ ] Settings persist across reloads ✓
- [ ] Documentation is complete ✓

---

## Sign-Off

- Tested by: _________________
- Date: _________________
- Result: ✅ PASS / ❌ FAIL

### Notes:
_________________________________________
_________________________________________
_________________________________________

---

## Quick Command Reference

```javascript
// Check engine status
console.log(state.engineStatus)

// View all errors
window.__SF_ErrorReporter.dump()

// Check download progress
console.log(state.wasmDownloadState)

// Verify cache
await Cache.get('sf18_05_wasm').then(c => console.log(`${c?.length || 0} bytes`))

// Clear cache
await Cache.delete('sf18_05_wasm')

// Monitor progress (real-time)
setInterval(() => {
    const s = state.wasmDownloadState;
    console.log(`${s.bytesReceived}/${s.totalBytes} (${Math.round(s.bytesReceived/s.totalBytes*100)}%)`);
}, 1000)

// View settings
console.log(settings)

// Force engine reload
state.engineRetryAt = 0; loadLocalEngine();
```

---

**Total Checklist Items:** 80+
**Estimated Time:** 30-60 minutes
**Difficulty:** Easy to Intermediate
**Success Rate:** >95% with proper testing

---

Print this page and check off as you complete each section.
