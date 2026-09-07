// extern-pre.js - Runs before Module initialization
// This sets up the environment before Stockfish module loads

// Ensure Module exists
if (typeof Module === 'undefined') {
  Module = {};
}

// Override locateFile before Module is used
Module.locateFile = function(path) {
  if (path.endsWith('.wasm')) return 'stockfish.wasm';
  return path;
};

// Classic worker configuration
Module.arguments = [];
Module.print = console.log;
Module.printErr = console.error;
Module.noExitRuntime = true;
Module.noInitialRun = true;

// Memory configuration
Module.INITIAL_MEMORY = 128 * 1024 * 1024;  // 128MB
Module.MAXIMUM_MEMORY = 1024 * 1024 * 1024; // 1GB
Module.ALLOW_MEMORY_GROWTH = 1;

// Disable filesystem
Module.FS = Module.FS || {};
Module.FS.createFolder = function() {};
Module.FS.mkdir = function() {};
Module.FS.lookupPath = function() { return { node: { mode: 16877 } }; };

// Pre-run setup
Module.preRun = Module.preRun || [];
Module.preRun.push(function() {
  // Disable Node.js specific features
  if (typeof process !== 'undefined') {
    process.browser = true;
  }
});

console.log('[SF Engine] extern-pre.js loaded');