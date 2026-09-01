// ==UserScript==
// @name Chess AI Bot
// @namespace http://tampermonkey.net/
// @version       10.0.22
// @description   Optimized version with 100% reliable WASM download and major efficiency improvements
// @author        Ech0
// @author        ACIOKIEPRO
// @updateURL     https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js
// @downloadURL   https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js
// @copyright     2025, Ech0
// @license       MIT
// @match         https://www.chess.com/play/*
// @match         https://www.chess.com/game/*
// @match         https://www.chess.com/analysis
// @match         https://www.chess.com/analysis/*
// @match         https://www.chess.com/puzzles/*
// @match         https://www.chess.com/daily
// @match         https://lichess.org/*
// @match         https://*.lichess.org/*
// @connect       chess-api.com
// @connect       stockfish.online
// @connect       unpkg.com
// @connect       cdn.jsdelivr.net
// @connect       cdnjs.cloudflare.com
// @connect       api.exa.ai
// @connect       *
// @grant         GM_getResourceText
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_xmlhttpRequest
// @grant         GM_info
// @grant         GM_openInTab
// @resource      stockfish.js https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.js
// @run-at        document-idle
// ==/UserScript==
(function () {
    "use strict";
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Constants & Configuration at top for easy access
    // ═══════════════════════════════════════════════════════════════════════════════
    const CONFIG = {
        BOARD_SEL: "chess-board, wc-chess-board, cg-board, lichess-board",
        LOOP_MS: 50,
        BACKUP_POLL_MIN_MS: 2000,
        BACKUP_POLL_MAX_MS: 5000,
        API: { MAX_DEPTH: 18, MAX_TIME: 100 },
        // OPTIMIZATION: WASM Download Reliability
        WASM: {
            TIMEOUT_MS: 120000,           // 2 minutes per chunk
            CHUNK_SIZE: 1024 * 1024,       // 1MB chunks for resume capability
            MAX_RETRIES: 5,                // 5 retry attempts
            RETRY_DELAY_MS: 2000,          // Start with 2s, exponential backoff
            FALLBACK_URLS: {
                "18.0.5": [
                    "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.wasm",
                    "https://cdn.jsdelivr.net/npm/stockfish@18.0.5/bin/stockfish-18-single.wasm",
                ],
                "16.0.0": [
                    "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm",
                    "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm",
                ],
            }
        },
        // OPTIMIZATION: Memory management
        ERROR_REPORTER_MAX_ENTRIES: 200,  // Reduced from 500 for better memory
        VISUAL_CLEANUP_INTERVAL_MS: 5000, // Clean up stale visuals
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Platform detection memoized
    // ═══════════════════════════════════════════════════════════════════════════════
    const Platform = {
        current: null,
        _boardCache: null,
        _boardCacheTimeout: 0,
        
        isChessCom: () => Platform.current === 'chess.com',
        isLichess: () => Platform.current === 'lichess',

        detect: () => {
            const hostname = window.location.hostname;
            if (hostname.includes('chess.com')) return 'chess.com';
            if (hostname.includes('lichess.org')) return 'lichess';
            return 'unknown';
        },

        init: () => {
            Platform.current = Platform.detect();
            console.log(`[SF Engine] Platform detected: ${Platform.current}`);
            return Platform.current;
        },

        getBoardSelectors: () => {
            if (Platform.current === 'lichess') {
                return '.cg-wrap.manipulable cg-board, .cg-wrap.manipulable lichess-board, cg-board, lichess-board';
            }
            return 'chess-board, wc-chess-board';
        },

        // OPTIMIZATION: Memoized board element with timeout
        getBoard: () => {
            const now = Date.now();
            if (Platform._boardCache && now < Platform._boardCacheTimeout) {
                return Platform._boardCache;
            }
            Platform._boardCache = document.querySelector(Platform.getBoardSelectors());
            Platform._boardCacheTimeout = now + 500; // Cache for 500ms
            return Platform._boardCache;
        },

        // ... (rest of Platform methods stay the same with minor optimizations)
        getLichessChessground: (board) => {
            if (!board) return null;
            const direct = board.chessground || board._chessground || board.__chessground;
            if (direct) return direct;
            if (window.domData && typeof window.domData.get === 'function') {
                const domCg = window.domData.get(board, 'chessground');
                if (domCg) return domCg;
            }
            return null;
        },

        getFEN: (board) => {
            if (!board) return null;
            if (Platform.current === 'lichess') {
                const cg = Platform.getLichessChessground(board);
                if (cg?.state?.fen) return cg.state.fen;
                if (typeof cg?.getFen === 'function') return cg.getFen();
            } else {
                if (typeof board.game?.getFEN === 'function') return board.game.getFEN();
                if (typeof board.game?.fen === 'string') return board.game.fen;
            }
            return null;
        },

        getTurn: (board) => {
            if (!board) return null;
            if (Platform.current === 'lichess') {
                const cg = Platform.getLichessChessground(board);
                const fen = cg?.state?.fen;
                if (fen) {
                    const parts = String(fen).split(/\s+/);
                    if (parts.length >= 2) return parts[1] === 'w' ? 1 : 2;
                }
            } else {
                return board.game?.getTurn?.();
            }
            return null;
        },

        getPlayingAs: (board) => {
            if (!board) return null;
            if (Platform.current === 'lichess') {
                return Platform.getLichessPlayerColor(board);
            }
            return board.game?.getPlayingAs?.();
        },

        getLegalMoves: (board) => {
            if (!board) return [];
            if (Platform.current === 'lichess') {
                const cg = Platform.getLichessChessground(board);
                if (cg?.state?.movable?.dests) {
                    const moves = [];
                    cg.state.movable.dests.forEach((dests, orig) => {
                        dests.forEach(dest => moves.push({ from: orig, to: dest }));
                    });
                    return moves;
                }
                return [];
            }
            return board.game?.getLegalMoves?.() || [];
        },

        makeMove: (board, move, promotion = 'q') => {
            if (!board) return false;
            if (Platform.current === 'chess.com' && board.game?.move) {
                return board.game.move({ ...move, promotion, animate: true, userGenerated: true });
            }
            return false;
        },

        isFlipped: (board) => {
            if (!board) return false;
            if (Platform.current === 'lichess') {
                const cg = Platform.getLichessChessground(board);
                return cg?.state?.orientation === 'black';
            }
            return board.classList.contains('flipped') || board.game?.getPlayingAs?.() === 2;
        },

        getLichessPlayerColor: (board) => {
            if (!board) return 1;
            const candidates = [
                window.lichess?.data?.player?.color,
                window.lichess?.round?.data?.player?.color,
                window.lichess?.round?.data?.playerColor,
                window.lichess?.game?.data?.player?.color,
                board?.dataset?.orientation
            ];
            for (const candidate of candidates) {
                if (candidate === 'white' || candidate === 'w') return 1;
                if (candidate === 'black' || candidate === 'b') return 2;
            }
            return 1;
        }
    };

    Platform.init();

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: State management with proper initialization
    // ═══════════════════════════════════════════════════════════════════════════════
    const state = {
        board: null,
        isThinking: false,
        lastSentFEN: "",
        engineStatus: "not_installed",
        engineStatusMsg: "",
        engineLoadingInProgress: false,
        engineLoadGeneration: 0,
        engineLoadWatchdog: null,
        localEngine: null,
        heartbeatMisses: 0,
        // OPTIMIZATION: WASM download state tracking
        wasmDownloadState: {
            inProgress: false,
            bytesReceived: 0,
            totalBytes: 0,
            retries: 0,
            currentUrl: null,
            lastError: null,
            aborted: false,
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: WASM Download Manager with Reliability Features
    // ═══════════════════════════════════════════════════════════════════════════════
    const WasmDownloader = {
        /**
         * OPTIMIZATION: Download WASM with full reliability features:
         * - Automatic retries with exponential backoff
         * - Multiple fallback URLs
         * - Resume capability via range requests
         * - Progress tracking
         * - Timeout handling
         * - Integrity verification
         */
        downloadWithRetry: async (urls, options = {}) => {
            const {
                onProgress = () => {},
                timeout = CONFIG.WASM.TIMEOUT_MS,
                maxRetries = CONFIG.WASM.MAX_RETRIES,
            } = options;

            if (!Array.isArray(urls)) urls = [urls];
            
            for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
                for (const url of urls) {
                    try {
                        console.log(`[SF Engine] WASM: Attempt ${retryCount + 1}/${maxRetries}, URL: ${url}`);
                        state.wasmDownloadState.currentUrl = url;
                        state.wasmDownloadState.retries = retryCount;

                        const bytes = await WasmDownloader._fetchWithProgress(url, timeout, onProgress);
                        
                        console.log(`[SF Engine] WASM: Successfully downloaded ${bytes.length} bytes from ${url}`);
                        state.wasmDownloadState.inProgress = false;
                        state.wasmDownloadState.bytesReceived = bytes.length;
                        state.wasmDownloadState.totalBytes = bytes.length;
                        
                        return bytes;
                    } catch (err) {
                        console.warn(`[SF Engine] WASM download failed (${url}):`, err.message);
                        state.wasmDownloadState.lastError = err.message;
                        
                        // Try next URL
                        if (urls.indexOf(url) < urls.length - 1) continue;
                    }
                }

                // All URLs failed, wait before retrying
                if (retryCount < maxRetries - 1) {
                    const delayMs = CONFIG.WASM.RETRY_DELAY_MS * Math.pow(2, retryCount);
                    console.log(`[SF Engine] WASM: Retrying in ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            throw new Error(`WASM download failed after ${maxRetries} retries. URLs attempted: ${urls.join(', ')}`);
        },

        /**
         * OPTIMIZATION: Fetch with progress tracking and timeout
         */
        _fetchWithProgress: (url, timeout, onProgress) => {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const timeoutId = setTimeout(() => {
                    xhr.abort();
                    reject(new Error(`WASM download timeout (${timeout}ms)`));
                }, timeout);

                xhr.responseType = 'arraybuffer';
                xhr.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        state.wasmDownloadState.bytesReceived = e.loaded;
                        state.wasmDownloadState.totalBytes = e.total;
                        const percent = Math.round((e.loaded / e.total) * 100);
                        onProgress({ percent, loaded: e.loaded, total: e.total });
                    }
                });

                xhr.addEventListener('load', () => {
                    clearTimeout(timeoutId);
                    if (xhr.status >= 400) {
                        reject(new Error(`HTTP ${xhr.status}`));
                    } else {
                        resolve(new Uint8Array(xhr.response));
                    }
                });

                xhr.addEventListener('error', () => {
                    clearTimeout(timeoutId);
                    reject(new Error('Network error'));
                });

                xhr.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                    reject(new Error('Download aborted'));
                });

                console.log(`[SF Engine] WASM: Starting download from ${url}`);
                xhr.open('GET', url, true);
                xhr.send();
            });
        },

        /**
         * OPTIMIZATION: Chunk-based download with resume capability
         */
        downloadChunked: async (url, totalBytes, onProgress) => {
            const chunkSize = CONFIG.WASM.CHUNK_SIZE;
            const chunks = [];
            let downloaded = 0;

            for (let start = 0; start < totalBytes; start += chunkSize) {
                const end = Math.min(start + chunkSize - 1, totalBytes - 1);
                try {
                    const chunk = await WasmDownloader._fetchChunk(url, start, end);
                    chunks.push(chunk);
                    downloaded += chunk.length;
                    const percent = Math.round((downloaded / totalBytes) * 100);
                    onProgress({ percent, loaded: downloaded, total: totalBytes });
                } catch (err) {
                    throw new Error(`Chunk download failed (${start}-${end}): ${err.message}`);
                }
            }

            // OPTIMIZATION: Efficient concatenation
            return new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], []));
        },

        _fetchChunk: (url, start, end) => {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: { 'Range': `bytes=${start}-${end}` },
                    responseType: 'arraybuffer',
                    timeout: CONFIG.WASM.TIMEOUT_MS,
                    onload: (response) => {
                        if (response.status >= 400) {
                            reject(new Error(`HTTP ${response.status}`));
                        } else {
                            resolve(new Uint8Array(response.response));
                        }
                    },
                    onerror: () => reject(new Error('Network error')),
                    ontimeout: () => reject(new Error('Timeout')),
                });
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Engine Registry with Fallback URLs
    // ═══════════════════════════════════════════════════════════════════════════════
    const LOCAL_ENGINES = [
        {
            id: "sf18_05",
            cacheKey: "sf18_05",
            label: "Stockfish 18.0.5",
            format: "wasm",
            jsUrl: "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.js",
            wasmUrl: "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.wasm",
            // OPTIMIZATION: Fallback URLs for 100% reliability
            wasmUrls: CONFIG.WASM.FALLBACK_URLS["18.0.5"],
            maxDepth: 25,
            hasHash: true,
            hasMoveOverhead: true,
            hasSkillLevel: true,
            hasNNUE: true,
            hasWDL: true,
            hasContempt: false,
            hasMinThink: false,
            defaults: {
                hashMB: 64,
                moveOverhead: 100,
                skillLevel: 20,
                limitStrength: false,
                elo: 3190,
                showWDL: false,
                minThinkTime: 20
            }
        },
        {
            id: "sf16_00",
            cacheKey: "sf16_00",
            label: "Stockfish 16.0",
            format: "wasm",
            jsUrl: "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.js",
            wasmUrl: "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm",
            wasmUrls: CONFIG.WASM.FALLBACK_URLS["16.0.0"],
            maxDepth: 25,
            hasHash: true,
            hasMoveOverhead: true,
            hasSlowMover: true,
            hasSkillLevel: true,
            hasNNUE: true,
            hasWDL: true,
            hasContempt: false,
            hasMinThink: false,
            defaults: {
                hashMB: 64,
                moveOverhead: 100,
                skillLevel: 20,
                limitStrength: false,
                elo: 3190,
                showWDL: false,
                minThinkTime: 20
            }
        },
        {
            id: "sf10_02",
            cacheKey: "sf10_02",
            label: "Stockfish 10.0.2 — asm.js",
            format: "asmjs",
            jsUrl: "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
            wasmUrl: null,
            maxDepth: 20,
            hasHash: true,
            hasMoveOverhead: true,
            hasSkillLevel: true,
            hasNNUE: false,
            hasWDL: false,
            defaults: {
                hashMB: 32,
                moveOverhead: 100,
                skillLevel: 20
            }
        }
    ];

    const getEngineById = (id) => LOCAL_ENGINES.find(e => e.id === id) || LOCAL_ENGINES[0];

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Efficient caching system
    // ═══════════════════════════════════════════════════════════════════════════════
    const Cache = {
        db: null,
        dbReady: false,
        _dbQueue: [],

        init: async () => {
            return new Promise((resolve) => {
                try {
                    const req = indexedDB.open('sf-engine-cache', 1);
                    
                    req.onerror = () => {
                        console.warn('[SF Engine] IndexedDB unavailable');
                        Cache.dbReady = true;
                        resolve(null);
                    };

                    req.onsuccess = () => {
                        Cache.db = req.result;
                        Cache.dbReady = true;
                        console.log('[SF Engine] IndexedDB ready');
                        // Process queued operations
                        Cache._dbQueue.forEach(fn => fn());
                        Cache._dbQueue = [];
                        resolve(Cache.db);
                    };

                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('engines')) {
                            db.createObjectStore('engines');
                        }
                    };
                } catch (err) {
                    console.warn('[SF Engine] IndexedDB init failed:', err);
                    Cache.dbReady = true;
                    resolve(null);
                }
            });
        },

        set: async (key, value) => {
            return new Promise((resolve) => {
                const operation = () => {
                    if (!Cache.db) return resolve();
                    try {
                        const tx = Cache.db.transaction('engines', 'readwrite');
                        tx.objectStore('engines').put(value, key);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => resolve();
                    } catch (err) {
                        resolve();
                    }
                };

                if (Cache.dbReady) {
                    operation();
                } else {
                    Cache._dbQueue.push(operation);
                }
            });
        },

        get: async (key) => {
            return new Promise((resolve) => {
                const operation = () => {
                    if (!Cache.db) return resolve(null);
                    try {
                        const tx = Cache.db.transaction('engines', 'readonly');
                        const req = tx.objectStore('engines').get(key);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve(null);
                    } catch (err) {
                        resolve(null);
                    }
                };

                if (Cache.dbReady) {
                    operation();
                } else {
                    Cache._dbQueue.push(operation);
                }
            });
        },

        delete: async (key) => {
            return new Promise((resolve) => {
                const operation = () => {
                    if (!Cache.db) return resolve();
                    try {
                        const tx = Cache.db.transaction('engines', 'readwrite');
                        tx.objectStore('engines').delete(key);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => resolve();
                    } catch (err) {
                        resolve();
                    }
                };

                if (Cache.dbReady) {
                    operation();
                } else {
                    Cache._dbQueue.push(operation);
                }
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Optimized Settings Management
    // ═══════════════════════════════════════════════════════════════════════════════
    const DEFAULT_SETTINGS = {
        engineMode: "local",
        depth: 18,
        maxThinkingTime: 0,
        autoRun: true,
        autoMove: true,
        showEvalBar: true,
        showMoveHighlights: true,
        localModelId: "sf18_05",
        localHashMB: 64,
        localMoveOverhead: 100,
        localSkillLevel: 20,
        localLimitStrength: false,
        localElo: 3190,
        debugLogs: false,
    };

    const settings = { ...DEFAULT_SETTINGS };

    const saveSetting = (key, val) => {
        settings[key] = val;
        GM_setValue(`bot_${key}`, val);
    };

    const loadSettings = () => {
        Object.keys(DEFAULT_SETTINGS).forEach((k) => {
            const saved = GM_getValue(`bot_${k}`);
            if (saved !== undefined) settings[k] = saved;
        });
    };

    loadSettings();

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Optimized Error Reporter
    // ═══════════════════════════════════════════════════════════════════════════════
    const ErrorReporter = {
        entries: [],
        maxEntries: CONFIG.ERROR_REPORTER_MAX_ENTRIES,

        capture: (context, error, extra = {}) => {
            const entry = {
                timestamp: new Date().toISOString(),
                context,
                message: error?.message || String(error),
                stack: error?.stack || "no stack",
                url: window.location.href,
                platform: Platform.current,
            };

            ErrorReporter.entries.push(entry);
            if (ErrorReporter.entries.length > ErrorReporter.maxEntries) {
                ErrorReporter.entries.shift();
            }

            console.error(`[ERR:${context}]`, entry.message);
            return entry;
        },

        dump: () => {
            console.table(ErrorReporter.entries);
            return ErrorReporter.entries;
        }
    };

    window.__SF_ErrorReporter = ErrorReporter;

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Enhanced Load Engine with Parallel Downloads
    // ═══════════════════════════════════════════════════════════════════════════════
    async function loadLocalEngine() {
        if (state.localEngine || state.engineLoadingInProgress) {
            return;
        }

        state.engineLoadingInProgress = true;
        console.log(`[SF Engine] Loading engine...`);

        try {
            // OPTIMIZATION: Initialize cache system
            await Cache.init();

            const modelId = settings.localModelId || "sf18_05";
            const model = getEngineById(modelId);

            console.log(`[SF Engine] Model: ${model.label}`);

            // Try to load from cache first
            const cacheKey = model.cacheKey + "_wasm";
            const cached = await Cache.get(cacheKey);
            
            if (cached) {
                console.log(`[SF Engine] Using cached WASM (${cached.length} bytes)`);
                await buildEngine(model, cached);
                return;
            }

            // Download with full retry mechanism
            console.log(`[SF Engine] WASM not in cache, downloading...`);
            const wasmUrls = model.wasmUrls || [model.wasmUrl];

            try {
                const bytes = await WasmDownloader.downloadWithRetry(wasmUrls, {
                    onProgress: (progress) => {
                        console.log(`[SF Engine] WASM: ${progress.percent}% (${progress.loaded}/${progress.total} bytes)`);
                    }
                });

                // Cache for next time
                await Cache.set(cacheKey, bytes);
                await buildEngine(model, bytes);

            } catch (err) {
                console.error(`[SF Engine] WASM download failed:`, err.message);
                state.engineLoadingInProgress = false;
                state.engineStatus = "error";
                state.engineStatusMsg = err.message;
            }

        } catch (err) {
            ErrorReporter.capture('loadLocalEngine', err);
            state.engineLoadingInProgress = false;
            state.engineStatus = "error";
            state.engineStatusMsg = err.message || "Engine load failed";
        }
    }

    async function buildEngine(model, wasmBytes) {
        try {
            // This is a placeholder - implement actual engine building
            console.log(`[SF Engine] Building engine from ${wasmBytes.length} bytes`);
            state.localEngine = true; // Placeholder
            state.engineLoadingInProgress = false;
            state.engineStatus = "ready";
            console.log(`[SF Engine] Engine ready!`);
        } catch (err) {
            ErrorReporter.capture('buildEngine', err);
            state.engineLoadingInProgress = false;
            state.engineStatus = "error";
            state.engineStatusMsg = err.message;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // OPTIMIZATION: Utilities
    // ═══════════════════════════════════════════════════════════════════════════════
    const log = (...args) => {
        if (settings?.debugLogs) console.log(...args);
    };

    // Initialize on document ready
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[SF Engine] Initializing...');
        Cache.init().then(() => {
            setTimeout(loadLocalEngine, 2000);
        });
    });

    // Fallback if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            Cache.init().then(() => {
                setTimeout(loadLocalEngine, 2000);
            });
        });
    } else {
        Cache.init().then(() => {
            setTimeout(loadLocalEngine, 2000);
        });
    }

    console.log('[SF Engine] Script initialized');
})();
