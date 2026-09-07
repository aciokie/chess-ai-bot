/**
 * UCI interface module for Stockfish WebAssembly
 * This provides the JS-side UCI functions that call into WASM
 */

// UCI command function - sends UCI command to Stockfish
Module['uci'] = function (command) {
  const sz = lengthBytesUTF8(command) + 1;
  const utf8 = _malloc(sz);
  if (!utf8) throw new Error(`Could not allocate ${sz} bytes`);
  stringToUTF8(command, utf8, sz);
  _uci(utf8);
};

// Get recommended NNUE network
Module['getRecommendedNnue'] = (index = 0) => UTF8ToString(_getRecommendedNnue(index)) || undefined;

// Set NNUE buffer from JS
Module['setNnueBuffer'] = function (buf, index = 0) {
  if (!buf) throw new Error('buf is null');
  if (buf.byteLength <= 0) throw new Error(`${buf.byteLength} bytes?`);
  const heapBuf = _malloc(buf.byteLength);
  if (!heapBuf) throw new Error(`could not allocate ${buf.byteLength} bytes`);
  growMemViews();
  Module['HEAPU8'].set(buf, heapBuf);
  _setNnueBuffer(heapBuf, buf.byteLength, index);
};

// Print/listen hooks
Module['print'] = data => Module['listen']?.(data);
Module['printErr'] = data => Module['onError']?.(data);

// Default error handler
if (!Module['onError']) Module['onError'] = data => console.error(data);

// Default listen handler
if (!Module['listen']) Module['listen'] = data => console.log(data);

console.log('[SF Engine] initModule.js loaded - UCI interface ready');