// ==UserScript==
// @name         Chess AI Bot
// @namespace    https://github.com/aciokie/chess-ai-bot
// @version      11.1.1
// @description  Chess.com AI assistant with Stockfish engine, auto-play, analysis, eval bar, and opening book
// @author       aciokie
// @match        *://*.chess.com/*
// @match        *://chess.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        GM_info
// @grant        GM_openInTab
// @connect      unpkg.com
// @connect      cdn.jsdelivr.net
// @connect      cdn.statically.io
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js
// @downloadURL  https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/chess-ai-bot.user.js
// @run-at       document-start
// ==/UserScript==

/* eslint-env es6 */
/* jshint esversion: 6, browser: true, devel: true, asi: true, laxcomma: true, laxbreak: true */

(function () {
    'use strict';

    // ==========================================
    // CONSTANTS & CONFIGURATION
    // ==========================================

    const CONFIG = {
        // Engine settings
        ENGINE_DEPTH: 20,
        ENGINE_MOVETIME: 100,
        ENGINE_THREADS: 1,
        ENGINE_HASH: 128,
        ENGINE_SKILL: 20,
        ENGINE_MULTIPV: 3,

        // Auto-play settings
        AUTO_PLAY_DELAY_MIN: 500,
        AUTO_PLAY_DELAY_MAX: 2000,
        AUTO_PLAY_HUMANIZE: true,

        // Analysis settings
        ANALYSIS_DEPTH: 18,
        ANALYSIS_MOVETIME: 500,

        // Opening book
        USE_OPENING_BOOK: true,
        OPENING_BOOK_DEPTH: 20,

        // Eval bar
        SHOW_EVAL_BAR: true,
        EVAL_BAR_WIDTH: 14,
        EVAL_BAR_HEIGHT: 300,

        // Board detection
        BOARD_SELECTORS: [
            'wc-chess-board',
            'chess-board',
            '#board-layout-chessboard',
            '.board',
            '[class*="chess-board"]',
            '[class*="board-layout"]'
        ],

        // Stockfish WASM - multiple CDN mirrors for reliability
        STOCKFISH_JS_URLS: [
            'https://unpkg.com/stockfish@16.1.0/stockfish.nn.js',
            'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/stockfish.nn.js',
            'https://cdn.statically.io/npm/stockfish@16.1.0/stockfish.nn.js'
        ],
        STOCKFISH_WASM_URLS: [
            'https://unpkg.com/stockfish@16.1.0/stockfish.nn.wasm',
            'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/stockfish.nn.wasm',
            'https://cdn.statically.io/npm/stockfish@16.1.0/stockfish.nn.wasm'
        ],

        // Local engine (self-hosted fallback)
        LOCAL_ENGINE_JS: 'https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/engine/stockfish.nn.js',
        LOCAL_ENGINE_WASM: 'https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/engine/stockfish.nn.wasm',

        // Opening book data (embedded)
        OPENING_BOOK_URL: 'https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/data/opening-book.json',

        // Tracking (optional, anonymous)
        TRACK_URL: 'https://raw.githubusercontent.com/aciokie/chess-ai-bot/main/track.txt',

        // UI
        SETTINGS_PANEL_KEY: 'chess_ai_bot_settings_open',
        DEBUG: false
    };

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[Chess AI Bot]', ...args);
    }

    function logError(...args) {
        console.error('[Chess AI Bot Error]', ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function humanizeDelay(baseDelay) {
        if (!CONFIG.AUTO_PLAY_HUMANIZE) return baseDelay;
        const variation = baseDelay * 0.3;
        return baseDelay + randomDelay(-variation, variation);
    }

    // ==========================================
    // SETTINGS MANAGEMENT
    // ==========================================

    const Settings = {
        defaults: {
            enabled: false,
            autoPlay: false,
            autoPlayAsWhite: true,
            autoPlayAsBlack: true,
            showEvalBar: true,
            showBestMove: true,
            showEvaluation: true,
            engineDepth: CONFIG.ENGINE_DEPTH,
            engineMovetime: CONFIG.ENGINE_MOVETIME,
            analysisDepth: CONFIG.ANALYSIS_DEPTH,
            analysisMovetime: CONFIG.ANALYSIS_MOVETIME,
            useOpeningBook: true,
            skillLevel: 20,
            multiPV: 3,
            autoAnalyze: true,
            soundEnabled: true,
            showThinking: true,
            onlyMyTurn: true,
            minTimeLeft: 10,
            maxTimePerMove: 30,
            preferredEngine: 'auto', // 'auto', 'wasm', 'local'
            boardOrientation: 'auto',
            evalBarSide: 'left',
            bulletMode: false,
            bulletWorkers: 1,
            bulletMovetime: 50,
            bulletHash: 256
        },

        get(key) {
            try {
                const stored = GM_getValue(key);
                return stored !== undefined ? stored : this.defaults[key];
            } catch (e) {
                return this.defaults[key];
            }
        },

        set(key, value) {
            try {
                GM_setValue(key, value);
                return true;
            } catch (e) {
                logError('Failed to save setting:', key, e);
                return false;
            }
        },

        getAll() {
            const result = {};
            for (const key of Object.keys(this.defaults)) {
                result[key] = this.get(key);
            }
            return result;
        },

        reset() {
            for (const key of Object.keys(this.defaults)) {
                this.set(key, this.defaults[key]);
            }
        },

        loadAll() {
            return this.getAll();
        }
    };

    // ==========================================
    // BOARD MANAGER - Chess.com only
    // ==========================================

    const BoardManager = {
        board: null,
        boardElement: null,
        observer: null,
        lastFen: '',
        lastTurn: 'w',
        isFlipped: false,
        gameOver: false,
        moveHistory: [],
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',

        async init() {
            log('Initializing BoardManager for Chess.com');
            await this.findBoard();
            if (this.boardElement) {
                this.setupObserver();
                this.extractInitialState();
            }
        },

        async findBoard() {
            // Try multiple selectors for Chess.com
            for (const selector of CONFIG.BOARD_SELECTORS) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    if (this.isValidBoard(el)) {
                        this.boardElement = el;
                        log('Found board:', selector, el);
                        return true;
                    }
                }
            }

            // Fallback: wait for board to appear
            return new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    for (const selector of CONFIG.BOARD_SELECTORS) {
                        const elements = document.querySelectorAll(selector);
                        for (const el of elements) {
                            if (this.isValidBoard(el)) {
                                clearInterval(checkInterval);
                                this.boardElement = el;
                                log('Found board (delayed):', selector, el);
                                resolve(true);
                                return;
                            }
                        }
                    }
                }, 500);

                // Timeout after 30 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    logError('Board not found after 30s');
                    resolve(false);
                }, 30000);
            });
        },

        isValidBoard(el) {
            if (!el) return false;
            // Check for Chess.com board indicators
            return el.tagName === 'WC-CHESS-BOARD' ||
                el.tagName === 'CHESS-BOARD' ||
                el.classList.contains('board') ||
                el.id?.includes('board') ||
                el.querySelector('.piece, [class*="piece"], [class*="square"]') !== null;
        },

        setupObserver() {
            if (!this.boardElement) return;

            // Observe board for moves
            this.observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' || mutation.type === 'attributes') {
                        this.onBoardChange();
                    }
                }
            });

            this.observer.observe(this.boardElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'data-fen', 'fen']
            });

            log('Board observer attached');
        },

        onBoardChange() {
            // Debounce rapid changes - faster in bullet mode
            clearTimeout(this.changeDebounce);
            const debounceMs = (typeof BulletMode !== 'undefined' && BulletMode.active) ? 10 : 50;
            this.changeDebounce = setTimeout(() => {
                this.updateState();
            }, debounceMs);
        },

        extractInitialState() {
            this.lastFen = this.getFEN();
            this.lastTurn = this.getTurn();
            this.isFlipped = this.getIsFlipped();
            this.initialFen = this.lastFen;
            log('Initial state:', this.lastFen, this.lastTurn, this.isFlipped);
        },

        updateState() {
            const newFen = this.getFEN();
            const newTurn = this.getTurn();
            const newFlipped = this.getIsFlipped();

            if (newFen && newFen !== this.lastFen) {
                log('FEN changed:', this.lastFen, '->', newFen);
                this.lastFen = newFen;
                this.lastTurn = newTurn;
                this.onPositionChange();
            }

            if (newFlipped !== this.isFlipped) {
                this.isFlipped = newFlipped;
                log('Board flipped:', newFlipped);
            }
        },

        onPositionChange() {
            // Notify engine/analysis of position change
            if (typeof Engine !== 'undefined' && Engine.isReady()) {
                Engine.setPosition(this.lastFen);
            }
            if (typeof Analysis !== 'undefined') {
                Analysis.onPositionChange(this.lastFen);
            }
        },

        getFEN() {
            if (!this.boardElement) return null;

            // Try multiple methods to get FEN
            // 1. wc-chess-board / chess-board component
            if (this.boardElement.tagName === 'WC-CHESS-BOARD' ||
                this.boardElement.tagName === 'CHESS-BOARD') {
                try {
                    if (this.boardElement.game && this.boardElement.game.fen) {
                        return this.boardElement.game.fen();
                    }
                    if (this.boardElement._game && this.boardElement._game.fen) {
                        return this.boardElement._game.fen();
                    }
                } catch (e) {}
            }

            // 2. data-fen attribute
            const fenAttr = this.boardElement.getAttribute('data-fen') ||
                this.boardElement.getAttribute('fen');
            if (fenAttr) return fenAttr;

            // 3. From board state (pieces on squares)
            return this.reconstructFEN();
        },

        reconstructFEN() {
            // Reconstruct FEN from board DOM
            try {
                const squares = this.boardElement.querySelectorAll('[class*="square-"]');
                if (squares.length === 0) return null;

                const board = Array(64).fill('');
                const pieceMap = {
                    'wk': 'K', 'wq': 'Q', 'wr': 'R', 'wb': 'B', 'wn': 'N', 'wp': 'P',
                    'bk': 'k', 'bq': 'q', 'br': 'r', 'bb': 'b', 'bn': 'n', 'bp': 'p'
                };

                squares.forEach(sq => {
                    const className = sq.className;
                    const match = className.match(/square-(\d+)/);
                    if (match) {
                        const idx = parseInt(match[1]) - 1;
                        const piece = sq.querySelector('[class*="piece-"]');
                        if (piece) {
                            const pieceClass = piece.className;
                            const pieceMatch = pieceClass.match(/piece-(\w+)/);
                            if (pieceMatch && pieceMap[pieceMatch[1]]) {
                                board[idx] = pieceMap[pieceMatch[1]];
                            }
                        }
                    }
                });

                // Convert to FEN
                let fen = '';
                let empty = 0;
                for (let i = 0; i < 64; i++) {
                    if (board[i]) {
                        if (empty > 0) { fen += empty; empty = 0; }
                        fen += board[i];
                    } else {
                        empty++;
                    }
                    if ((i + 1) % 8 === 0) {
                        if (empty > 0) { fen += empty; empty = 0; }
                        if (i < 63) fen += '/';
                    }
                }

                // Add turn, castling, en passant, move counters
                fen += ' ' + this.getTurn();
                fen += ' KQkq - 0 1'; // Simplified - would need full game state

                return fen;
            } catch (e) {
                logError('FEN reconstruction failed:', e);
                return null;
            }
        },

        getTurn() {
            if (!this.boardElement) return 'w';

            // Try to get from board component
            if (this.boardElement.tagName === 'WC-CHESS-BOARD' ||
                this.boardElement.tagName === 'CHESS-BOARD') {
                try {
                    if (this.boardElement.game && this.boardElement.game.turn) {
                        return this.boardElement.game.turn();
                    }
                    if (this.boardElement._game && this.boardElement._game.turn) {
                        return this.boardElement._game.turn();
                    }
                } catch (e) {}
            }

            // Try from FEN
            const fen = this.getFEN();
            if (fen) return fen.split(' ')[1] || 'w';

            // Check for turn indicator in UI
            const turnEl = document.querySelector('[class*="turn"], [class*="move"]');
            if (turnEl) {
                const text = turnEl.textContent.toLowerCase();
                if (text.includes('black')) return 'b';
            }

            return 'w';
        },

        getIsFlipped() {
            if (!this.boardElement) return false;

            // Check board orientation
            if (this.boardElement.tagName === 'WC-CHESS-BOARD' ||
                this.boardElement.tagName === 'CHESS-BOARD') {
                try {
                    if (this.boardElement.orientation) return this.boardElement.orientation === 'black';
                    if (this.boardElement._orientation) return this.boardElement._orientation === 'black';
                } catch (e) {}
            }

            // Check for flipped class
            return this.boardElement.classList.contains('flipped') ||
                this.boardElement.classList.contains('orientation-black');
        },

        getLegalMoves() {
            // Get legal moves from board component
            if (this.boardElement && (this.boardElement.tagName === 'WC-CHESS-BOARD' ||
                this.boardElement.tagName === 'CHESS-BOARD')) {
                try {
                    if (this.boardElement.game && this.boardElement.game.moves) {
                        return this.boardElement.game.moves({ verbose: true });
                    }
                    if (this.boardElement._game && this.boardElement._game.moves) {
                        return this.boardElement._game.moves({ verbose: true });
                    }
                } catch (e) {}
            }
            return [];
        },

        makeMove(move) {
            if (!this.boardElement) return false;

            // Try to make move via board component
            if (this.boardElement.tagName === 'WC-CHESS-BOARD' ||
                this.boardElement.tagName === 'CHESS-BOARD') {
                try {
                    if (this.boardElement.game && this.boardElement.game.move) {
                        return this.boardElement.game.move(move);
                    }
                    if (this.boardElement._game && this.boardElement._game.move) {
                        return this.boardElement._game.move(move);
                    }
                } catch (e) {
                    logError('Make move failed:', e);
                }
            }

            // Fallback: simulate click on squares
            return this.simulateMove(move);
        },

        simulateMove(move) {
            // Simulate clicking from and to squares
            try {
                const fromSquare = this.boardElement.querySelector(`[class*="square-${move.from}"]`);
                const toSquare = this.boardElement.querySelector(`[class*="square-${move.to}"]`);

                if (fromSquare && toSquare) {
                    fromSquare.click();
                    // Bullet mode: instant click-click. Normal: 50ms delay
                    if (typeof BulletMode !== 'undefined' && BulletMode.active) {
                        toSquare.click();
                    } else {
                        setTimeout(() => toSquare.click(), 50);
                    }
                    return true;
                }
            } catch (e) {
                logError('Simulate move failed:', e);
            }
            return false;
        },

        isGameOver() {
            // Check if game is over
            const fen = this.getFEN();
            if (!fen) return false;

            // Check for game over indicators in UI
            const gameOverEl = document.querySelector('[class*="game-over"], [class*="result"], [class*="victory"]');
            if (gameOverEl) return true;

            return this.gameOver;
        },

        getPlayingAs() {
            // Determine if we're playing as white or black
            // Check user profile / game info
            const userEl = document.querySelector('[class*="username"], [class*="player-name"]');
            if (userEl) {
                // This is simplified - would need actual username matching
                return this.isFlipped ? 'black' : 'white';
            }
            return this.isFlipped ? 'black' : 'white';
        },

        getTimeLeft(color) {
            // Get time left for color
            const clockSelector = color === 'white' ?
                '[class*="clock-white"], [class*="white-clock"]' :
                '[class*="clock-black"], [class*="black-clock"]';
            const clockEl = document.querySelector(clockSelector);
            if (clockEl) {
                const text = clockEl.textContent;
                const match = text.match(/(\d+):(\d+)/);
                if (match) {
                    return parseInt(match[1]) * 60 + parseInt(match[2]);
                }
            }
            return null;
        }
    };

    // ==========================================
    // ENGINE MANAGER - Stockfish WASM
    // ==========================================

    const Engine = {
        worker: null,
        isReady: false,
        isLoading: false,
        currentEngine: 'none', // 'wasm', 'local', 'none'
        pendingCommands: [],
        analysisCallback: null,
        bestMoveCallback: null,
        infoCallback: null,
        depth: CONFIG.ENGINE_DEPTH,
        movetime: CONFIG.ENGINE_MOVETIME,
        skillLevel: 20,
        multiPV: 3,
        lastBestMove: null,
        lastEvaluation: null,
        lastDepth: 0,
        heartbeatTimer: null,
        missedHeartbeats: 0,
        wasmSupported: true,

        async init() {
            log('Initializing Engine');
            await this.loadEngine();
        },

        async loadEngine() {
            if (this.isLoading) return;
            this.isLoading = true;

            const preferred = Settings.get('preferredEngine');

            if (preferred === 'local' || preferred === 'auto') {
                // Try local first (self-hosted, most reliable)
                const loaded = await this.loadLocalEngine();
                if (loaded) {
                    this.currentEngine = 'local';
                    this.isLoading = false;
                    return;
                }
            }

            if (preferred === 'wasm' || preferred === 'auto') {
                // Try CDN WASM
                const loaded = await this.loadWASMEngine();
                if (loaded) {
                    this.currentEngine = 'wasm';
                    this.isLoading = false;
                    return;
                }
            }

            logError('All engine loading methods failed');
            this.isLoading = false;
            this.isReady = false;
        },

        async loadLocalEngine() {
            log('Loading local engine from GitHub...');
            try {
                // Use GM_xmlhttpRequest to bypass CSP
                const jsCode = await this.fetchWithGM(CONFIG.LOCAL_ENGINE_JS);
                if (!jsCode) throw new Error('Failed to fetch engine JS');

                this.worker = this.createWorkerFromCode(jsCode);
                await this.initializeWorker();
                log('Local engine loaded successfully');
                return true;
            } catch (e) {
                logError('Local engine load failed:', e);
                return false;
            }
        },

        async loadWASMEngine() {
            log('Loading Stockfish WASM from CDN...');

            for (let i = 0; i < CONFIG.STOCKFISH_JS_URLS.length; i++) {
                try {
                    const jsUrl = CONFIG.STOCKFISH_JS_URLS[i];
                    const wasmUrl = CONFIG.STOCKFISH_WASM_URLS[i];

                    log(`Trying mirror ${i + 1}: ${jsUrl}`);

                    const jsCode = await this.fetchWithGM(jsUrl);
                    if (!jsCode) throw new Error('Failed to fetch JS');

                    // Patch the WASM URL in the JS code
                    const patchedCode = jsCode.replace(
                        /(?:wasmBinaryFile|locateFile)\s*=\s*["'][^"']*["']/g,
                        `wasmBinaryFile = "${wasmUrl}"`
                    );

                    this.worker = this.createWorkerFromCode(patchedCode);
                    await this.initializeWorker();
                    log('WASM engine loaded from mirror', i + 1);
                    return true;
                } catch (e) {
                    logError(`Mirror ${i + 1} failed:`, e.message);
                }
            }

            return false;
        },

        fetchWithGM(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 120000, // 2 minutes for large WASM
                    responseType: 'text',
                    onload: (response) => {
                        if (response.status === 200) {
                            resolve(response.responseText);
                        } else {
                            reject(new Error(`HTTP ${response.status}`));
                        }
                    },
                    onerror: (err) => reject(err),
                    ontimeout: () => reject(new Error('Timeout'))
                });
            });
        },

        createWorkerFromCode(code) {
            const blob = new Blob([code], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const worker = new Worker(url);
            URL.revokeObjectURL(url);
            return worker;
        },

        async initializeWorker() {
            return new Promise((resolve, reject) => {
                let initialized = false;

                const timeout = setTimeout(() => {
                    if (!initialized) {
                        initialized = true;
                        reject(new Error('Engine initialization timeout'));
                    }
                }, 30000);

                this.worker.onmessage = (e) => {
                    if (initialized) return;
                    const msg = e.data;

                    if (msg === 'ready' || msg === 'Stockfish NNUE ready') {
                        initialized = true;
                        clearTimeout(timeout);
                        this.sendCommand('uci');
                        this.isReady = true;
                        this.startHeartbeat();
                        this.processPendingCommands();
                        log('Engine ready');
                        resolve(true);
                    } else if (msg.startsWith('bestmove')) {
                        this.handleBestMove(msg);
                    } else if (msg.startsWith('info')) {
                        this.handleInfo(msg);
                    }
                };

                this.worker.onerror = (err) => {
                    if (!initialized) {
                        initialized = true;
                        clearTimeout(timeout);
                        reject(err);
                    }
                };

                // Send UCI to initialize
                this.worker.postMessage('uci');
            });
        },

        sendCommand(cmd) {
            if (this.worker && this.isReady) {
                this.worker.postMessage(cmd);
            } else if (this.worker) {
                this.pendingCommands.push(cmd);
            }
        },

        processPendingCommands() {
            while (this.pendingCommands.length > 0) {
                this.sendCommand(this.pendingCommands.shift());
            }
        },

        startHeartbeat() {
            this.heartbeatTimer = setInterval(() => {
                if (this.isReady) {
                    this.sendCommand('isready');
                    this.missedHeartbeats++;
                    if (this.missedHeartbeats > 2) {
                        logError('Engine heartbeat failed, reloading...');
                        this.reloadEngine();
                    }
                }
            }, 10000);
        },

        handleBestMove(msg) {
            const match = msg.match(/bestmove\s+(\w+)(?:\s+ponder\s+\w+)?/);
            if (match) {
                this.lastBestMove = match[1];
                if (this.bestMoveCallback) {
                    this.bestMoveCallback(this.lastBestMove, this.lastEvaluation, this.lastDepth);
                }
            }
            this.missedHeartbeats = 0;
        },

        handleInfo(msg) {
            // Parse info line for depth, score, pv
            const depthMatch = msg.match(/depth\s+(\d+)/);
            const scoreMatch = msg.match(/score\s+(cp|mate)\s+(-?\d+)/);
            const pvMatch = msg.match(/pv\s+(.+)/);

            if (depthMatch) {
                this.lastDepth = parseInt(depthMatch[1]);
            }

            if (scoreMatch) {
                const type = scoreMatch[1];
                const value = parseInt(scoreMatch[2]);
                if (type === 'cp') {
                    this.lastEvaluation = value / 100; // Convert to pawns
                } else {
                    this.lastEvaluation = value > 0 ? 999 : -999; // Mate score
                }
            }

            if (this.infoCallback) {
                this.infoCallback({
                    depth: this.lastDepth,
                    evaluation: this.lastEvaluation,
                    pv: pvMatch ? pvMatch[1].split(' ') : []
                });
            }
        },

        setPosition(fen) {
            this.lastPositionFen = fen;
            this.sendCommand(`position fen ${fen}`);
        },

        setDepth(depth) {
            this.depth = depth;
        },

        setMovetime(movetime) {
            this.movetime = movetime;
        },

        setSkillLevel(skill) {
            this.skillLevel = skill;
            this.sendCommand(`setoption name Skill Level value ${skill}`);
        },

        setMultiPV(mpv) {
            this.multiPV = mpv;
            this.sendCommand(`setoption name MultiPV value ${mpv}`);
        },

        getBestMove(callback) {
            // Delegate to parallel search if bullet mode active
            if (BulletMode.active) {
                BulletMode.search(this.lastPositionFen || '', callback);
                return;
            }
            this.bestMoveCallback = callback;
            this.sendCommand(`go depth ${this.depth} movetime ${this.movetime}`);
        },

        analyzePosition(fen, callback) {
            this.analysisCallback = callback;
            this.infoCallback = (info) => {
                if (callback) callback(info);
            };
            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${Settings.get('analysisDepth')} movetime ${Settings.get('analysisMovetime')}`);
        },

        stopAnalysis() {
            this.sendCommand('stop');
            this.analysisCallback = null;
            this.infoCallback = null;
        },

        isReadyStatus() {
            return this.isReady;
        },

        async reloadEngine() {
            this.isReady = false;
            this.stopHeartbeat();
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
            await sleep(1000);
            await this.loadEngine();
        },

        stopHeartbeat() {
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
        },

        destroy() {
            this.stopHeartbeat();
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
            this.isReady = false;
        }
    };

    // ==========================================
    // OPENING BOOK
    // ==========================================

    const OpeningBook = {
        book: null,
        loaded: false,

        async load() {
            if (this.loaded) return;
            try {
                const response = await fetch(CONFIG.OPENING_BOOK_URL);
                if (response.ok) {
                    this.book = await response.json();
                    this.loaded = true;
                    log('Opening book loaded:', Object.keys(this.book).length, 'positions');
                }
            } catch (e) {
                logError('Opening book load failed:', e);
                // Use built-in minimal book
                this.book = this.getBuiltinBook();
                this.loaded = true;
            }
        },

        getBuiltinBook() {
            // Minimal built-in opening book
            return {
                'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1': [
                    { move: 'e2e4', weight: 100 },
                    { move: 'd2d4', weight: 90 },
                    { move: 'g1f3', weight: 60 },
                    { move: 'c2c4', weight: 50 }
                ],
                'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1': [
                    { move: 'e7e5', weight: 100 },
                    { move: 'c7c5', weight: 70 },
                    { move: 'e7e6', weight: 60 },
                    { move: 'c7c6', weight: 50 }
                ]
            };
        },

        getMove(fen) {
            if (!this.loaded) return null;
            const key = fen.split(' ').slice(0, 4).join(' '); // Position without move counters
            const moves = this.book[key];
            if (!moves || moves.length === 0) return null;

            // Weighted random selection
            const totalWeight = moves.reduce((sum, m) => sum + m.weight, 0);
            let random = Math.random() * totalWeight;
            for (const move of moves) {
                random -= move.weight;
                if (random <= 0) return move.move;
            }
            return moves[0].move;
        }
    };

    // ==========================================
    // ANALYSIS MANAGER
    // ==========================================

    const Analysis = {
        active: false,
        currentFen: null,
        updateInterval: null,

        async init() {
            log('Initializing Analysis');
            await OpeningBook.load();
        },

        onPositionChange(fen) {
            this.currentFen = fen;
            if (Settings.get('autoAnalyze') && Engine.isReadyStatus()) {
                this.startAnalysis(fen);
            }
        },

        startAnalysis(fen) {
            if (this.active) return;
            this.active = true;
            log('Starting analysis for:', fen);

            Engine.analyzePosition(fen, (info) => {
                if (Settings.get('showEvaluation')) {
                    UI.updateEvaluation(info.evaluation, info.depth, info.pv);
                }
            });
        },

        stopAnalysis() {
            if (!this.active) return;
            this.active = false;
            Engine.stopAnalysis();
            log('Analysis stopped');
        },

        toggle() {
            if (this.active) {
                this.stopAnalysis();
            } else if (this.currentFen) {
                this.startAnalysis(this.currentFen);
            }
        }
    };

    // ==========================================
    // AUTO PLAY MANAGER
    // ==========================================

    const AutoPlay = {
        active: false,
        thinking: false,
        lastMoveTime: 0,

        async makeMove() {
            if (this.thinking || !Engine.isReadyStatus()) return false;

            const fen = BoardManager.getFEN();
            if (!fen) return false;

            const turn = BoardManager.getTurn();
            const playingAs = BoardManager.getPlayingAs();
            const myTurn = (turn === 'w' && playingAs === 'white') ||
                (turn === 'b' && playingAs === 'black');

            if (!myTurn) return false;

            // Check time controls
            const timeLeft = BoardManager.getTimeLeft(playingAs);
            if (timeLeft !== null && timeLeft < Settings.get('minTimeLeft')) {
                log('Low time, skipping auto move');
                return false;
            }

            // Check opening book first
            if (Settings.get('useOpeningBook')) {
                const bookMove = OpeningBook.getMove(fen);
                if (bookMove) {
                    log('Playing book move:', bookMove);
                    return BoardManager.makeMove({ from: bookMove.slice(0, 2), to: bookMove.slice(2, 4), promotion: bookMove[4] || 'q' });
                }
            }

            this.thinking = true;
            UI.showThinking(true);

            return new Promise((resolve) => {
                Engine.getBestMove((move, evaluation, depth) => {
                    this.thinking = false;
                    UI.showThinking(false);

                    if (move && move !== '(none)') {
                        log('Engine move:', move, 'eval:', evaluation, 'depth:', depth);
                        const from = move.slice(0, 2);
                        const to = move.slice(2, 4);
                        const promotion = move[4] || 'q';

                        // In bullet mode: instant move. Normal: humanize delay
                        if (BulletMode.active) {
                            const result = BoardManager.makeMove({ from, to, promotion });
                            resolve(result);
                        } else {
                            const delay = humanizeDelay(randomDelay(
                                Settings.get('autoPlayDelayMin') || CONFIG.AUTO_PLAY_DELAY_MIN,
                                Settings.get('autoPlayDelayMax') || CONFIG.AUTO_PLAY_DELAY_MAX
                            ));

                            setTimeout(() => {
                                const result = BoardManager.makeMove({ from, to, promotion });
                                resolve(result);
                            }, delay);
                        }
                    } else {
                        resolve(false);
                    }
                });
            });
        },

        start() {
            if (this.active) return;
            this.active = true;
            log('Auto-play started');
            this.loop();
        },

        stop() {
            this.active = false;
            log('Auto-play stopped');
        },

        async loop() {
            while (this.active) {
                if (!BoardManager.isGameOver()) {
                    await this.makeMove();
                } else {
                    log('Game over, stopping auto-play');
                    this.stop();
                    break;
                }
                // Bullet mode: minimal delay between moves
                await sleep(BulletMode.active ? 100 : 1000);
            }
        },

        toggle() {
            if (this.active) {
                this.stop();
            } else {
                this.start();
            }
            UI.updateAutoPlayButton();
        }
    };

    // ==========================================
    // BULLET MODE - Speed optimization for bullet games
    // ==========================================

    const BulletMode = {
        active: false,
        extraWorker: null,
        extraWorkerReady: false,
        pendingCommands: [],
        lastBestMove: null,
        lastEvaluation: null,
        searchTimeout: null,

        async init() {
            if (!Settings.get('bulletMode')) return;
            await this.activate();
        },

        async activate() {
            if (this.active) return;
            this.active = true;
            log('Bullet Mode activating...');

            Settings.set('bulletMode', true);

            // Set main engine to bullet config
            Engine.setMovetime(Settings.get('bulletMovetime') || 50);
            Engine.sendCommand(`setoption name Hash value ${Settings.get('bulletHash') || 256}`);
            Engine.sendCommand('setoption name MultiPV value 1');
            Engine.sendCommand('setoption name SlowMover value 100');

            // Spin up extra worker
            await this.createExtraWorker();

            log('Bullet Mode active');
            UI.updateBulletButton();
        },

        async deactivate() {
            if (!this.active) return;
            this.active = false;
            log('Bullet Mode deactivating...');

            Settings.set('bulletMode', false);

            // Restore main engine defaults
            Engine.setMovetime(CONFIG.ENGINE_MOVETIME);
            Engine.sendCommand(`setoption name Hash value ${CONFIG.ENGINE_HASH}`);
            Engine.sendCommand(`setoption name MultiPV value ${CONFIG.ENGINE_MULTIPV}`);

            // Kill extra worker
            this.destroyExtraWorker();

            log('Bullet Mode deactivated');
            UI.updateBulletButton();
        },

        async createExtraWorker() {
            try {
                // Get engine source from main worker
                const engineUrl = Engine.currentEngine === 'local'
                    ? CONFIG.LOCAL_ENGINE_JS
                    : CONFIG.STOCKFISH_JS_URLS[0];

                const jsCode = await Engine.fetchWithGM(engineUrl);
                if (!jsCode) throw new Error('Failed to fetch engine code for bullet worker');

                // Patch WASM URL if needed
                let patchedCode = jsCode;
                if (Engine.currentEngine === 'wasm') {
                    const wasmUrl = CONFIG.STOCKFISH_WASM_URLS[0];
                    patchedCode = jsCode.replace(
                        /(?:wasmBinaryFile|locateFile)\s*=\s*["'][^"']*["']/g,
                        `wasmBinaryFile = "${wasmUrl}"`
                    );
                }

                this.extraWorker = Engine.createWorkerFromCode(patchedCode);
                await this.initExtraWorker();
                log('Bullet extra worker ready');
            } catch (e) {
                logError('Bullet worker creation failed:', e);
                this.extraWorker = null;
            }
        },

        async initExtraWorker() {
            return new Promise((resolve, reject) => {
                let initialized = false;

                const timeout = setTimeout(() => {
                    if (!initialized) {
                        initialized = true;
                        reject(new Error('Bullet worker init timeout'));
                    }
                }, 30000);

                this.extraWorker.onmessage = (e) => {
                    const msg = e.data;

                    if (!initialized && (msg === 'ready' || msg === 'Stockfish NNUE ready')) {
                        initialized = true;
                        clearTimeout(timeout);
                        this.extraWorker.postMessage('uci');
                        this.extraWorkerReady = true;
                        this.processPendingCommands();
                        resolve();
                    } else if (msg.startsWith('bestmove')) {
                        this.handleBestMove(msg);
                    }
                };

                this.extraWorker.onerror = (err) => {
                    if (!initialized) {
                        initialized = true;
                        clearTimeout(timeout);
                        reject(err);
                    }
                };

                this.extraWorker.postMessage('uci');
            });
        },

        sendCommand(cmd) {
            if (this.extraWorker && this.extraWorkerReady) {
                this.extraWorker.postMessage(cmd);
            } else if (this.extraWorker) {
                this.pendingCommands.push(cmd);
            }
        },

        processPendingCommands() {
            while (this.pendingCommands.length > 0) {
                this.sendCommand(this.pendingCommands.shift());
            }
        },

        handleBestMove(msg) {
            const match = msg.match(/bestmove\s+(\w+)/);
            if (match) {
                this.lastBestMove = match[1];
            }
        },

        search(fen, callback) {
            if (!this.active || !this.extraWorkerReady) {
                // Fallback to single worker
                Engine.getBestMove(callback);
                return;
            }

            const timeBudget = Settings.get('bulletMovetime') || 50;
            this.lastBestMove = null;

            // Send to both workers simultaneously
            Engine.setPosition(fen);
            Engine.sendCommand(`go depth ${CONFIG.ENGINE_DEPTH} movetime ${timeBudget}`);

            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${CONFIG.ENGINE_DEPTH} movetime ${timeBudget}`);

            // Return first result within time budget
            const startTime = Date.now();
            const pollInterval = setInterval(() => {
                if (this.lastBestMove || (Date.now() - startTime) >= timeBudget) {
                    clearInterval(pollInterval);
                    // Stop both engines
                    Engine.sendCommand('stop');
                    this.sendCommand('stop');

                    const move = this.lastBestMove || Engine.lastBestMove;
                    if (move && callback) {
                        callback(move, Engine.lastEvaluation, Engine.lastDepth);
                    }
                }
            }, 5);
        },

        destroyExtraWorker() {
            if (this.extraWorker) {
                this.extraWorker.terminate();
                this.extraWorker = null;
                this.extraWorkerReady = false;
                this.pendingCommands = [];
            }
        },

        toggle() {
            if (this.active) {
                this.deactivate();
            } else {
                this.activate();
            }
        },

        destroy() {
            this.destroyExtraWorker();
            this.active = false;
        }
    };

    // ==========================================
    // UI MANAGER
    // ==========================================

    const UI = {
        panel: null,
        evalBar: null,
        thinkingIndicator: null,
        autoPlayBtn: null,
        analysisBtn: null,
        settingsBtn: null,

        init() {
            this.createPanel();
            this.createEvalBar();
            this.createThinkingIndicator();
            this.injectStyles();
            log('UI initialized');
        },

        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                #chess-ai-panel {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 280px;
                    background: #1e1e1e;
                    border: 1px solid #333;
                    border-radius: 8px;
                    padding: 15px;
                    z-index: 10000;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #e0e0e0;
                    font-size: 13px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                }
                #chess-ai-panel h3 {
                    margin: 0 0 15px;
                    color: #4ec9b0;
                    font-size: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                #chess-ai-panel .btn {
                    display: inline-block;
                    padding: 8px 16px;
                    margin: 4px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                }
                #chess-ai-panel .btn-primary { background: #4ec9b0; color: #1e1e1e; }
                #chess-ai-panel .btn-primary:hover { background: #3db8a0; }
                #chess-ai-panel .btn-danger { background: #f44747; color: white; }
                #chess-ai-panel .btn-danger:hover { background: #e03e3e; }
                #chess-ai-panel .btn-secondary { background: #3c3c3c; color: #e0e0e0; }
                #chess-ai-panel .btn-secondary:hover { background: #4a4a4a; }
                #chess-ai-panel .btn.active { background: #4ec9b0; color: #1e1e1e; }
                #chess-ai-panel .btn-bullet-active {
                    background: #f0ad4e;
                    color: #1e1e1e;
                    animation: bulletPulse 1.5s ease-in-out infinite;
                }
                @keyframes bulletPulse {
                    0%, 100% { box-shadow: 0 0 5px rgba(240,173,78,0.3); }
                    50% { box-shadow: 0 0 15px rgba(240,173,78,0.6); }
                }
                #chess-ai-panel label { display: flex; align-items: center; margin: 8px 0; cursor: pointer; }
                #chess-ai-panel input[type="checkbox"] { margin-right: 8px; }
                #chess-ai-panel select, #chess-ai-panel input[type="number"] {
                    width: 100%;
                    padding: 6px;
                    margin: 4px 0 12px;
                    background: #2d2d2d;
                    border: 1px solid #444;
                    border-radius: 4px;
                    color: #e0e0e0;
                }
                #chess-ai-eval-bar {
                    position: fixed;
                    top: 50%;
                    transform: translateY(-50%);
                    width: ${CONFIG.EVAL_BAR_WIDTH}px;
                    height: ${CONFIG.EVAL_BAR_HEIGHT}px;
                    background: #2d2d2d;
                    border: 1px solid #444;
                    border-radius: 7px;
                    z-index: 9999;
                    overflow: hidden;
                }
                #chess-ai-eval-bar.left { left: 10px; }
                #chess-ai-eval-bar.right { right: 10px; }
                #chess-ai-eval-fill {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: linear-gradient(to top, #4ec9b0, #6fd9c0);
                    transition: height 0.3s ease;
                }
                #chess-ai-eval-text {
                    position: absolute;
                    top: 5px;
                    left: 0;
                    right: 0;
                    text-align: center;
                    font-size: 11px;
                    font-weight: bold;
                    color: #e0e0e0;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                }
                #chess-ai-thinking {
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(30,30,30,0.9);
                    padding: 10px 20px;
                    border-radius: 20px;
                    border: 1px solid #4ec9b0;
                    color: #4ec9b0;
                    font-size: 14px;
                    z-index: 9999;
                    display: none;
                }
                #chess-ai-thinking .spinner {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid #4ec9b0;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-right: 10px;
                    vertical-align: middle;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .chess-ai-hidden { display: none !important; }
            `;
            document.head.appendChild(style);
        },

        createPanel() {
            this.panel = document.createElement('div');
            this.panel.id = 'chess-ai-panel';
            this.panel.innerHTML = `
                <h3>Chess AI Bot <span id="chess-ai-version">v11.1.1</span></h3>
                <div style="margin-bottom: 10px;">
                    <button id="chess-ai-autoplay" class="btn btn-secondary">Auto Play: OFF</button>
                    <button id="chess-ai-analyze" class="btn btn-secondary">Analysis: OFF</button>
                    <button id="chess-ai-bullet" class="btn btn-secondary">BULLET: OFF</button>
                </div>
                <div id="chess-ai-bullet-status" style="display:none; border-top: 1px solid #f0ad4e; padding-top: 8px; margin-top: 8px; font-size: 11px;">
                    <span style="color: #f0ad4e; font-weight: bold;">BULLET MODE</span><br>
                    Workers: 2 (1 extra) | Target: 50ms<br>
                    Hash: 256MB | Delays: None
                </div>
                <div style="margin-bottom: 10px;">
                    <label><input type="checkbox" id="chess-ai-enabled" ${Settings.get('enabled') ? 'checked' : ''}> Enabled</label>
                    <label><input type="checkbox" id="chess-ai-evalbar" ${Settings.get('showEvalBar') ? 'checked' : ''}> Eval Bar</label>
                    <label><input type="checkbox" id="chess-ai-bestmove" ${Settings.get('showBestMove') ? 'checked' : ''}> Best Move</label>
                    <label><input type="checkbox" id="chess-ai-opening" ${Settings.get('useOpeningBook') ? 'checked' : ''}> Opening Book</label>
                    <label><input type="checkbox" id="chess-ai-onlymyturn" ${Settings.get('onlyMyTurn') ? 'checked' : ''}> Only My Turn</label>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>Depth: <input type="number" id="chess-ai-depth" value="${Settings.get('engineDepth')}" min="1" max="30" style="width: 60px;"></label>
                    <label>Movetime: <input type="number" id="chess-ai-movetime" value="${Settings.get('engineMovetime')}" min="50" max="5000" step="50" style="width: 70px;"></label>
                    <label>Skill: <select id="chess-ai-skill" style="width: 80px;">
                        ${[...Array(21)].map((_, i) => `<option value="${i}" ${i === Settings.get('skillLevel') ? 'selected' : ''}>${i}</option>`).join('')}
                    </select></label>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>Engine: <select id="chess-ai-engine" style="width: 100%;">
                        <option value="auto" ${Settings.get('preferredEngine') === 'auto' ? 'selected' : ''}>Auto</option>
                        <option value="wasm" ${Settings.get('preferredEngine') === 'wasm' ? 'selected' : ''}>WASM (CDN)</option>
                        <option value="local" ${Settings.get('preferredEngine') === 'local' ? 'selected' : ''}>Local (GitHub)</option>
                    </select></label>
                </div>
                <div style="border-top: 1px solid #333; padding-top: 10px; margin-top: 10px; font-size: 11px; color: #888;">
                    <button id="chess-ai-reset" class="btn btn-secondary" style="width: 100%;">Reset Settings</button>
                    <a href="https://github.com/aciokie/chess-ai-bot" target="_blank" style="color: #4ec9b0; text-decoration: none; display: block; text-align: center; margin-top: 8px;">GitHub Repository</a>
                </div>
            `;
            document.body.appendChild(this.panel);

            // Bind events
            this.bindPanelEvents();
        },

        bindPanelEvents() {
            const bindings = [
                ['chess-ai-enabled', 'enabled'],
                ['chess-ai-evalbar', 'showEvalBar'],
                ['chess-ai-bestmove', 'showBestMove'],
                ['chess-ai-opening', 'useOpeningBook'],
                ['chess-ai-onlymyturn', 'onlyMyTurn'],
                ['chess-ai-depth', 'engineDepth', 'int'],
                ['chess-ai-movetime', 'engineMovetime', 'int'],
                ['chess-ai-skill', 'skillLevel', 'int'],
                ['chess-ai-engine', 'preferredEngine']
            ];

            for (const [id, key, type] of bindings) {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('change', () => {
                        let value = el.type === 'checkbox' ? el.checked : el.value;
                        if (type === 'int') value = parseInt(value);
                        Settings.set(key, value);
                        this.onSettingChange(key, value);
                    });
                }
            }

            document.getElementById('chess-ai-autoplay')?.addEventListener('click', () => AutoPlay.toggle());
            document.getElementById('chess-ai-analyze')?.addEventListener('click', () => Analysis.toggle());
            document.getElementById('chess-ai-bullet')?.addEventListener('click', () => BulletMode.toggle());
            document.getElementById('chess-ai-reset')?.addEventListener('click', () => {
                Settings.reset();
                location.reload();
            });
        },

        onSettingChange(key, value) {
            switch (key) {
                case 'enabled':
                    if (value) {
                        AutoPlay.start();
                        Analysis.startAnalysis(BoardManager.getFEN());
                    } else {
                        AutoPlay.stop();
                        Analysis.stopAnalysis();
                    }
                    break;
                case 'showEvalBar':
                    this.toggleEvalBar(value);
                    break;
                case 'engineDepth':
                    Engine.setDepth(value);
                    break;
                case 'engineMovetime':
                    Engine.setMovetime(value);
                    break;
                case 'skillLevel':
                    Engine.setSkillLevel(value);
                    break;
                case 'preferredEngine':
                    Engine.reloadEngine();
                    break;
            }
            this.updateAutoPlayButton();
            this.updateAnalysisButton();
        },

        updateAutoPlayButton() {
            const btn = document.getElementById('chess-ai-autoplay');
            if (btn) {
                btn.textContent = `Auto Play: ${AutoPlay.active ? 'ON' : 'OFF'}`;
                btn.className = `btn ${AutoPlay.active ? 'btn-primary' : 'btn-secondary'}`;
            }
        },

        updateAnalysisButton() {
            const btn = document.getElementById('chess-ai-analyze');
            if (btn) {
                btn.textContent = `Analysis: ${Analysis.active ? 'ON' : 'OFF'}`;
                btn.className = `btn ${Analysis.active ? 'btn-primary' : 'btn-secondary'}`;
            }
        },

        updateBulletButton() {
            const btn = document.getElementById('chess-ai-bullet');
            const status = document.getElementById('chess-ai-bullet-status');
            if (btn) {
                btn.textContent = `BULLET: ${BulletMode.active ? 'ON' : 'OFF'}`;
                btn.className = `btn ${BulletMode.active ? 'btn-bullet-active' : 'btn-secondary'}`;
            }
            if (status) {
                status.style.display = BulletMode.active ? 'block' : 'none';
            }
        },

        createEvalBar() {
            this.evalBar = document.createElement('div');
            this.evalBar.id = 'chess-ai-eval-bar';
            this.evalBar.className = Settings.get('evalBarSide') === 'left' ? 'left' : 'right';
            this.evalBar.innerHTML = `
                <div id="chess-ai-eval-fill" style="height: 50%;"></div>
                <div id="chess-ai-eval-text">0.00</div>
            `;
            document.body.appendChild(this.evalBar);
            this.toggleEvalBar(Settings.get('showEvalBar'));
        },

        toggleEvalBar(show) {
            if (this.evalBar) {
                this.evalBar.style.display = show ? 'block' : 'none';
            }
        },

        updateEvaluation(evaluation, depth, pv) {
            if (!this.evalBar || !Settings.get('showEvalBar')) return;

            const fill = document.getElementById('chess-ai-eval-fill');
            const text = document.getElementById('chess-ai-eval-text');

            if (fill && text) {
                // Convert evaluation to percentage (clamped)
                const clampedEval = Math.max(-10, Math.min(10, evaluation || 0));
                const percentage = 50 + (clampedEval * 5); // 0.00 = 50%, +10 = 100%, -10 = 0%
                fill.style.height = `${Math.max(0, Math.min(100, percentage))}%`;

                // Color based on advantage
                if (clampedEval > 0.5) fill.style.background = 'linear-gradient(to top, #4ec9b0, #6fd9c0)';
                else if (clampedEval < -0.5) fill.style.background = 'linear-gradient(to top, #f44747, #ff6b6b)';
                else fill.style.background = 'linear-gradient(to top, #ffd700, #ffeb3b)';

                text.textContent = evaluation !== null ? evaluation.toFixed(2) : '0.00';
            }
        },

        createThinkingIndicator() {
            this.thinkingIndicator = document.createElement('div');
            this.thinkingIndicator.id = 'chess-ai-thinking';
            this.thinkingIndicator.innerHTML = '<span class="spinner"></span>Thinking...';
            document.body.appendChild(this.thinkingIndicator);
        },

        showThinking(show) {
            if (this.thinkingIndicator) {
                this.thinkingIndicator.style.display = show ? 'block' : 'none';
            }
        }
    };

    // ==========================================
    // KEYBOARD SHORTCUTS
    // ==========================================

    function setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            // Alt+A: Toggle auto-play
            if (e.altKey && e.key === 'a') {
                e.preventDefault();
                AutoPlay.toggle();
            }
            // Alt+S: Toggle analysis
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                Analysis.toggle();
            }
            // Alt+E: Toggle eval bar
            if (e.altKey && e.key === 'e') {
                e.preventDefault();
                const show = !Settings.get('showEvalBar');
                Settings.set('showEvalBar', show);
                UI.toggleEvalBar(show);
            }
            // Alt+R: Reload engine
            if (e.altKey && e.key === 'r') {
                e.preventDefault();
                Engine.reloadEngine();
            }
            // Alt+O: Toggle panel
            if (e.altKey && e.key === 'o') {
                e.preventDefault();
                if (UI.panel) UI.panel.classList.toggle('chess-ai-hidden');
            }
            // Alt+B: Toggle bullet mode
            if (e.altKey && e.key === 'b') {
                e.preventDefault();
                BulletMode.toggle();
            }
        });
        log('Hotkeys registered: Alt+A (auto), Alt+S (analysis), Alt+E (eval), Alt+R (reload), Alt+O (panel), Alt+B (bullet)');
    }

    // ==========================================
    // BACKUP POLLING (fallback for observer)
    // ==========================================

    let backupPollInterval = null;

    function scheduleBackupPoll() {
        if (backupPollInterval) clearInterval(backupPollInterval);
        backupPollInterval = setInterval(() => {
            if (BoardManager.boardElement) {
                BoardManager.updateState();
            }
        }, 2000);
    }

    function startGameOverPoll() {
        setInterval(() => {
            if (BoardManager.isGameOver()) {
                AutoPlay.stop();
                Analysis.stopAnalysis();
            }
        }, 5000);
    }

    // ==========================================
    // MAIN CHECK & ANALYZE LOOP
    // ==========================================

    async function checkAndAnalyze() {
        if (!Settings.get('enabled')) return;

        const fen = BoardManager.getFEN();
        if (fen && fen !== BoardManager.lastFen) {
            BoardManager.lastFen = fen;
            if (Settings.get('autoAnalyze') && Engine.isReadyStatus()) {
                Analysis.startAnalysis(fen);
            }
        }

        // Check for auto-play
        if (AutoPlay.active && !AutoPlay.thinking) {
            await AutoPlay.makeMove();
        }

        // Schedule next check
        setTimeout(checkAndAnalyze, 500);
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================

    async function initialize() {
        log('Chess AI Bot v11.1.1 starting...');

        // Load settings
        Settings.loadAll();

        // Initialize components
        await BoardManager.init();
        await Engine.init();
        await Analysis.init();
        UI.init();
        setupHotkeys();

        // Rehydrate bullet mode if previously enabled
        if (Settings.get('bulletMode')) {
            await BulletMode.init();
        }

        // Start main loop
        checkAndAnalyze();

        log('Chess AI Bot initialized successfully');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();