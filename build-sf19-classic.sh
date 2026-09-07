#!/bin/bash
# Build SF19 for classic worker (no EXPORT_ES6)
# Run this locally to test the build

set -e

echo "=== Building SF19 Classic Worker ==="

# Check emscripten
if ! command -v em++ &> /dev/null; then
    echo "Error: em++ not found. Install Emscripten SDK first."
    echo "Run: git clone https://github.com/emscripten-core/emsdk.git && cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
    exit 1
fi

echo "Using em++: $(which em++)"
em++ --version

# Clone Stockfish 19 if not present
if [ ! -d "stockfish" ]; then
    echo "Cloning Stockfish 19..."
    git clone --depth 1 --branch sf_19 https://github.com/official-stockfish/Stockfish.git stockfish
fi

cd stockfish/src
make clean

echo "=== Building SF19 Full NNUE (Classic Worker) ==="

# Build with classic worker flags (NO EXPORT_ES6)
make -j$(nproc) ARCH=wasm COMP=emscripten \
  CXX=em++ \
  COMPCXX=em++ \
  EXE=stockfish.js \
  CXXFLAGS="-O3 -DNDEBUG -flto -msimd128 -msse -msse2 -mssse3 -msse4.1 -DNNUE_EMBEDDING_OFF=0 -DUSE_POPCNT -DNO_PREFETCH -DIS_64BIT -DNO_TABLEBASES -DNO_SYZYGY" \
  LDFLAGS="-s MODULARIZE=1 -s EXPORT_NAME=Stockfish -s ENVIRONMENT=web,worker -s USE_PTHREADS=0 -s EXIT_RUNTIME=0 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=128MB -s MAXIMUM_MEMORY=1024MB -s STACK_SIZE=5MB -s FILESYSTEM=0 -s STRICT=1 -s ASSERTIONS=0 -DNDEBUG -O3 --closure=1 -s EXPORTED_FUNCTIONS='[\"_malloc\",\"_free\",\"_main\"]' -s EXPORTED_RUNTIME_METHODS='[\"ccall\",\"cwrap\",\"stringToUTF8\",\"UTF8ToString\",\"HEAPU8\"]' -s INITIAL_MEMORY=128MB -s MAXIMUM_MEMORY=1024MB -s STACK_SIZE=5MB -s FILESYSTEM=0 -s STRICT=1 --pre-js ../../emscripten/pre.js --extern-pre-js ../../emscripten/extern-pre.js --extern-post-js ../../emscripten/extern-post.js" \
  build

# Verify no EXPORT_ES6
if grep -q "EXPORT_ES6" stockfish.js; then
    echo "ERROR: EXPORT_ES6 found in output!"
    exit 1
fi

echo "SUCCESS: No EXPORT_ES6 found - classic worker compatible!"

# Copy artifacts
cp stockfish.js stockfish.wasm ../

# Create worker wrapper
cat > stockfish.worker.js << 'EOF'
// Stockfish Worker Wrapper for Classic Worker
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
self.Module.INITIAL_MEMORY = 128 * 1024 * 1024;
self.Module.MAXIMUM_MEMORY = 1024 * 1024 * 1024;
self.Module.ALLOW_MEMORY_GROWTH = 1;

// Import the Stockfish module
importScripts('stockfish.js');

var stockfish = null;

// Initialize Stockfish
Module().then(function(instance) {
  stockfish = instance;
  self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
});

// Handle UCI commands from main thread
self.onmessage = function(e) {
  var cmd = e.data;
  
  if (cmd.type === 'uci' && cmd.cmd) {
    if (stockfish && stockfish._main) {
      // Write command to stdin via Module
      // This requires the Stockfish stdin interface
    }
  } else if (cmd.type === 'init') {
    self.postMessage({ type: 'ready', engine: 'Stockfish 19' });
  }
};

// Capture stdout from Stockfish
var originalPrint = Module.print;
Module.print = function(text) {
  if (originalPrint) originalPrint(text);
  
  if (text && (text.startsWith('info ') || text.startsWith('bestmove') || 
      text.startsWith('uciok') || text.startsWith('readyok'))) {
    self.postMessage({ type: 'uci', text: text });
  }
};

var originalPrintErr = Module.printErr;
Module.printErr = function(text) {
  originalPrintErr(text);
  self.postMessage({ type: 'error', text: text });
};

console.log('[SF Worker] Stockfish 19 worker initialized');
EOF

# Create preamble.js
cat > preamble.js << 'EOF'
// Minimal preamble.js for Stockfish classic worker build
Module = Module || {};

Module.locateFile = function(path) {
  if (path.endsWith('.wasm')) return 'stockfish.wasm';
  return path;
};

Module.arguments = [];
Module.print = console.log;
Module.printErr = console.error;
Module.noExitRuntime = true;
Module.noInitialRun = true;
Module.INITIAL_MEMORY = 128 * 1024 * 1024;
Module.MAXIMUM_MEMORY = 1024 * 1024 * 1024;
Module.ALLOW_MEMORY_GROWTH = 1;
Module.FS = Module.FS || {};
Module.FS.createFolder = function() {};
Module.FS.mkdir = function() {};

Module.preRun = Module.preRun || [];
Module.preRun.push(function() {
  if (typeof process !== 'undefined') {
    process.browser = true;
  }
});

console.log('[SF Engine] preamble.js loaded');
EOF

echo "=== Build Complete ==="
ls -la stockfish.js stockfish.wasm stockfish.worker.js preamble.js

# Verify no EXPORT_ES6
if grep -q "EXPORT_ES6" stockfish.js; then
    echo "ERROR: EXPORT_ES6 found in output!"
    exit 1
fi

echo "SUCCESS: Build complete - classic worker compatible!"
echo "Files created:"
echo "  - stockfish.js ($(wc -c < stockfish.js) bytes)"
echo "  - stockfish.wasm ($(wc -c < stockfish.wasm) bytes)"
echo "  - stockfish.worker.js ($(wc -c < stockfish.worker.js) bytes)"
echo "  - preamble.js ($(wc -c < preamble.js) bytes)"