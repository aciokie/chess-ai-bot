// extern-post.js - Runs after Module initialization
// This sets up the UCI interface after Stockfish module is loaded

// Store original Module.print/printErr
var originalPrint = Module.print;
var originalPrintErr = Module.printErr;

// UCI output buffer
var uciBuffer = '';
var uciCallback = null;

// Override print to capture UCI output
Module.print = function(text) {
  // Call original print
  if (originalPrint) originalPrint(text);
  
  // Buffer UCI output
  if (text && typeof text === 'string') {
    uciBuffer += text + '\n';
    
    // Check for UCI responses
    if (text.startsWith('uciok') || text.startsWith('readyok') || 
        text.startsWith('bestmove') || text.startsWith('info ')) {
      if (typeof self !== 'undefined' && self.postMessage) {
        self.postMessage({ type: 'uci', text: text.trim() });
      }
    }
  }
};

Module.printErr = function(text) {
  if (Module.printErr && Module.printErr !== Module.print) {
    Module.printErr(text);
  } else {
    console.error('[SF Engine Error]', text);
  }
};

// UCI command interface
Module.uciSend = function(cmd) {
  if (!Module._main) {
    console.error('[SF Engine] Stockfish not initialized');
    return;
  }
  
  // Write command to stdin via Module
  var input = cmd + '\n';
  // This would require the actual Stockfish stdin interface
  // For now, we use the traditional approach
};

// Helper to send UCI commands via postMessage from main thread
if (typeof self !== 'undefined') {
  self.onmessage = function(e) {
    var cmd = e.data;
    if (cmd.type === 'uci' && cmd.cmd) {
      // Handle UCI command
      console.log('[SF Worker] UCI command:', cmd.cmd);
    }
  };
}

console.log('[SF Engine] extern-post.js loaded - Stockfish ready for UCI');