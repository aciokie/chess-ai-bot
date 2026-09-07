// Stockfish Worker Wrapper for Classic Worker (MODULARIZE=1, EXPORT_NAME=Stockfish)
// This properly initializes the Stockfish module and provides UCI interface

// Override locateFile to serve WASM from same origin
self.Module = self.Module || {};
self.Module.locateFile = function(path) {
  if (path.endsWith('.wasm')) return 'stockfish.wasm';
  return path;
};

// Configuration for classic worker
self.Module.arguments = [];
self.Module.print = console.log;
self.Module.printErr = console.error;
self.Module.noExitRuntime = true;
self.Module.noInitialRun = true;
self.Module.INITIAL_MEMORY = 128 * 1024 * 1024;
self.Module.MAXIMUM_MEMORY = 1024 * 1024 * 1024;
self.Module.ALLOW_MEMORY_GROWTH = 1;

// Import the Stockfish module (Stockfish is the EXPORT_NAME)
importScripts('stockfish.js');

var stockfish = null;
var uciCallback = null;

// Initialize Stockfish
Stockfish().then(function(instance) {
  stockfish = instance;
  self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
}).catch(function(err) {
  self.postMessage({ type: 'error', text: 'Failed to initialize Stockfish: ' + err });
});

// Handle UCI commands from main thread
self.onmessage = function(e) {
  var cmd = e.data;
  
  if (cmd.type === 'uci' && cmd.cmd) {
    if (stockfish && typeof stockfish._main === 'function') {
      // Write command to stdin via Module's FS
      // Stockfish reads from stdin, we need to use the Module's FS to write to it
      var input = cmd.cmd + '\n';
      // The Module should have stdin handling - we'll use FS.write
      if (stockfish.FS && stockfish.FS.write) {
        // Write to stdin (fd 0)
        var buf = stockfish.stringToUTF8(input);
        stockfish.FS.write(0, buf, 0, input.length, 0);
      }
    }
  } else if (cmd.type === 'init') {
    if (stockfish) {
      self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
    } else {
      self.postMessage({ type: 'error', text: 'Stockfish not initialized yet' });
    }
  }
};

// Capture stdout from Stockfish
var originalPrint = self.Module.print;
self.Module.print = function(text) {
  if (originalPrint) originalPrint(text);
  
  if (text && (text.startsWith('info ') || text.startsWith('bestmove') || 
      text.startsWith('uciok') || text.startsWith('readyok'))) {
    self.postMessage({ type: 'uci', text: text });
  }
};

var originalPrintErr = self.Module.printErr;
self.Module.printErr = function(text) {
  if (originalPrintErr) originalPrintErr(text);
  self.postMessage({ type: 'error', text: text });
};

console.log('[SF Worker] Stockfish 19 worker initialized');