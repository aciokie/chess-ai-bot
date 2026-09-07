// glue.cpp - C++ bindings for UCI interface
// This file is compiled into the WASM module and provides the JS-callable functions

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "uci.h"
#include "thread.h"
#include "tt.h"
#include "misc.h"
#include "nnue/nnue.h"

using namespace Stockfish;

// External C functions callable from JavaScript
extern "C" {

// UCI command interface - called from JS Module.uci()
void uci(char* command) {
    std::string cmd(command);
    UCI::push_command(cmd);
}

// Get recommended NNUE network name
const char* getRecommendedNnue(int index) {
    // Return the default network name
    static const char* netName = "nn-6877cd24400e.nnue";
    if (index == 0) return netName;
    return nullptr;
}

// Set NNUE buffer from JS (for embedded networks)
void setNnueBuffer(void* buf, int size, int index) {
    if (!buf || size <= 0) return;
    
    // This would normally load the network from the buffer
    // For now, we just acknowledge the call
    // The actual network loading happens via UCI "setoption name EvalFile"
    (void)buf;
    (void)size;
    (void)index;
}

} // extern "C"

// Force linking of this file
extern "C" void glue_dummy() {}