// Minimal preamble.js for Stockfish classic worker build
Module = Module || {};

// locateFile override - serves WASM from same origin
Module.locateFile = function(path) {
  if (path.endsWith('.wasm')) return 'stockfish.wasm';
  return path;
};

// Configuration for classic worker
Module.arguments = [];
Module.print = console.log;
Module.printErr = console.error;
Module.noExitRuntime = true;
Module.noInitialRun = true;
Module.ENVIRONMENT = 'WEB';

// Pre-run setup
Module.preRun = Module.preRun || [];
Module.preRun.push(function() {
  // Disable filesystem
  Module.FS = Module.FS || {};
});

console.log('[SF Engine] preamble.js loaded');