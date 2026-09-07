// Stockfish Worker Wrapper for Classic Worker
// This wraps the Stockfish module and provides UCI interface

self.Module = self.Module || {};

// Override locateFile to serve WASM from same origin
self.Module.locateFile = function(path) {
  if (path.endsWith('.wasm')) return 'stockfish.wasm';
  return path;
};

self.Module.arguments = [];
self.Module.print = console.log;
self.Module.printErr = console.error;
self.Module.noExitRuntime = true;
self.Module.noInitialRun = true;

// Import the Stockfish module
importScripts('stockfish.js');

// Stockfish instance
var stockfish = null;
var uciCallback = null;

// Initialize Stockfish
Module().then(function(instance) {
  stockfish = instance;
  self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
});

// Handle UCI commands from main thread
self.onmessage = function(e) {
  var cmd = e.data;
  
  if (cmd.type === 'uci') {
    // Send UCI command to Stockfish
    if (stockfish && stockfish._main) {
      // Write command to stdin
      var input = cmd.cmd + '\n';
      var buf = Module.stringToUTF8(input);
      // This would need the actual Stockfish UCI interface
    }
  } else if (cmd.type === 'init') {
    // Initialize request
    self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
  }
};

// Capture stdout from Stockfish
var originalPrint = Module.print;
Module.print = function(text) {
  originalPrint(text);
  // Forward UCI output to main thread
  if (text && (text.startsWith('info ') || text.startsWith('bestmove') || text.startsWith('uciok') || text.startsWith('readyok'))) {
    self.postMessage({ type: 'uci', text: text });
  }
};

var originalPrintErr = Module.printErr;
Module.printErr = function(text) {
  originalPrintErr(text);
  self.postMessage({ type: 'error', text: text });
};

console.log('[SF Worker] Stockfish worker initialized');