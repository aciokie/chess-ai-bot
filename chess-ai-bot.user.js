// ==UserScript==
// @name         Chess AI Bot
// @namespace    https://github.com/aciokie/chess-ai-bot
// @version      11.2.0
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
            bulletHash: 256,
            // Original UI settings
            showPVArrows: false,
            pvDepth: 15,
            pvShowNumbers: true,
            pvCustomGradient: false,
            pvStartColor: '#4ec9b0',
            pvEndColor: '#f44747',
            autoQueue: false,
            threatDetection: false,
            timeManagement: true,
            humanizer: false,
            humanizeRate: 30,
            autoRematch: false,
            showMoveHighlights: true,
            debugLogs: false,
            menuOpacity: 0.9,
            themeBg: '#222222',
            themeText: '#eeeeee',
            themeBorder: '#444444',
            themePrimary: '#81b64c',
            highlightColor: '#00eeff',
            visualType: 'boxes',
            innerOpacity: 0.5,
            outerOpacity: 0.8,
            gradientBias: 50,
            arrowOpacity: 0.8,
            arrowWidth: 20,
            visualOutlineOpacity: 0.8,
            visualOutlineWidth: 2,
            visualOutlineGlow: false,
            visualOutlineGlowRadius: 10,
            hideAfterMove: false,
            menuPosition: 'top-right',
            searchMoves: ''
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
            const s = Settings;
            const bg = s.get('themeBg');
            const txt = s.get('themeText');
            const bdr = s.get('themeBorder');
            const pri = s.get('themePrimary');
            const W = CONFIG.EVAL_BAR_WIDTH;
            const H = CONFIG.EVAL_BAR_HEIGHT;
            const style = document.createElement('style');
            style.textContent = `
                #chess-ai-panel, #chess-ai-modalOv #chess-ai-modal, #chess-ai-localModalOv #chess-ai-localModal {
                    --bot-bg: ${bg}; --bot-b: ${bdr}; --bot-p: ${pri}; --bot-t: ${txt};
                }
                #chess-ai-panel *, #chess-ai-modal *, #chess-ai-localModal * { box-sizing: border-box; }

                /* ── Main panel ── */
                #chess-ai-panel {
                    position: fixed;
                    width: 25vw; height: 50vh;
                    min-width: 300px; min-height: 300px;
                    background: var(--bot-bg);
                    border: 1px solid var(--bot-b);
                    color: var(--bot-t);
                    z-index: 9999;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 13px;
                    line-height: 1.4;
                    box-shadow: -2px 0 20px rgba(0,0,0,0.6);
                    display: flex;
                    flex-direction: column;
                    resize: both;
                    overflow: hidden;
                    opacity: ${s.get('menuOpacity')};
                    border-radius: 6px;
                }
                #chess-ai-panel.chess-ai-hidden { display: none !important; }

                /* ── Panel header ── */
                #chess-ai-panelHeader {
                    background: var(--bot-p);
                    color: #000;
                    padding: 0 12px;
                    font-weight: 700;
                    font-size: 12px;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    flex: none;
                    user-select: none;
                    height: 36px;
                    flex-shrink: 0;
                }
                #chess-ai-panelHeader .header-left { display: flex; align-items: center; gap: 6px; }
                #chess-ai-minBtn {
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    width: 22px; height: 22px; background: rgba(0,0,0,0.15); border-radius: 4px;
                    font-size: 11px; transition: background 0.15s;
                }
                #chess-ai-minBtn:hover { background: rgba(0,0,0,0.28); }

                /* ── Panel content ── */
                #chess-ai-panelContent {
                    padding: 12px; display: flex; flex-direction: column; gap: 10px;
                    overflow-y: auto; flex: 1; min-height: 0;
                }

                /* ── Sections ── */
                #chess-ai-panel .sect {
                    border-top: 1px solid var(--bot-b); padding-top: 10px;
                    display: flex; flex-direction: column; gap: 7px;
                }
                #chess-ai-panel .sect-title {
                    font-size: 0.7em; color: #888; font-weight: 700;
                    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;
                }

                /* ── Rows ── */
                #chess-ai-panel .row {
                    display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 2px;
                }
                #chess-ai-panel .row label {
                    font-size: 0.85em; color: var(--bot-t); opacity: 0.85; font-weight: 500;
                }

                /* ── Inputs ── */
                #chess-ai-panel input, #chess-ai-panel select {
                    background: rgba(255,255,255,0.06); color: var(--bot-t);
                    border: 1px solid var(--bot-b); padding: 4px 7px; border-radius: 4px;
                    font-size: 12px; height: 26px; transition: border-color 0.15s;
                }
                #chess-ai-panel select { background-color: #2a2a2a; width: 120px; }
                #chess-ai-panel select option { background-color: #2a2a2a; color: #eeeeee; }
                #chess-ai-panel input:focus, #chess-ai-panel select:focus { outline: none; border-color: var(--bot-p); }
                #chess-ai-panel input[type="number"] { width: 60px; text-align: center; }
                #chess-ai-panel input[type="text"] { flex: 1; }
                #chess-ai-panel input[type="checkbox"] {
                    width: 15px; height: 15px; accent-color: var(--bot-p); cursor: pointer; border: none; background: transparent;
                }

                /* ── Range sliders ── */
                #chess-ai-panel input[type=range] {
                    -webkit-appearance: none; width: 100%; background: transparent; padding: 0; margin: 0; border: none; height: 18px;
                }
                #chess-ai-panel input[type=range]:focus { outline: none; }
                #chess-ai-panel input[type=range]::-webkit-slider-runnable-track {
                    width: 100%; height: 4px; cursor: pointer; background: var(--bot-b); border-radius: 2px;
                }
                #chess-ai-panel input[type=range]::-webkit-slider-thumb {
                    height: 14px; width: 14px; border-radius: 50%; background: var(--bot-p); cursor: pointer;
                    -webkit-appearance: none; margin-top: -5px; border: 2px solid rgba(0,0,0,0.2);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.4); transition: transform 0.1s;
                }
                #chess-ai-panel input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.15); }

                /* ── Buttons ── */
                #chess-ai-panel button {
                    background: var(--bot-p); border: none; padding: 0 12px; height: 30px; color: #000;
                    font-weight: 700; font-size: 12px; cursor: pointer; border-radius: 4px;
                    transition: filter 0.15s, transform 0.1s; letter-spacing: 0.02em; white-space: nowrap;
                }
                #chess-ai-panel button:hover { filter: brightness(1.12); }
                #chess-ai-panel button:active { transform: scale(0.97); }
                #chess-ai-panel button:disabled { opacity: 0.45; cursor: not-allowed; filter: none; transform: none; }
                #chess-ai-btnReset {
                    padding: 0 8px; height: 24px; font-size: 11px;
                    background: rgba(0,0,0,0.18) !important; color: rgba(0,0,0,0.8) !important; border-radius: 3px;
                }
                #chess-ai-custBtn  { background: #4fc3f7 !important; color: #000 !important; }
                #chess-ai-localBtn { background: #ffcc80 !important; color: #000 !important; }
                #chess-ai-btnAnalyze { width: 100%; height: 34px; font-size: 13px; letter-spacing: 0.04em; }
                #chess-ai-custBtn, #chess-ai-localBtn, #chess-ai-btnRematch { width: 100%; }
                #chess-ai-btnRematch { background: #c0392b !important; color: #fff !important; }
                .btn-row { display: flex; flex-direction: column; gap: 6px; }

                /* ── Bullet button ── */
                #chess-ai-bullet { width: 100%; }
                #chess-ai-bullet.bullet-active {
                    background: #f0ad4e !important; color: #1e1e1e !important;
                    animation: bulletPulse 1.5s ease-in-out infinite;
                }
                @keyframes bulletPulse {
                    0%, 100% { box-shadow: 0 0 5px rgba(240,173,78,0.3); }
                    50% { box-shadow: 0 0 15px rgba(240,173,78,0.6); }
                }
                #chess-ai-bullet-status {
                    display: none; border-top: 1px solid #f0ad4e; padding-top: 8px; margin-top: 4px;
                    font-size: 11px; color: #f0ad4e; font-weight: bold;
                }

                /* ── Log boxes ── */
                .log-box {
                    background: rgba(0,0,0,0.4); padding: 7px 9px;
                    font-family: 'Cascadia Code', 'Fira Mono', monospace; font-size: 0.72em;
                    border-radius: 4px; overflow-y: auto; word-break: break-all; white-space: pre-wrap;
                    border: 1px solid var(--bot-b); height: 90px; resize: vertical;
                    user-select: text !important; -webkit-user-select: text !important; cursor: text; color: #ccc;
                }

                /* ── Status / Move boxes ── */
                #chess-ai-statusBox {
                    background: rgba(0,0,0,0.18); padding: 8px 10px; border: 1px solid rgba(0,188,212,0.35);
                    border-radius: 5px; font-size: 0.88em; min-height: 42px; width: 100%; flex-shrink: 0;
                    display: flex; flex-direction: column; gap: 4px;
                }
                #chess-ai-moveResult {
                    background: rgba(0,0,0,0.18); padding: 5px 10px; border-radius: 4px;
                    text-align: center; font-size: 0.88em; border: 1px solid var(--bot-b);
                }

                /* ── Automation checkboxes ── */
                .auto-checks { display: flex; gap: 14px; flex-wrap: wrap; }
                .auto-checks label { display: flex; align-items: center; gap: 5px; font-size: 0.83em; cursor: pointer; white-space: nowrap; }

                /* ── PV header ── */
                .pv-header { display: flex; justify-content: space-between; align-items: center; width: 100%; }

                /* ── Slider groups ── */
                .slider-group { display: flex; align-items: center; gap: 7px; flex: 1; justify-content: flex-end; }
                .slider-group input[type=range] { flex: 1; }
                .slider-group input[type=number] { width: 46px; text-align: center; }
                .slider-group span { font-size: 0.78em; color: #777; min-width: 14px; }

                /* ── Modal overlay ── */
                #chess-ai-modalOv, #chess-ai-localModalOv {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.75); z-index: 10000;
                    display: none; justify-content: center; align-items: center; backdrop-filter: blur(2px);
                }
                /* ── Modals ── */
                #chess-ai-modal, #chess-ai-localModal {
                    background: var(--bot-bg); padding: 0; border-radius: 8px; width: 480px;
                    border: 1px solid var(--bot-b); display: flex; flex-direction: column;
                    max-height: 90vh; opacity: ${s.get('menuOpacity')}; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                }
                #chess-ai-modal *, #chess-ai-localModal * { color: var(--bot-t); }
                #chess-ai-modal label, #chess-ai-localModal label { opacity: 1 !important; font-weight: 600; font-size: 0.88em; }
                #chess-ai-modal input[type="color"], #chess-ai-localModal input[type="color"] { height: 26px; padding: 0; width: 40px; cursor: pointer; border: none; }
                #chess-ai-modal select, #chess-ai-localModal select { height: 26px; padding: 0 6px; font-size: 0.88em; }
                .modal-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 14px 16px; border-bottom: 1px solid var(--bot-b);
                }
                .modal-header h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.03em; }
                .modal-header button {
                    padding: 0 !important; width: 26px; height: 26px;
                    background: rgba(255,255,255,0.08) !important; color: var(--bot-t) !important;
                    border-radius: 4px; font-size: 16px; line-height: 1;
                }
                .modal-header button:hover { background: rgba(255,255,255,0.16) !important; }
                .modal-tabs { display: flex; border-bottom: 1px solid var(--bot-b); }
                #chess-ai-modal .tab-btn {
                    flex: 1; background: transparent !important; border: none !important;
                    border-bottom: 2px solid transparent !important; padding: 10px;
                    color: var(--bot-t) !important; cursor: pointer; opacity: 0.55;
                    font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
                    transition: opacity 0.15s; height: auto;
                }
                #chess-ai-modal .tab-btn:hover { opacity: 0.85; }
                #chess-ai-modal .tab-btn.active { opacity: 1; border-bottom: 2px solid var(--bot-p) !important; }
                .modal-content { padding: 14px 16px; overflow-y: auto; flex: 1; }
                #chess-ai-modal .modal-content .row { display: flex; align-items: center; margin-bottom: 11px; }
                #chess-ai-modal .modal-content .row label { flex: 0 0 128px; text-align: left; font-weight: 600; }
                #chess-ai-modal .modal-content .row > input[type="text"],
                #chess-ai-modal .modal-content .row > input[type="color"],
                #chess-ai-modal .modal-content .row > select { flex: 1; }
                .theme-presets { display: flex; gap: 8px; margin-bottom: 12px; }
                #chess-ai-modal .theme-btn {
                    flex: 1; padding: 0 !important; height: 30px !important;
                    border: 1px solid var(--bot-b) !important; background: rgba(255,255,255,0.05) !important;
                    color: var(--bot-t) !important; font-size: 12px !important;
                }
                .rgb-inputs { display: flex; gap: 5px; flex: 1; justify-content: flex-end; }
                .rgb-inputs input { width: 46px; text-align: center; }
                .adv-toggle {
                    cursor: pointer; font-size: 0.78em; color: var(--bot-p); text-decoration: none;
                    margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;
                    opacity: 0.85; transition: opacity 0.15s;
                }
                .adv-toggle:hover { opacity: 1; }
                .adv-sect { margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--bot-b); display: flex; flex-direction: column; gap: 7px; }
                .local-action-btn { padding: 0 14px !important; font-size: 0.83em !important; height: 30px !important; }
                .local-btn-install   { background: #27ae60 !important; color: #fff !important; }
                .local-btn-reinstall { background: #2980b9 !important; color: #fff !important; }
                .local-btn-uninstall { background: #c0392b !important; color: #fff !important; }
                #chess-ai-localModal .info-box {
                    background: rgba(0,0,0,0.25); border: 1px solid var(--bot-b); border-radius: 4px;
                    padding: 7px 10px; font-size: 0.78em; font-family: 'Cascadia Code', 'Fira Mono', monospace;
                    color: #999; word-break: break-all;
                }
                #chess-ai-localModal input[type="text"] { width: 100%; font-size: 0.83em; }
                #chess-ai-localModal select { width: 100%; }

                /* ── Eval bar ── */
                #chess-ai-eval-bar {
                    position: fixed; top: 50%; transform: translateY(-50%);
                    width: ${W}px; height: ${H}px; background: #2d2d2d; border: 1px solid #444;
                    border-radius: 7px; z-index: 9999; overflow: hidden;
                }
                #chess-ai-eval-bar.left { left: 10px; }
                #chess-ai-eval-bar.right { right: 10px; }
                #chess-ai-eval-fill {
                    position: absolute; bottom: 0; left: 0; right: 0;
                    background: linear-gradient(to top, #4ec9b0, #6fd9c0); transition: height 0.3s ease;
                }
                #chess-ai-eval-text {
                    position: absolute; top: 5px; left: 0; right: 0; text-align: center;
                    font-size: 11px; font-weight: bold; color: #e0e0e0; text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                }

                /* ── Thinking indicator ── */
                #chess-ai-thinking {
                    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                    background: rgba(30,30,30,0.9); padding: 10px 20px; border-radius: 20px;
                    border: 1px solid var(--bot-p); color: var(--bot-p); font-size: 14px; z-index: 9999; display: none;
                }
                #chess-ai-thinking .spinner {
                    display: inline-block; width: 16px; height: 16px; border: 2px solid var(--bot-p);
                    border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;
                    margin-right: 10px; vertical-align: middle;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .chess-ai-hidden { display: none !important; }
            `;
            document.head.appendChild(style);
        },

        createPanel() {
            this.panel = document.createElement('div');
            this.panel.id = 'chess-ai-panel';
            const s = Settings;
            this.panel.innerHTML = `
                <div id="chess-ai-panelHeader">
                    <div class="header-left">
                        <span>SF Engine</span>
                        <span id="chess-ai-minBtn">\u2715</span>
                    </div>
                    <button id="chess-ai-btnReset">Reset Defaults</button>
                </div>
                <div id="chess-ai-panelContent">
                    <div id="chess-ai-statusBox"></div>
                    <div id="chess-ai-moveResult"></div>

                    <div class="sect">
                        <div class="sect-title">Engine</div>
                        <div class="row">
                            <label>Model</label>
                            <select id="chess-ai-engine" style="width:200px;">
                                <option value="auto" ${s.get('preferredEngine') === 'auto' ? 'selected' : ''}>SF 18.0.0 — Cloud (fast)</option>
                                <option value="wasm" ${s.get('preferredEngine') === 'wasm' ? 'selected' : ''}>SF 17.1.0 — Cloud (variable)</option>
                                <option value="local" ${s.get('preferredEngine') === 'local' ? 'selected' : ''}>SF — Local (offline)</option>
                            </select>
                        </div>
                        <div class="row">
                            <label>Depth <span style="color:#666;">(max <span id="chess-ai-lblMaxDepth">20</span>)</span></label>
                            <input type="number" id="chess-ai-depth" min="1" max="20" value="${s.get('engineDepth')}">
                        </div>
                        <div class="row">
                            <label>Max Time (ms)</label>
                            <input type="number" id="chess-ai-movetime" value="${s.get('engineMovetime')}">
                        </div>
                        <div class="row">
                            <label>Skill (0–20)</label>
                            <input type="number" id="chess-ai-skill" min="0" max="20" value="${s.get('skillLevel')}" style="width:60px;">
                        </div>
                        <div class="row">
                            <label>Search Moves</label>
                            <input type="text" id="chess-ai-search" value="${s.get('searchMoves')}" placeholder="e.g. e2e4 d2d4">
                        </div>
                    </div>

                    <div class="sect">
                        <div class="pv-header">
                            <div class="sect-title" style="margin:0;">PV Arrows</div>
                            <input type="checkbox" id="chess-ai-pvEnabled" ${s.get('showPVArrows') ? 'checked' : ''}>
                        </div>
                        <div id="chess-ai-pvSettings" style="${s.get('showPVArrows') ? 'display:flex;' : 'display:none;'} flex-direction:column; gap:7px;">
                            <div class="row">
                                <label>Depth (1–45)</label>
                                <div class="slider-group">
                                    <input type="range" id="chess-ai-pvDepth" min="1" max="45" step="1" value="${s.get('pvDepth')}">
                                    <input type="number" id="chess-ai-pvDepthNum" min="1" max="45" value="${s.get('pvDepth')}">
                                </div>
                            </div>
                            <div class="row">
                                <label>Show Numbers</label>
                                <input type="checkbox" id="chess-ai-pvNums" ${s.get('pvShowNumbers') ? 'checked' : ''}>
                            </div>
                            <div class="row">
                                <label>Custom Gradient</label>
                                <input type="checkbox" id="chess-ai-pvGrad" ${s.get('pvCustomGradient') ? 'checked' : ''}>
                            </div>
                            <div id="chess-ai-pvGradSettings" style="${s.get('pvCustomGradient') ? 'display:flex;' : 'display:none;'} padding-left:10px; border-left:2px solid #333; margin-top:3px; flex-direction:column; gap:6px;">
                                <div class="row"><label>Start Color</label><input type="color" id="chess-ai-pvStart" value="${s.get('pvStartColor')}"></div>
                                <div class="row"><label>End Color</label><input type="color" id="chess-ai-pvEnd" value="${s.get('pvEndColor')}"></div>
                            </div>
                        </div>
                    </div>

                    <div class="sect">
                        <div class="sect-title">Automation</div>
                        <div class="auto-checks">
                            <label><input type="checkbox" id="chess-ai-enabled" ${s.get('enabled') ? 'checked' : ''}> Auto-Analyze</label>
                            <label><input type="checkbox" id="chess-ai-autoplay-chk" ${s.get('autoPlay') ? 'checked' : ''}> Auto-Move</label>
                            <label><input type="checkbox" id="chess-ai-autoQueue" ${s.get('autoQueue') ? 'checked' : ''}> Auto-Queue</label>
                        </div>
                        <div class="auto-checks" style="margin-top:4px;">
                            <label><input type="checkbox" id="chess-ai-threatDet" ${s.get('threatDetection') ? 'checked' : ''}> Threat Detection</label>
                            <label><input type="checkbox" id="chess-ai-opening" ${s.get('useOpeningBook') ? 'checked' : ''}> Opening Book</label>
                            <label><input type="checkbox" id="chess-ai-timeMgmt" ${s.get('timeManagement') ? 'checked' : ''}> Time Management</label>
                        </div>
                        <div class="auto-checks" style="margin-top:4px;">
                            <label><input type="checkbox" id="chess-ai-humanizer" ${s.get('humanizer') ? 'checked' : ''}> Humanizer</label>
                        </div>
                        <div class="row" style="margin-top:4px;">
                            <label>Humanize Rate (%)</label>
                            <input type="number" id="chess-ai-humanizeRate" min="5" max="80" value="${s.get('humanizeRate')}" style="width:60px;">
                        </div>
                        <div class="auto-checks" style="margin-top:4px;">
                            <label><input type="checkbox" id="chess-ai-autoRematch" ${s.get('autoRematch') ? 'checked' : ''}> Auto-Rematch</label>
                        </div>
                    </div>

                    <div class="sect">
                        <div class="sect-title">Display</div>
                        <div class="row">
                            <label>Eval Bar</label>
                            <input type="checkbox" id="chess-ai-evalbar" ${s.get('showEvalBar') ? 'checked' : ''}>
                        </div>
                        <div class="row">
                            <label>Best Move</label>
                            <input type="checkbox" id="chess-ai-bestmove" ${s.get('showBestMove') ? 'checked' : ''}>
                        </div>
                        <div class="row">
                            <label>Move Highlights</label>
                            <input type="checkbox" id="chess-ai-moveHighlights" ${s.get('showMoveHighlights') ? 'checked' : ''}>
                        </div>
                    </div>

                    <div class="sect">
                        <div class="sect-title">Bullet Mode</div>
                        <button id="chess-ai-bullet" class="${s.get('bulletMode') ? 'bullet-active' : ''}">BULLET: ${s.get('bulletMode') ? 'ON' : 'OFF'}</button>
                        <div id="chess-ai-bullet-status" style="${s.get('bulletMode') ? 'display:block;' : ''}">
                            <span style="color: #f0ad4e;">BULLET MODE</span><br>
                            Workers: 2 (1 extra) | Target: 50ms<br>
                            Hash: 256MB | Delays: None
                        </div>
                    </div>

                    <div class="btn-row">
                        <button id="chess-ai-btnAnalyze">▶ Analyze</button>
                        <button id="chess-ai-btnRematch">🔄 Rematch</button>
                        <button id="chess-ai-custBtn">🎨 Visuals & Theme</button>
                        <button id="chess-ai-localBtn">⚙ Local Engine Settings</button>
                    </div>

                    <div class="sect">
                        <div class="row">
                            <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <input type="checkbox" id="chess-ai-debug" ${s.get('debugLogs') ? 'checked' : ''}> Debug Logs
                            </label>
                        </div>
                        <div id="chess-ai-debugArea" style="display:${s.get('debugLogs') ? 'flex' : 'none'}; flex-direction:column; gap:5px;">
                            <div class="log-box" id="chess-ai-sentCommand"></div>
                            <div class="log-box" id="chess-ai-receivedMsg"></div>
                        </div>
                    </div>

                    <div style="border-top: 1px solid var(--bot-b); padding-top: 8px; font-size: 11px; color: #888; text-align: center;">
                        <a href="https://github.com/aciokie/chess-ai-bot" target="_blank" style="color: var(--bot-p); text-decoration: none;">GitHub Repository</a>
                    </div>
                </div>
            `;
            document.body.appendChild(this.panel);

            this.createModals();
            this.bindPanelEvents();
            this.applyMenuPosition(s.get('menuPosition'));
            this.makePanelDraggable();
        },

        bindPanelEvents() {
            const S = Settings;
            const $ = id => document.getElementById(id);

            const simpleBind = (id, key) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { S.set(key, el.checked); this.onSettingChange(key, el.checked); });
            };
            const numBind = (id, key) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { const v = parseInt(el.value); if (!isNaN(v)) { S.set(key, v); this.onSettingChange(key, v); } });
            };

            // Engine
            simpleBind('chess-ai-enabled', 'enabled');
            numBind('chess-ai-depth', 'engineDepth');
            numBind('chess-ai-movetime', 'engineMovetime');
            numBind('chess-ai-skill', 'skillLevel');
            const engineSel = $('chess-ai-engine');
            if (engineSel) engineSel.addEventListener('change', () => { S.set('preferredEngine', engineSel.value); Engine.reloadEngine(); });
            const searchEl = $('chess-ai-search');
            if (searchEl) searchEl.addEventListener('change', () => { S.set('searchMoves', searchEl.value); });

            // PV Arrows
            simpleBind('chess-ai-pvEnabled', 'showPVArrows');
            if ($('chess-ai-pvEnabled')) $('chess-ai-pvEnabled').addEventListener('change', function() { $('chess-ai-pvSettings').style.display = this.checked ? 'flex' : 'none'; });
            const pvDepth = $('chess-ai-pvDepth');
            const pvDepthNum = $('chess-ai-pvDepthNum');
            if (pvDepth && pvDepthNum) {
                pvDepth.addEventListener('input', () => { pvDepthNum.value = pvDepth.value; });
                pvDepthNum.addEventListener('change', () => { pvDepth.value = pvDepthNum.value; S.set('pvDepth', parseInt(pvDepthNum.value)); });
            }
            simpleBind('chess-ai-pvNums', 'pvShowNumbers');
            simpleBind('chess-ai-pvGrad', 'pvCustomGradient');
            if ($('chess-ai-pvGrad')) $('chess-ai-pvGrad').addEventListener('change', function() { $('chess-ai-pvGradSettings').style.display = this.checked ? 'flex' : 'none'; });
            const pvStart = $('chess-ai-pvStart');
            const pvEnd = $('chess-ai-pvEnd');
            if (pvStart) pvStart.addEventListener('change', () => S.set('pvStartColor', pvStart.value));
            if (pvEnd) pvEnd.addEventListener('change', () => S.set('pvEndColor', pvEnd.value));

            // Automation
            simpleBind('chess-ai-autoplay-chk', 'autoPlay');
            simpleBind('chess-ai-autoQueue', 'autoQueue');
            simpleBind('chess-ai-threatDet', 'threatDetection');
            simpleBind('chess-ai-opening', 'useOpeningBook');
            simpleBind('chess-ai-timeMgmt', 'timeManagement');
            simpleBind('chess-ai-humanizer', 'humanizer');
            numBind('chess-ai-humanizeRate', 'humanizeRate');
            simpleBind('chess-ai-autoRematch', 'autoRematch');

            // Display
            simpleBind('chess-ai-evalbar', 'showEvalBar');
            simpleBind('chess-ai-bestmove', 'showBestMove');
            simpleBind('chess-ai-moveHighlights', 'showMoveHighlights');

            // Bullet
            $('chess-ai-bullet')?.addEventListener('click', () => BulletMode.toggle());

            // Action buttons
            $('chess-ai-btnAnalyze')?.addEventListener('click', () => Analysis.toggle());
            $('chess-ai-btnRematch')?.addEventListener('click', () => BoardManager.requestRematch());
            $('chess-ai-btnReset')?.addEventListener('click', () => { S.reset(); location.reload(); });
            $('chess-ai-custBtn')?.addEventListener('click', () => { $('chess-ai-modalOv').style.display = 'flex'; });
            $('chess-ai-localBtn')?.addEventListener('click', () => { $('chess-ai-localModalOv').style.display = 'flex'; });

            // Debug
            simpleBind('chess-ai-debug', 'debugLogs');
            if ($('chess-ai-debug')) $('chess-ai-debug').addEventListener('change', function() { $('chess-ai-debugArea').style.display = this.checked ? 'flex' : 'none'; });
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
            const chk = document.getElementById('chess-ai-autoplay-chk');
            if (chk) chk.checked = Settings.get('autoPlay');
        },

        updateAnalysisButton() {
            const btn = document.getElementById('chess-ai-btnAnalyze');
            if (btn) {
                btn.textContent = Analysis.active ? '⏹ Stop Analysis' : '▶ Analyze';
            }
        },

        updateBulletButton() {
            const btn = document.getElementById('chess-ai-bullet');
            const status = document.getElementById('chess-ai-bullet-status');
            if (btn) {
                btn.textContent = `BULLET: ${BulletMode.active ? 'ON' : 'OFF'}`;
                btn.className = BulletMode.active ? 'bullet-active' : '';
            }
            if (status) {
                status.style.display = BulletMode.active ? 'block' : 'none';
            }
        },

        createModals() {
            const s = Settings;
            const visType = s.get('visualType');

            // ── Visuals & Theme modal ──
            const modalOv = document.createElement('div');
            modalOv.id = 'chess-ai-modalOv';
            modalOv.innerHTML = `
            <div id="chess-ai-modal">
                <div class="modal-header"><h3>Visuals & Theme</h3><button id="chess-ai-closeModal">\u2715</button></div>
                <div class="modal-tabs">
                    <button class="tab-btn active" data-tab="1">Move Display</button>
                    <button class="tab-btn" data-tab="2">Menu Theme</button>
                </div>
                <div class="modal-content" id="chess-ai-tab-content-1">
                    <div class="row"><label>Display Mode</label>
                        <select id="chess-ai-visualType">
                            <option value="boxes" ${visType==='boxes'?'selected':''}>Boxes (original)</option>
                            <option value="arrow" ${visType==='arrow'?'selected':''}>Arrow Only</option>
                            <option value="path" ${visType==='path'?'selected':''}>Highlight Path</option>
                        </select>
                    </div>
                    <div id="chess-ai-optBoxes">
                        <div class="row"><label>Box Opacity</label><input type="range" id="chess-ai-boxOp" min="0" max="100" value="${s.get('innerOpacity')*100}"></div>
                        <div class="row"><label>Square Opacity</label><input type="range" id="chess-ai-sqOp" min="0" max="100" value="${s.get('outerOpacity')*100}"></div>
                    </div>
                    <div id="chess-ai-optArrow" style="display:none;">
                        <div class="row"><label>Arrow Opacity</label><input type="range" id="chess-ai-arrOp" min="0" max="100" value="${s.get('arrowOpacity')*100}"></div>
                        <div class="row"><label>Arrow Size</label><input type="range" id="chess-ai-arrSz" min="5" max="80" value="${s.get('arrowWidth')}"></div>
                    </div>
                    <div class="row"><label>BIAS: ${visType==='arrow'?'Arrow':'Depth'}</label><input type="range" id="chess-ai-gradBias" min="0" max="100" value="${s.get('gradientBias')}"><span id="chess-ai-gradBiasVal">${s.get('gradientBias')}</span></div>
                    <div class="row"><label>Custom Gradient</label><input type="checkbox" id="chess-ai-custGrad" ${s.get('pvCustomGradient')?'checked':''}></div>
                    <div id="chess-ai-gradOpts" style="${s.get('pvCustomGradient')?'display:block':'display:none'}">
                        <div class="row"><label>Start</label><input type="color" id="chess-ai-gradStart" value="${s.get('pvStartColor')}"></div>
                        <div class="row"><label>End</label><input type="color" id="chess-ai-gradEnd" value="${s.get('pvEndColor')}"></div>
                    </div>
                    <button id="chess-ai-toggleAdv" class="adv-toggle">\u25B6 Advanced Visuals</button>
                    <div class="adv-sect" id="chess-ai-advSect" style="display:none;">
                        <div class="row"><label>Outline Opacity</label><input type="range" id="chess-ai-outOp" min="0" max="100" value="${s.get('visualOutlineOpacity')*100}"></div>
                        <div class="row"><label>Outline Width</label><input type="range" id="chess-ai-outW" min="0" max="50" value="${s.get('visualOutlineWidth')}"></div>
                        <div class="row"><label>Outline Glow</label><input type="checkbox" id="chess-ai-outGlow" ${s.get('visualOutlineGlow')?'checked':''}></div>
                        <div class="row"><label>Glow Radius</label><input type="range" id="chess-ai-outRad" min="0" max="50" value="${s.get('visualOutlineGlowRadius')}"></div>
                    </div>
                    <div class="row"><label>Highlight Color</label><input type="color" id="chess-ai-hiColor" value="${s.get('highlightColor')}"></div>
                    <div class="row"><label>Hide after move</label><input type="checkbox" id="chess-ai-hideMove" ${s.get('hideAfterMove')?'checked':''}></div>
                </div>
                <div class="modal-content" id="chess-ai-tab-content-2" style="display:none">
                    <div class="theme-presets"><button id="chess-ai-themeDark">Dark</button><button id="chess-ai-themeLight">Light</button></div>
                    <div class="row"><label>Background</label><input type="color" id="chess-ai-themeBg" value="${s.get('themeBg')}"></div>
                    <div class="row"><label>Text</label><input type="color" id="chess-ai-themeText" value="${s.get('themeText')}"></div>
                    <div class="row"><label>Border</label><input type="color" id="chess-ai-themeBorder" value="${s.get('themeBorder')}"></div>
                    <div class="row"><label>Primary</label><input type="color" id="chess-ai-themePrimary" value="${s.get('themePrimary')}"></div>
                    <div class="row"><label>Menu Opacity</label><input type="range" id="chess-ai-menuOp" min="0" max="100" value="${s.get('menuOpacity')*100}"><span id="chess-ai-menuOpVal">${Math.round(s.get('menuOpacity')*100)}</span></div>
                    <div class="row"><label>Position</label><select id="chess-ai-menuPos">
                        <option value="top-right" ${s.get('menuPosition')==='top-right'?'selected':''}>Top-Right</option>
                        <option value="top-left" ${s.get('menuPosition')==='top-left'?'selected':''}>Top-Left</option>
                        <option value="bottom-right" ${s.get('menuPosition')==='bottom-right'?'selected':''}>Bottom-Right</option>
                        <option value="bottom-left" ${s.get('menuPosition')==='bottom-left'?'selected':''}>Bottom-Left</option>
                    </select></div>
                </div>
            </div>`;
            document.body.appendChild(modalOv);

            // ── Local Engine modal ──
            const localOv = document.createElement('div');
            localOv.id = 'chess-ai-localModalOv';
            localOv.innerHTML = `
            <div id="chess-ai-localModal">
                <div class="modal-header"><h3>Local Engine Settings</h3><button id="chess-ai-closeLocal">\u2715</button></div>
                <div class="modal-content">
                    <div class="row"><label>Model</label><select id="chess-ai-localModel">
                        <option value="sf_17.1_wasm" ${s.get('localEngineModel')==='sf_17.1_wasm'?'selected':''}>SF 17.1 — WASM</option>
                        <option value="sf_18.0_wasm" ${s.get('localEngineModel')==='sf_18.0_wasm'?'selected':''}>SF 18.0 — WASM</option>
                    </select></div>
                    <div class="info-box">Status: <span id="chess-ai-localStatus">Checking...</span></div>
                    <div style="display:flex; gap:8px; margin-top:8px;">
                        <button id="chess-ai-localInstall" class="local-action-btn local-btn-install">Install</button>
                        <button id="chess-ai-localReinstall" class="local-action-btn local-btn-reinstall">Reinstall</button>
                        <button id="chess-ai-localUninstall" class="local-action-btn local-btn-uninstall">Uninstall</button>
                    </div>
                    <div class="row" style="margin-top:10px;"><label>Hash (MB)</label><input type="number" id="chess-ai-localHash" min="1" max="1024" value="${s.get('localEngineHash')}"></div>
                    <div class="row"><label>Overhead (μs)</label><input type="number" id="chess-ai-localOverhead" min="0" max="500" value="${s.get('localEngineOverhead')}"></div>
                    <div class="row"><label>Skill Level</label><input type="number" id="chess-ai-localSkill" min="0" max="20" value="${s.get('skillLevel')}"></div>
                    <div class="info-box" style="margin-top:8px;">
                        JS: <a id="chess-ai-localJS" href="https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js" target="_blank" style="color:#81b64c;">CDN link</a><br>
                        WASM: <a id="chess-ai-localWASM" href="https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.wasm.js" target="_blank" style="color:#81b64c;">CDN link</a>
                    </div>
                </div>
            </div>`;
            document.body.appendChild(localOv);

            // Modal event handlers
            $('chess-ai-closeModal')?.addEventListener('click', () => { $('chess-ai-modalOv').style.display = 'none'; });
            $('chess-ai-closeLocal')?.addEventListener('click', () => { $('chess-ai-localModalOv').style.display = 'none'; });

            // Tabs
            document.querySelectorAll('#chess-ai-modal .tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('#chess-ai-modal .tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const tab = btn.dataset.tab;
                    $('chess-ai-tab-content-1').style.display = tab === '1' ? 'block' : 'none';
                    $('chess-ai-tab-content-2').style.display = tab === '2' ? 'block' : 'none';
                });
            });

            // Theme presets
            $('chess-ai-themeDark')?.addEventListener('click', () => {
                S.set('themeBg','#222222'); S.set('themeText','#eeeeee'); S.set('themeBorder','#444444'); S.set('themePrimary','#81b64c');
                location.reload();
            });
            $('chess-ai-themeLight')?.addEventListener('click', () => {
                S.set('themeBg','#f0f0f0'); S.set('themeText','#111111'); S.set('themeBorder','#cccccc'); S.set('themePrimary','#2e7d32');
                location.reload();
            });

            // Color pickers
            [['chess-ai-themeBg','themeBg'],['chess-ai-themeText','themeText'],['chess-ai-themeBorder','themeBorder'],['chess-ai-themePrimary','themePrimary'],['chess-ai-hiColor','highlightColor']].forEach(([id,key]) => {
                $(id)?.addEventListener('change', () => { S.set(key, $(id).value); location.reload(); });
            });

            // Highlight color RGB inputs
            const hiRGB = s.get('highlightColor');
            const hex2rgb = hex => { const m = hex.match(/\w\w/g); return m ? m.map(x => parseInt(x, 16)) : [0,238,255]; };
            const rgb = hex2rgb(hiRGB);
            [['r','0'],['g','1'],['b','2']].forEach(([c,i]) => {
                const el = $(`chess-ai-hi${c.toUpperCase()}`);
                if (el) { el.value = rgb[i]; el.addEventListener('change', () => { const r = parseInt($('chess-ai-hiR').value)||0, g = parseInt($('chess-ai-hiG').value)||0, b = parseInt($('chess-ai-hiB').value)||0; S.set('highlightColor', `#${(1<<24|r<<16|g<<8|b).toString(16).slice(1).padStart(6,'0')}`); }); }
            });

            // Opacity sliders
            const bindOp = (id, key, numId) => {
                $(id)?.addEventListener('input', () => { const v = parseInt($(id).value)/100; S.set(key, v); $(numId).textContent = Math.round(v*100); });
            };
            bindOp('chess-ai-menuOp','menuOpacity','chess-ai-menuOpVal');
            bindOp('chess-ai-boxOp','innerOpacity','chess-ai-boxOpVal');
            bindOp('chess-ai-sqOp','outerOpacity','chess-ai-sqOpVal');
            bindOp('chess-ai-arrOp','arrowOpacity','chess-ai-arrOpVal');
            bindOp('chess-ai-arrSz','arrowWidth','chess-ai-arrSzVal');
            bindOp('chess-ai-gradBias','gradientBias','chess-ai-gradBiasVal');
            bindOp('chess-ai-outOp','visualOutlineOpacity','chess-ai-outOpVal');
            bindOp('chess-ai-outW','visualOutlineWidth','chess-ai-outWVal');
            bindOp('chess-ai-outRad','visualOutlineGlowRadius','chess-ai-outRadVal');

            // Visual type switch
            $('chess-ai-visualType')?.addEventListener('change', function() {
                S.set('visualType', this.value);
                $('chess-ai-optBoxes').style.display = this.value==='boxes'?'block':'none';
                $('chess-ai-optArrow').style.display = this.value==='arrow'?'block':'none';
            });

            // Advanced toggle
            $('chess-ai-toggleAdv')?.addEventListener('click', () => {
                const sec = $('chess-ai-advSect');
                const tog = $('chess-ai-toggleAdv');
                if (sec.style.display==='none') { sec.style.display='flex'; tog.textContent='\u25BC Advanced Visuals'; } else { sec.style.display='none'; tog.textContent='\u25B6 Advanced Visuals'; }
            });

            // Outline glow
            $('chess-ai-outGlow')?.addEventListener('change', function() { S.set('visualOutlineGlow', this.checked); });

            // Gradient options
            $('chess-ai-custGrad')?.addEventListener('change', function() {
                S.set('pvCustomGradient', this.checked);
                $('chess-ai-gradOpts').style.display = this.checked ? 'block' : 'none';
            });
            $('chess-ai-gradStart')?.addEventListener('change', function() { S.set('pvStartColor', this.value); });
            $('chess-ai-gradEnd')?.addEventListener('change', function() { S.set('pvEndColor', this.value); });

            // Hide after move
            $('chess-ai-hideMove')?.addEventListener('change', function() { S.set('hideAfterMove', this.checked); });

            // Menu position
            $('chess-ai-menuPos')?.addEventListener('change', function() {
                S.set('menuPosition', this.value);
                UI.applyMenuPosition(this.value);
            });

            // Close overlays on outside click
            modalOv.addEventListener('click', e => { if (e.target === modalOv) modalOv.style.display = 'none'; });
            localOv.addEventListener('click', e => { if (e.target === localOv) localOv.style.display = 'none'; });
        },

        applyMenuPosition(pos) {
            const panel = this.panel;
            if (!panel) return;
            panel.style.top = panel.style.right = panel.style.bottom = panel.style.left = '';
            switch (pos) {
                case 'top-right':    panel.style.top = '20px'; panel.style.right = '20px'; break;
                case 'top-left':     panel.style.top = '20px'; panel.style.left = '20px'; break;
                case 'bottom-right': panel.style.bottom = '20px'; panel.style.right = '20px'; break;
                case 'bottom-left':  panel.style.bottom = '20px'; panel.style.left = '20px'; break;
            }
        },

        makePanelDraggable() {
            const panel = this.panel;
            if (!panel) return;
            const header = panel.querySelector('#chess-ai-panelHeader');
            if (!header) return;
            let isDragging = false, startX, startY, origLeft, origTop;
            const onMouseMove = e => {
                if (!isDragging) return;
                e.preventDefault();
                const dx = e.clientX - startX, dy = e.clientY - startY;
                panel.style.left = (origLeft + dx) + 'px';
                panel.style.top  = (origTop  + dy) + 'px';
                panel.style.right = panel.style.bottom = 'auto';
            };
            const onMouseUp = () => { isDragging = false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); panel.style.userSelect = ''; };
            header.addEventListener('mousedown', e => {
                if (e.target.id === 'chess-ai-minBtn') return;
                isDragging = true; startX = e.clientX; startY = e.clientY;
                const rect = panel.getBoundingClientRect();
                origLeft = rect.left; origTop = rect.top;
                panel.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
            $('chess-ai-minBtn')?.addEventListener('click', () => { panel.classList.toggle('chess-ai-hidden'); });
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
        log('Chess AI Bot v11.2.0 starting...');

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