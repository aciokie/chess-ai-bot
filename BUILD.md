# SF19 Classic Worker Build

This directory contains the build scripts and artifacts for Stockfish 19 compiled to WebAssembly **without EXPORT_ES6** for classic worker compatibility.

## Quick Start

### Prerequisites
- Emscripten SDK (emsdk)
- make, python3, git

### Build

```bash
./build-sf19-classic.sh
```

### Artifacts Generated
- `stockfish.js` - Main JavaScript loader
- `stockfish.wasm` - WebAssembly binary
- `stockfish.worker.js` - Worker wrapper
- `preamble.js` - Module preamble

## Configuration

The build uses these key Emscripten flags for classic worker compatibility:

| Flag | Value | Purpose |
|------|-------|---------|
| `MODULARIZE` | `1` | Encapsulate module |
| `EXPORT_NAME` | `Stockfish` | Global export name |
| `ENVIRONMENT` | `web,worker` | Target environments |
| `USE_PTHREADS` | `0` | Disable pthreads (classic worker) |
| `EXPORT_ES6` | **NOT SET** | Classic worker compatible |
| `EXPORTED_FUNCTIONS` | `["_malloc","_free","_main"]` | Exported C functions |
| `EXPORTED_RUNTIME_METHODS` | `["ccall","cwrap","stringToUTF8","UTF8ToString","HEAPU8"]` | Runtime methods |
| `INITIAL_MEMORY` | `128MB` | Initial memory |
| `MAXIMUM_MEMORY` | `1024MB` | Max memory |
| `ALLOW_MEMORY_GROWTH` | `1` | Allow memory growth |
| `FILESYSTEM` | `0` | Disable filesystem |
| `EXIT_RUNTIME` | `0` | Don't exit after main |

## Worker Wrapper

The `stockfish.worker.js` provides:
- UCI protocol over postMessage
- `Module.locateFile` override for WASM loading
- UCI output capture and forwarding

## Integration

```javascript
// In main thread
const worker = new Worker('stockfish.worker.js');
worker.onmessage = (e) => {
  if (e.data.type === 'uci') {
    console.log('UCI:', e.data.text);
  }
};

worker.postMessage({ type: 'uci', cmd: 'uci' });
worker.postMessage({ type: 'uci', cmd: 'isready' });
worker.postMessage({ type: 'uci', cmd: 'position startpos', cmd: 'go depth 20' });
```

## Hosting

Deploy the 4 files to any static hosting:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- Any CDN

Update URLs in your userscript:
```javascript
jsUrl: "https://your-domain/stockfish.js",
wasmUrl: "https://your-domain/stockfish.wasm",
```