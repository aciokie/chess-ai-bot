// ==UserScript==
// @name Chess AI Bot
// @namespace http://tampermonkey.net/
// @version       11.0.4
// @description   Stable branch from the working original script, with Lichess platform support and the fixed worker bootstrap.
// @author        Ech0
// @author        ACIOKIEPRO
// @updateURL     https://cdn.jsdelivr.net/gh/aciokie/chess-ai-bot@main/chess-ai-bot.user.js
// @downloadURL   https://cdn.jsdelivr.net/gh/aciokie/chess-ai-bot@main/chess-ai-bot.user.js
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
    // --- CONFIGURATION ---
    const CONFIG = {
        BOARD_SEL: "chess-board, wc-chess-board, cg-board, lichess-board",
        LOOP_MS: 50,
        BACKUP_POLL_MIN_MS: 2000,
        BACKUP_POLL_MAX_MS: 5000,
        API: { MAX_DEPTH: 18, MAX_TIME: 100 }
    };
    
    // --- PLATFORM DETECTION ---
    const Platform = {
        current: null,
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
            switch (Platform.current) {
                case 'lichess':
                    return '.cg-wrap.manipulable cg-board, .cg-wrap.manipulable lichess-board, cg-board, lichess-board';
                case 'chess.com':
                default:
                    return 'chess-board, wc-chess-board';
            }
        },

        getBoard: () => document.querySelector(Platform.getBoardSelectors()),

        // Get the chessground instance from a Lichess board element
        getLichessChessground: (board) => {
            if (!board) return null;
            // Lichess stores chessground instance in a WeakMap or directly on the element.
            // Try the direct attributes first, then the global board reference.
            const direct = board.chessground || board._chessground || board.__chessground;
            if (direct) return direct;
            if (window.domData && typeof window.domData.get === 'function') {
                const domCg = window.domData.get(board, 'chessground');
                if (domCg) return domCg;
            }
            const fallbackBoard = Platform.getBoard();
            return fallbackBoard ? (fallbackBoard.chessground || fallbackBoard._chessground || fallbackBoard.__chessground || null) : null;
        },

        normalizeLichessFEN: (fen, cg) => {
            if (!fen) return null;
            const clean = String(fen).trim();
            const parts = clean.split(/\s+/);
            if (parts.length >= 6) return clean;

            // Some chessground builds expose only the piece placement portion.
            // Build a valid full FEN from the actual side-to-move state when needed.
            const turn = (cg?.state?.turnColor || 'white') === 'white' ? 'w' : 'b';
            if (parts.length === 1) return `${clean} ${turn} - - 0 1`;

            // Fallback: if the string is already piece + turn but missing trailing fields.
            if (parts.length >= 2) return `${parts[0]} ${parts[1]} - - 0 1`;
            return null;
        },

        getLichessPageFEN: () => {
            const fenPattern = /^[prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7}\s+[wb](?:\s+[^\s]+){4,}$/;
            return Array.from(document.querySelectorAll('input, textarea'))
                .map(element => element.value || element.textContent || '')
                .find(value => fenPattern.test(String(value).trim())) || null;
        },

        getLichessOrientation: (board) => {
            const wrapper = board?.closest?.('.cg-wrap');
            return wrapper?.classList.contains('orientation-black') ? 'black' : 'white';
        },

        getLichessDomFEN: (board) => {
            const pieces = board?.querySelectorAll?.('piece') || document.querySelectorAll('cg-board piece');
            if (!pieces.length) return null;
            const orientation = Platform.getLichessOrientation(board);
            const placement = Array.from({ length: 8 }, () => Array(8).fill(null));
            const pieceNames = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
            for (const piece of pieces) {
                const names = [...piece.classList];
                const color = names.includes('white') ? 'white' : names.includes('black') ? 'black' : null;
                const type = names.find(name => pieceNames[name]);
                if (!color || !type) continue;
                const boardRect = board.getBoundingClientRect();
                const pieceRect = piece.getBoundingClientRect();
                const squareWidth = boardRect.width / 8;
                const squareHeight = boardRect.height / 8;
                if (squareWidth && squareHeight && pieceRect.width && pieceRect.height) {
                    const centerX = pieceRect.left + pieceRect.width / 2;
                    const centerY = pieceRect.top + pieceRect.height / 2;
                    const displayFile = Math.floor((centerX - boardRect.left) / squareWidth);
                    const displayRank = Math.floor((centerY - boardRect.top) / squareHeight);
                    const file = orientation === 'black' ? 7 - displayFile : displayFile;
                    const rankFromTop = orientation === 'black' ? 7 - displayRank : displayRank;
                    if (file >= 0 && file <= 7 && rankFromTop >= 0 && rankFromTop <= 7) {
                        placement[rankFromTop][file] = color === 'white' ? pieceNames[type].toUpperCase() : pieceNames[type];
                    }
                    continue;
                }
                const transform = piece.style.transform || getComputedStyle(piece).transform || '';
                const percentMatch = transform.match(/translate(?:3d)?\(\s*(-?\d+(?:\.\d+)?)%[, ]+\s*(-?\d+(?:\.\d+)?)%/);
                const matrixMatch = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
                const match = percentMatch || matrixMatch;
                if (!match) continue;
                let displayFile, displayRank;
                if (percentMatch) {
                    displayFile = Math.round(parseFloat(percentMatch[1]) / 12.5);
                    displayRank = Math.round(parseFloat(percentMatch[2]) / 12.5);
                } else {
                    const values = matrixMatch[1].split(',').map(Number);
                    const x = matrixMatch[0].startsWith('matrix3d') ? values[12] : values[4];
                    const y = matrixMatch[0].startsWith('matrix3d') ? values[13] : values[5];
                    const width = board.clientWidth / 8;
                    const height = board.clientHeight / 8;
                    if (!Number.isFinite(x) || !Number.isFinite(y) || !width || !height) continue;
                    displayFile = Math.round(x / width);
                    displayRank = Math.round(y / height);
                }
                const file = orientation === 'black' ? 7 - displayFile : displayFile;
                const rankFromTop = orientation === 'black' ? 7 - displayRank : displayRank;
                if (file < 0 || file > 7 || rankFromTop < 0 || rankFromTop > 7) continue;
                const symbol = color === 'white' ? pieceNames[type].toUpperCase() : pieceNames[type];
                placement[rankFromTop][file] = symbol;
            }
            const rows = placement.map(row => {
                let fenRow = '', empty = 0;
                for (const piece of row) {
                    if (!piece) empty++;
                    else { if (empty) fenRow += empty; empty = 0; fenRow += piece; }
                }
                if (empty) fenRow += empty;
                return fenRow;
            });
            if (rows.some(row => !row)) return null;
            const turn = Platform.getLichessTurnFromPage(board) === 1 ? 'w' : 'b';
            return `${rows.join('/')} ${turn} - - 0 1`;
        },

        getLichessTurnFromPage: (board) => {
            const cg = Platform.getLichessChessground(board);
            const candidates = [
                cg?.state?.fen,
                window.lichess?.analysis?.node?.fen,
                window.lichess?.analysis?.tree?.root?.fen,
                window.lichess?.round?.data?.game?.fen,
                window.lichess?.round?.data?.game?.turn,
                window.lichess?.game?.data?.game?.fen,
                window.lichess?.data?.game?.fen,
                board?.dataset?.fen,
                board?.dataset?.state
            ];
            for (const candidate of candidates) {
                if (!candidate) continue;
                const text = String(candidate).trim();
                const fenTurn = text.match(/\s([wb])\s/);
                if (fenTurn) return fenTurn[1] === 'w' ? 1 : 2;
                if (text === 'w' || text === 'white') return 1;
                if (text === 'b' || text === 'black') return 2;
                const stateTurn = text.split(',')[1];
                if (stateTurn === 'white' || stateTurn === 'w') return 1;
                if (stateTurn === 'black' || stateTurn === 'b') return 2;
            }
            if (cg?.state?.turnColor) return cg.state.turnColor === 'white' ? 1 : 2;
            const turnClocks = [...document.querySelectorAll('.rclock-turn')];
            const activeClock = turnClocks.find(clock => /your turn|opponent|thinking/i.test(clock.textContent || '')) || document.querySelector('.clock.turn, .game-turn');
            if (activeClock) {
                const activeClasses = `${activeClock.className} ${activeClock.parentElement?.className || ''}`;
                if (/Your turn/i.test(activeClock.textContent || '')) return Platform.getLichessPlayerColor(board);
                if (/black|top/i.test(activeClasses)) return 2;
                if (/white|bottom/i.test(activeClasses)) return 1;
            }
            return null;
        },

        getLichessPlayerColor: (board) => {
            // 1. Get player color from Lichess API (GROUND TRUTH)
            const apiColor = window.lichess?.data?.player?.color 
                          || window.lichess?.round?.data?.player?.color 
                          || window.lichess?.round?.data?.playerColor
                          || window.lichess?.game?.data?.player?.color;
            console.log('[SF Engine] Lichess: API player color:', apiColor);
            
            let playerColor = null;
            if (apiColor === 'white' || apiColor === 'w') playerColor = 1;
            else if (apiColor === 'black' || apiColor === 'b') playerColor = 2;
            
            // 2. Cross-check with chessground orientation for sanity
            const cg = Platform.getLichessChessground(board);
            if (cg?.state?.orientation && playerColor !== null) {
                const boardOrientation = cg.state.orientation; // 'white' or 'black' - color at bottom
                const isFlipped = (playerColor === 1 && boardOrientation === 'black') || 
                                  (playerColor === 2 && boardOrientation === 'white');
                console.log('[SF Engine] Lichess: Board orientation:', boardOrientation, '| Player:', playerColor === 1 ? 'WHITE' : 'BLACK', '| Flipped:', isFlipped);
                
                // If board pieces visually confirm
                if (cg?.state?.pieces) {
                    let blackOnRank1 = false;
                    for (const [key, piece] of Object.entries(cg.state.pieces)) {
                        if (key.startsWith('1') && piece.color === 'black') {
                            blackOnRank1 = true;
                            break;
                        }
                    }
                    const visualColor = blackOnRank1 ? 2 : 1;
                    const visualMatches = visualColor === playerColor;
                    console.log('[SF Engine] Lichess: Visual check - blackOnRank1:', blackOnRank1, '->', visualColor === 1 ? 'WHITE' : 'BLACK', '| Matches API:', visualMatches);
                    
                    // If visual contradicts API, log warning but trust API (server knows your color)
                    if (!visualMatches) {
                        console.warn('[SF Engine] Lichess: Visual pieces contradict API! Trusting API.');
                    }
                }
            }
            
            // 3. Fallback: if no API, try to infer from orientation + visual
            if (playerColor === null && cg?.state?.orientation) {
                // This is unreliable without API - orientation could be flipped by user preference
                console.warn('[SF Engine] Lichess: No API color, orientation-only detection is unreliable');
                // Try visual pieces as last resort
                if (cg?.state?.pieces) {
                    let blackOnRank1 = false;
                    for (const [key, piece] of Object.entries(cg.state.pieces)) {
                        if (key.startsWith('1') && piece.color === 'black') {
                            blackOnRank1 = true;
                            break;
                        }
                    }
                    playerColor = blackOnRank1 ? 2 : 1;
                    console.log('[SF Engine] Lichess: Fallback visual detection:', playerColor === 1 ? 'WHITE' : 'BLACK');
                }
            }
            
            return playerColor; // Can be null if detection fails
        },

        getFEN: (board) => {
            if (!board) return null;
            switch (Platform.current) {
                case 'lichess': {
                    const cg = Platform.getLichessChessground(board);
                    const candidates = [
                        cg?.state?.fen,
                        cg?.getFen?.(),
                        Platform.getLichessPageFEN(),
                        board?.dataset?.fen,
                        board?.dataset?.state?.split(',')[0],
                        Platform.getBoard()?.dataset?.fen,
                        Platform.getBoard()?.dataset?.state?.split(',')[0]
                    ];

                    for (const candidate of candidates) {
                        const normalized = Platform.normalizeLichessFEN(candidate, cg);
                        if (normalized) return normalized;
                    }

                    const domFEN = Platform.getLichessDomFEN(board);
                    if (domFEN) return domFEN;

                    // Final fallback: use the active board state if the engine exposes it.
                    if (window.lichess?.analysis?.getFen) {
                        const fen = window.lichess.analysis.getFen();
                        const normalized = Platform.normalizeLichessFEN(fen, cg);
                        if (normalized) return normalized;
                    }
                    return null;
                }
                case 'chess.com':
                default:
                    if (typeof board.game?.getFEN === 'function') return board.game.getFEN();
                    if (typeof board.game?.fen === 'string') return board.game.fen;
                    if (board.game?.getPosition) return board.game.getPosition();
                    return null;
            }
        },

        getTurn: (board) => {
            if (!board) return null;
            switch (Platform.current) {
                case 'lichess': {
                    const cg = Platform.getLichessChessground(board);
                    const fen = Platform.normalizeLichessFEN(cg?.state?.fen || cg?.getFen?.() || Platform.getLichessPageFEN() || board?.dataset?.fen || board?.dataset?.state?.split(',')[0], cg);
                    if (fen) {
                        const parts = fen.trim().split(/\s+/);
                        if (parts.length >= 2) return parts[1] === 'w' ? 1 : 2;
                    }
                    const domFen = Platform.getLichessDomFEN(board);
                    if (domFen) return domFen.split(/\s+/)[1] === 'w' ? 1 : 2;
                    return Platform.getLichessTurnFromPage(board);
                }
                case 'chess.com':
                default:
                    return board.game?.getTurn?.();
            }
        },

        getPlayingAs: (board) => {
            if (!board) return null;
            switch (Platform.current) {
                case 'lichess': {
                    return Platform.getLichessPlayerColor(board);
                }
                case 'chess.com':
                default:
                    return board.game?.getPlayingAs?.();
            }
        },

        getLegalMoves: (board) => {
            if (!board) return [];
            switch (Platform.current) {
                case 'lichess': {
                    const cg = Platform.getLichessChessground(board);
                    if (cg && cg.state?.movable?.dests) {
                        // Convert chessground dests map to move array
                        const moves = [];
                        cg.state.movable.dests.forEach((dests, orig) => {
                            dests.forEach(dest => {
                                moves.push({ from: orig, to: dest });
                            });
                        });
                        return moves;
                    }
                    return [];
                }
                case 'chess.com':
                default:
                    return board.game?.getLegalMoves?.() || [];
            }
        },

        makeMove: (board, move, promotion = 'q') => {
            if (!board) return false;
            switch (Platform.current) {
                case 'lichess': {
                    const uci = `${move.from}${move.to}${move.promotion && move.promotion !== 'q' ? move.promotion : ''}`;
                    if (typeof window.lichess?.analysis?.playUci === 'function') {
                        window.lichess.analysis.playUci(uci, []);
                        return true;
                    }
                    const cg = Platform.getLichessChessground(board);
                    if (cg) {
                        // chessground.move takes from and to squares
                        cg.move(move.from, move.to);
                        // Handle promotion if needed
                        if (move.promotion && move.promotion !== 'q') {
                            // Promotion handled by chessground automatically in most cases
                        }
                        return true;
                    }
                    const rect = board.getBoundingClientRect();
                    if (!rect.width || !rect.height) return false;
                    const orientation = Platform.getLichessOrientation(board);
                    const clickSquare = (square) => {
                        const file = square.charCodeAt(0) - 97;
                        const rank = parseInt(square.charAt(1), 10) - 1;
                        if (file < 0 || file > 7 || rank < 0 || rank > 7) return false;
                        const x = orientation === 'black' ? 7 - file : file;
                        const y = orientation === 'black' ? rank : 7 - rank;
                        const eventInit = { bubbles: true, cancelable: true, clientX: rect.left + (x + 0.5) * rect.width / 8, clientY: rect.top + (y + 0.5) * rect.height / 8 };
                        const target = document.elementFromPoint(eventInit.clientX, eventInit.clientY) || board;
                        if (typeof PointerEvent === 'function') {
                            const pointerInit = { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 };
                            target.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
                            target.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
                        }
                        target.dispatchEvent(new MouseEvent('mousedown', eventInit));
                        target.dispatchEvent(new MouseEvent('mouseup', eventInit));
                        target.dispatchEvent(new MouseEvent('click', eventInit));
                        return true;
                    };
                    return clickSquare(move.from) && clickSquare(move.to);
                }
                case 'chess.com':
                default:
                    if (board.game?.move) {
                        return board.game.move({ ...move, promotion, animate: true, userGenerated: true });
                    }
                    return false;
            }
        },

        isFlipped: (board) => {
            if (!board) return false;
            switch (Platform.current) {
                case 'lichess': {
                    const cg = Platform.getLichessChessground(board);
                    if (cg) {
                        return cg.state?.orientation === 'black';
                    }
                    return board.classList.contains('flipped') || board.dataset?.orientation === 'black';
                }
                case 'chess.com':
                default:
                    if (board.classList.contains('flipped')) return true;
                    if (board.game?.getPlayingAs?.() === 'b' || board.game?.getPlayingAs?.() === 2) return true;
                    return false;
            }
        }
    };

    // Initialize platform detection
    Platform.init();

    // Initialize Lichess player color once when page loads
    if (Platform.isLichess?.()) {
        setTimeout(() => {
            lichessState.initPlayerColor();
            console.log('[SF Engine] Lichess: Initialization complete. Ready for analysis.');
        }, 1500);  // Wait for Lichess to fully load
    }

    // --- EXA SEARCH INTEGRATION ---
    // Exa AI web search for opening lookup, player stats, etc.
    const ExaSearch = {
        apiKey: '',
        baseUrl: 'https://api.exa.ai',
        
        init: () => {
            ExaSearch.apiKey = settings.exaApiKey || GM_getValue('exaApiKey', '');
        },
        
        setApiKey: (key) => {
            ExaSearch.apiKey = key;
            GM_setValue('exaApiKey', key);
        },
        
        search: async (query, options = {}) => {
            if (!ExaSearch.apiKey) {
                console.warn('[ExaSearch] No API key set. Use ExaSearch.setApiKey() to configure.');
                return { results: [], error: 'No API key' };
            }
            
            const defaults = {
                type: 'auto',
                numResults: 5,
                contents: { highlights: true, text: { maxCharacters: 2000 } },
                ...options
            };
            
            try {
                const response = await fetch(`${ExaSearch.baseUrl}/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ExaSearch.apiKey}`
                    },
                    body: JSON.stringify({ query, ...defaults })
                });
                
                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(`Exa API error: ${response.status} ${err}`);
                }
                
                return await response.json();
            } catch (e) {
                console.error('[ExaSearch] Search failed:', e);
                return { results: [], error: e.message };
            }
        },
        
        // Search for opening information
        searchOpening: async (fen, move) => {
            const query = `chess opening ${move} FEN ${fen.split(' ')[0]} best moves theory`;
            return ExaSearch.search(query, { 
                numResults: 3,
                includeDomains: ['chess.com', 'lichess.org', 'wikipedia.org', 'chessable.com']
            });
        },
        
        // Search for player information
        searchPlayer: async (username, platform) => {
            const query = `${username} chess rating profile ${platform}`;
            return ExaSearch.search(query, { 
                numResults: 3,
                includeDomains: ['chess.com', 'lichess.org', 'chessgames.com']
            });
        },
        
        // Search for endgame theory
        searchEndgame: async (fen) => {
            const query = `chess endgame theory ${fen.split(' ')[0]} tablebase`;
            return ExaSearch.search(query, { 
                numResults: 3,
                includeDomains: ['lichess.org', 'chess.com', 'syzygy-tables.info', 'wikipedia.org']
            });
        }
    };
    
    const PIECE_IMGS = {
        p: "https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg",
        r: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg",
        n: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg",
        b: "https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg",
        q: "https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg",
        k: "https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg",
        P: "https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg",
        R: "https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg",
        N: "https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg",
        B: "https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg",
        Q: "https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg",
        K: "https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg",
    };
    const STOCKFISH_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAEGklEQVR4nO2ZW2gcVRjH/9+Z3ewm22xMNtVGU9RIxNqmFxF8sC0iFhF8UF980QcFL1jwaRELXnwQBC94UfBBEQtK0Yqi1LwgaL0k0DQm2zapm2az2d1kd2bO8f/M7Gw22U12052lB34wzMzO+Z/vO+d85ztnlkQIIYQQQgghhBBCSKtQSt1BCHmOEDKplLqD53n7x8fH9xBCfC2U0r2EkNcIIY/xPG9rIR4F8CGl9EEA+wghG5s9+yGl9F0A+9sKEEJ8B+A5AMcIIb6W/v8B4BCl9AkA+1oK8Ty/m1L6LID9hJCNzb7ZhRL6IoD9bQcopc8SQp4ghExt9mw/pfR5APtbcwH1C68W/l8B3wO463+xAOu5gH2EkG2EENSX8F4A+wkhG7mA+l3gVwD3tBCAUvoYIeQpQkh/s2f7KaVPAthfFw/4HsA+QsjGZt/sJ5Q+01oArvN9Qkh/s2f7KaWPE0L2112Au8D3AO4jhGxs9u0+SulTAPbXFfA9gP2EkI3NvttPKX0KwP66Ar4HsJ8QsrHZd/sppU8C2F9XwPcA9hNCNjb7bj+l9CkA++sK+B7AfYSQjc2+208pfQrA/rYClNI9hJCnCCHTmz3bTyl9CsD+tgOU0mcIIU8RQqY3e7afUvo0gP1tBSilz1BKnwGwv60A/H8uQAh5DsB+QsjGZt98Qil9DsD+1gKU0ucIIc8QQqY2e7afUvo8gP2tBaij0N8A7iOEbGz23X5K6fMA9tcV8D2A+wghG5t9t59S+iSA/XUFfA9gPyFkY7Pv9lNKTwLYX1fA9wDuI4RsbPbd/v8U4H/fA0II8Ty/mxDiA7C/Lh7wPID9hJCNzb7dTyl9EcD+ungA8Ty/mxDiA7C/pQCldC+l9EUA+1sK8Ty/hxDya0rpCwD2txTg/7kAIeR5APtbut8ghBBC2pZ/ALy683b5qZ2oAAAAAElFTkSuQmCC";

    const DEFAULT_WASM_URL = "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.wasm";

    // ─── Local Engine Registry ──
    // Each entry describes one loadable local engine variant.
    //
    // format:
    //   "wasm-patched"  → SF 18/17/16/15/14/12 style: fetch JS via GM_getResourceText
    //                     (or fall back to XHR if jsUrl is provided), fetch WASM via
    //                     GM_xmlhttpRequest, patch self.fetch, build Worker from Blob.
    //   "asmjs"         → SF 9/10 style: pure asm.js, load JS via XHR,
    //                     create Worker directly — no WASM involved at all.
    //
    // caps:
    //   maxDepth        → UI depth cap for this model
    //   hasNNUE         → whether UCI_LimitStrength/Elo is supported
    //   hasSkillLevel   → whether Skill Level UCI option exists
    //   hasSlowMover    → whether Slow Mover UCI option exists (removed in SF 17)
    //   hasWDL          → whether UCI_ShowWDL is supported (SF 12+)
    //   hasHash         → Hash table option (all versions)
    //   hasMoveOverhead → Move Overhead option (all SF 9+ versions)
    //   hasContempt     → Contempt option (removed in SF 14)
    //   hasMinThink     → Minimum Thinking Time option (SF 11 and older only)
    //
    // ── Local Engine Registry ────────────────────────────────────────────────
    // Only 5 confirmed-working models. Each has a complete caps map so every
    // UCI option, UI row, and per-model saved setting is driven from here.
    //
    // format: "wasm"  → JS + WASM fetched via XHR, self.fetch patched, Worker Blob
    //         "asmjs" → single stockfish.js from cdnjs, Worker from JS text only
    //
    // Per-model settings are persisted under keys like "m_sf18_05_hashMB" so
    // each model remembers its own last-used values independently.
    const LOCAL_ENGINES = [
        {
            id:      "sf18_05",
            cacheKey: "sf18_05",
            label:   "Stockfish 18.0.5",
            cdn:     "unpkg",
            format:  "wasm",
            jsUrl:   "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.js",
            wasmUrl: "https://unpkg.com/stockfish@18.0.5/bin/stockfish-18-single.wasm",
            // Capabilities
            maxDepth:        25,
            hasHash:         true,
            hasMoveOverhead: true,   // SF 9+
            hasSlowMover:    false,  // removed in SF 17
            hasSkillLevel:   true,
            hasNNUE:         true,   // UCI_LimitStrength + UCI_Elo
            hasWDL:          true,   // UCI_ShowWDL
            hasContempt:     false,  // removed in SF 14
            hasMinThink:     false,  // removed in SF 12
            // Per-model defaults
            defaults: { hashMB: 64, moveOverhead: 100, skillLevel: 20,
                        limitStrength: false, elo: 3190, showWDL: false, minThinkTime: 20 },
        },
        {
            id:      "sf16_00",
            cacheKey: "sf16_00",
            label:   "Stockfish 16.0",
            cdn:     "unpkg",
            format:  "wasm",
            jsUrl:   "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.js",
            wasmUrl: "https://unpkg.com/stockfish@16.0.0/src/stockfish-nnue-16-single.wasm",
            maxDepth:        25,
            hasHash:         true,
            hasMoveOverhead: true,   // SF 9+
            hasSlowMover:    true,   // present through SF 16
            hasSkillLevel:   true,
            hasNNUE:         true,
            hasWDL:          true,
            hasContempt:     false,  // removed in SF 14
            hasMinThink:     false,  // removed in SF 12
            defaults: { hashMB: 64, moveOverhead: 100, skillLevel: 20,
                        limitStrength: false, elo: 3190, showWDL: false, minThinkTime: 20 },
        },
        {
            id:      "sf11_00",
            cacheKey: "sf11_00",
            label:   "Stockfish 11.0",
            cdn:     "unpkg",
            format:  "wasm",
            jsUrl:   "https://unpkg.com/stockfish@11.0.0/src/stockfish.js",
            wasmUrl: "https://unpkg.com/stockfish@11.0.0/src/stockfish.wasm",
            maxDepth:        20,
            hasHash:         true,
            hasMoveOverhead: true,   // SF 9+
            hasSlowMover:    true,
            hasSkillLevel:   true,
            hasNNUE:         false,  // classical HCE eval
            hasWDL:          false,
            hasContempt:     true,   // present through SF 13
            hasMinThink:     true,   // present through SF 11
            defaults: { hashMB: 32, moveOverhead: 100, slowMover: 100, skillLevel: 20,
                        contempt: 24, minThinkTime: 20 },
        },
        {
            id:      "sf10_02",
            cacheKey: "sf10_02",
            label:   "Stockfish 10.0.2 — asm.js",
            cdn:     "cdnjs",
            format:  "asmjs",
            jsUrl:   "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
            wasmUrl: null,
            maxDepth:        20,
            hasHash:         true,
            hasMoveOverhead: true,   // SF 9+
            hasSlowMover:    true,
            hasSkillLevel:   true,
            hasNNUE:         false,
            hasWDL:          false,
            hasContempt:     true,
            hasMinThink:     true,   // present through SF 11
            defaults: { hashMB: 32, moveOverhead: 100, slowMover: 100, skillLevel: 20,
                        contempt: 24, minThinkTime: 20 },
        },
        {
            id:      "sf9_00",
            cacheKey: "sf9_00",
            label:   "Stockfish 9.0.0 — asm.js",
            cdn:     "cdnjs",
            format:  "asmjs",
            jsUrl:   "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/9.0.0/stockfish.js",
            wasmUrl: null,
            maxDepth:        18,
            hasHash:         true,
            hasMoveOverhead: true,   // SF 9+
            hasSlowMover:    true,
            hasSkillLevel:   true,
            hasNNUE:         false,
            hasWDL:          false,
            hasContempt:     true,
            hasMinThink:     true,   // present through SF 11
            defaults: { hashMB: 16, moveOverhead: 100, slowMover: 100, skillLevel: 20,
                        contempt: 24, minThinkTime: 20 },
        },
    ];

    const getEngineById = (id) => LOCAL_ENGINES.find(e => e.id === id) || LOCAL_ENGINES[0];

    // --- STATE MANAGEMENT ---
    const state = {
        board: null,
        isThinking: !1,
        ui: {},
        lastSentFEN: "",
        currentSearchFEN: "",
        pendingAbortEchoes: 0,
        lastSanitizedBoardFEN: "",
        lastMoveResult: "Waiting for analysis...",
        lastLiveResult: "Depth | Evaluation: Best move will appear here.",
        lastPayload: "N/A",
        lastResponse: "N/A",
        moveTargetTime: 0,
        localEngine: null,
        engineLoadingInProgress: !1,
        engineLoadGeneration: 0,
        engineLoadWatchdog: null,
        engineStatus: "not_installed",
        engineStatusMsg: "",
        currentCloudRequest: null,
        currentBestMove: null,
        humanAlternatives: [],
        multiPVMap: null,
        currentMateNorm: null,
        lastMultiPV: null,
        currentPV: [],
        analysisStartTime: 0,
        analysisWatchdog: null,
        h: 180, s: 100, l: 50,
        newGameObserver: null,
        queueTimeout: null,
        localEval: null,
        localMate: null,
        localPV: null,
        localDepth: null,
        rematchAttempted: false,
        rematchTimeout: null,
        _justResetForNewGame: false,
            lastSeenFEN: "",
            playingAs: null,
            inStartPositionReset: false,
        visuals: [],
        pendingAnalysis: null,
        pendingLocalFEN: null,
        pendingLocalDepth: null,
        pendingAutoMoveTimeout: null,
        heartbeatMisses: 0,
        lastWorkerProbeAt: 0,
        engineModuleKey: null,
        engineDB: null,
        engineModuleCacheBroken: false,
        gameOverPollTimeout: null,
        boardObserver: null,
        analysisPauseUntil: 0,
        lastAnalysisCount: 0,
    };
    const DEFAULT_SETTINGS = {
        engineMode: "local",
        depth: 18,
        maxThinkingTime: 0,
        searchMoves: "",
        autoRun: !0,
        autoMove: !0,
        autoQueue: !1,
        hideAfterMove: false,
        showPVArrows: !1,
        showMoveHighlights: !0,
        showEvalBar: !0,
        pvDepth: 5,
        pvShowNumbers: !1,
        pvCustomGradient: !1,
        pvStartColor: "#FFFF00",
        pvEndColor: "#FF0000",
        minDelay: 0,
        maxDelay: 0,
        highlightColor: "#00eeff",
        visualType: "outline",
        innerOpacity: 0.6,
        outerOpacity: 0.2,
        gradientBias: 0,
        arrowOpacity: 0.8,
        arrowWidth: 15,
        visualOutlineWidth: 5,
        visualOutlineOpacity: 0.5,
        visualOutlineGlow: !0,
        visualOutlineGlowRadius: 50,
        visualDuration: 0.6,
        visualFadeOut: !0,
        themeBg: "#222222",
        themeText: "#eeeeee",
        themeBorder: "#444444",
        themePrimary: "#81b64c",
        menuOpacity: 0.9,
        debugLogs: !1,
        menuPosition: "top-right",
        localModelId: "sf18_05",
        // Per-model settings are stored under "m_<modelId>_<key>" via GM_setValue.
        // These flat keys are only used as in-memory working copies (loaded on model select).
        localHashMB: 64,
        localMoveOverhead: 100,
        localSkillLevel: 20,
        localLimitStrength: false,
        localElo: 3190,
        localShowWDL: false,
        localMinThinkTime: 20,
        localSlowMover: 100,
        localContempt: 24,
        // ─── New feature settings ──
        threatDetection: true,
        openingBookEnabled: true,
        timeManagement: true,
        humanizer: false,
        humanizeRate: 15,
        autoRematch: false,
        // Exa AI search integration
        exaApiKey: "",
        exaSearchEnabled: false,
    };
    const settings = { ...DEFAULT_SETTINGS };
    
    // ─── LICHESS COLOR DETECTION (v10.0.23+) ───────────────────────────────────────
    // Get player color FIRST (white=1, black=2), then only analyze YOUR moves
    // Same proven logic as Chess.com - prevents analyzing opponent moves
    const lichessState = {
        playerColor: null,
        initialized: false,
        
        initPlayerColor: () => {
            if (lichessState.initialized && lichessState.playerColor !== null) return lichessState.playerColor;
            
            const board = state.board || Platform.getBoard();
            if (!board) return null;
            
            // Use the SAME reliable detection as Platform.getLichessPlayerColor()
            const detectedColor = Platform.getLichessPlayerColor(board);
            if (detectedColor === 1 || detectedColor === 2) {
                lichessState.playerColor = detectedColor;
                lichessState.initialized = true;
                console.log('[SF Engine] Lichess: Player color detected (unified):', lichessState.playerColor === 1 ? 'WHITE' : 'BLACK');
                return lichessState.playerColor;
            }
            
            console.warn('[SF Engine] Lichess: Could not detect player color, will retry');
            return null;
        },
        
        getTurnColor: (board) => {
            // Get whose turn it is (1=white, 2=black)
            try {
                const cg = Platform.getLichessChessground?.(board);
                if (cg?.state?.turnColor) {
                    return cg.state.turnColor === 'white' ? 1 : 2;
                }
            } catch (e) {}
            
            // Fallback: extract from FEN
            try {
                const fen = Platform.getFEN?.(board);
                if (fen) {
                    const parts = fen.split(/\s+/);
                    return parts[1] === 'w' ? 1 : 2;
                }
            } catch (e) {}
            
            return 1;  // Default white
        },
        
        isYourTurn: (board) => {
            if (!lichessState.initialized || lichessState.playerColor === null) {
                lichessState.initPlayerColor();
            }
            // If still not initialized, assume it's our turn to avoid blocking
            if (!lichessState.initialized || lichessState.playerColor === null) {
                console.warn('[SF Engine] Lichess: Color not detected yet, allowing analysis');
                return true;
            }
            const turn = lichessState.getTurnColor(board);
            return lichessState.playerColor === turn;
        }
    };
    // --- COLOR HELPERS ---
    const hexToRgb = (hex) => {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 0, g: 0, b: 0 };
    };
    const rgbToHex = (r, g, b) => "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    const rgbToHsl = (r, g, b) => {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) h = s = 0;
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: h * 360, s: s * 100, l: l * 100 };
    };
    const hslToRgb = (h, s, l) => {
        let r, g, b;
        h /= 360; s /= 100; l /= 100;
        if (s === 0) r = g = b = l;
        else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    };
    // --- SAVE/LOAD HELPERS ---
    // ── Per-model setting helpers ────────────────────────────────────────────
    // Global settings use "bot_<key>". Per-model settings use "m_<modelId>_<key>".
    // The flat settings.localXxx keys are working copies loaded from the active model.

    function saveSetting(key, val) {
        settings[key] = val;
        GM_setValue(`bot_${key}`, val);
    }

    // Save a per-model setting for the given (or current) model
    function saveModelSetting(key, val, modelId) {
        const mid = modelId || settings.localModelId || "sf18_05";
        settings[key] = val;
        GM_setValue(`m_${mid}_${key}`, val);
    }

    // Load all per-model settings for a given model into settings.localXxx
    function loadModelSettings(modelId) {
        const m = getEngineById(modelId);
        const d = m.defaults;
        const g = (k, def) => { const v = GM_getValue(`m_${modelId}_${k}`); return v !== undefined ? v : def; };
        settings.localHashMB        = g("localHashMB",       d.hashMB       ?? 64);
        settings.localMoveOverhead  = g("localMoveOverhead", d.moveOverhead  ?? 100);
        settings.localSkillLevel    = g("localSkillLevel",   d.skillLevel    ?? 20);
        settings.localLimitStrength = g("localLimitStrength",d.limitStrength ?? false);
        settings.localElo           = g("localElo",          d.elo           ?? 3190);
        settings.localShowWDL       = g("localShowWDL",      d.showWDL       ?? false);
        settings.localMinThinkTime  = g("localMinThinkTime", d.minThinkTime  ?? 20);
        settings.localSlowMover     = g("localSlowMover",    d.slowMover     ?? 100);
        settings.localContempt      = g("localContempt",     d.contempt      ?? 24);
    }

    function loadSettings() {
        Object.keys(DEFAULT_SETTINGS).forEach((k) => {
            if (k === "engineMode") return; // always start in LOCAL mode
            const saved = GM_getValue(`bot_${k}`);
            if (saved !== undefined) settings[k] = saved;
        });
        settings.engineMode = "local";
        // Load per-model settings for the active model
        loadModelSettings(settings.localModelId || "sf18_05");
        // Initialize Exa search with saved API key
        if (typeof ExaSearch !== 'undefined' && ExaSearch.init) {
            ExaSearch.init();
        }
    }
    // --- UTILITIES ---
    const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const log = (...args) => { if (settings?.debugLogs) console.log(...args); };

    // --- ERROR REPORTER (console as error report storage) ---
    const ErrorReporter = {
        entries: [],
        maxEntries: 500,
        
        capture: (context, error, extra = {}) => {
            const entry = {
                timestamp: new Date().toISOString(),
                context: context,
                message: error?.message || String(error),
                stack: error?.stack || "no stack",
                name: error?.name || "Error",
                extra: extra,
                url: window.location.href,
                platform: Platform.current,
                engineStatus: state.engineStatus,
                engineMode: settings.engineMode,
                localModelId: settings.localModelId,
                isThinking: state.isThinking,
                hasBoard: !!state.board,
                hasEngine: !!state.localEngine,
                userAgent: navigator.userAgent.substring(0, 200)
            };
            ErrorReporter.entries.push(entry);
            if (ErrorReporter.entries.length > ErrorReporter.maxEntries) {
                ErrorReporter.entries.shift();
            }
            // Also log to console immediately
            console.error(`[ERR:${context}]`, entry.message, "\nStack:", entry.stack, "\nExtra:", JSON.stringify(extra, null, 2));
            return entry;
        },
        
        captureSync: (context, fn, extra = {}) => {
            try {
                return fn();
            } catch (e) {
                ErrorReporter.capture(context, e, extra);
                throw e;
            }
        },
        
        wrap: (context, fn, extra = {}) => {
            return (...args) => {
                try {
                    return fn.apply(this, args);
                } catch (e) {
                    ErrorReporter.capture(`${context}(${args.map(a => JSON.stringify(a).substring(0,50)).join(",")})`, e, { ...extra, argsCount: args.length });
                    throw e;
                }
            };
        },
        
        wrapAsync: (context, fn, extra = {}) => {
            return async (...args) => {
                try {
                    return await fn.apply(this, args);
                } catch (e) {
                    ErrorReporter.capture(`${context}(${args.map(a => JSON.stringify(a).substring(0,50)).join(",")})`, e, { ...extra, argsCount: args.length });
                    throw e;
                }
            };
        },
        
        dump: () => {
            console.group(`📋 ERROR REPORT DUMP (${ErrorReporter.entries.length} entries)`);
            ErrorReporter.entries.forEach((e, i) => {
                console.log(`\n--- [${i}] ${e.timestamp} | ${e.context} ---`);
                console.log(`Message: ${e.message}`);
                console.log(`Stack: ${e.stack}`);
                console.log(`Platform: ${e.platform} | Engine: ${e.engineStatus} | Mode: ${e.engineMode}`);
                console.log(`Model: ${e.localModelId} | Thinking: ${e.isThinking} | Board: ${e.hasBoard} | Engine: ${e.hasEngine}`);
                if (Object.keys(e.extra).length) console.log(`Extra:`, e.extra);
            });
            console.groupEnd();
            return ErrorReporter.entries;
        },
        
        clear: () => { ErrorReporter.entries = []; },
        
        getSummary: () => {
            const byContext = {};
            ErrorReporter.entries.forEach(e => {
                byContext[e.context] = (byContext[e.context] || 0) + 1;
            });
            return { total: ErrorReporter.entries.length, byContext };
        }
    };
    
    // Make globally accessible for manual dump
    window.__SF_ErrorReporter = ErrorReporter;

    // Auto-dump errors to console every 30 seconds
    setInterval(() => {
        if (ErrorReporter.entries.length > 0) {
            console.group(`📋 AUTO ERROR DUMP (${ErrorReporter.entries.length} entries)`);
            ErrorReporter.entries.forEach((e, i) => {
                console.log(`\n--- [${i}] ${e.timestamp} | ${e.context} ---`);
                console.log(`Message: ${e.message}`);
                console.log(`Stack: ${e.stack}`);
                console.log(`Platform: ${e.platform} | Engine: ${e.engineStatus} | Mode: ${e.engineMode}`);
                console.log(`Model: ${e.localModelId} | Thinking: ${e.isThinking} | Board: ${e.hasBoard} | Engine: ${e.hasEngine}`);
                if (Object.keys(e.extra).length) console.log(`Extra:`, e.extra);
            });
            console.groupEnd();
        }
    }, 30000);

    // Dump on engine status change to error
    const setEngineStatusBase = function(status, msg) {
        state.engineStatus = status;
        state.engineStatusMsg = msg || "";
        updateLocalSettingsUI();
    };

    function setEngineStatus(status, msg) {
        if (status === "error") {
            ErrorReporter.capture('setEngineStatus->error', new Error(msg), { previousStatus: state.engineStatus });
        }
        setEngineStatusBase(status, msg);
    }

    // Global error handlers
    window.addEventListener('error', (e) => {
        ErrorReporter.capture('window.onerror', e.error || new Error(e.message), { 
            filename: e.filename, 
            lineno: e.lineno, 
            colno: e.colno 
        });
    });
    
    window.addEventListener('unhandledrejection', (e) => {
        ErrorReporter.capture('unhandledrejection', e.reason, { promise: e.promise });
    });

    // Anti-cheat: occasionally delay analysis start by a short random amount (subtle, not annoying)
    // Returns true when analysis should be skipped this tick (short pause active).
    function shouldPauseAnalysis() {
        if (Date.now() < state.analysisPauseUntil) return true;
        state.lastAnalysisCount++;
        if (state.lastAnalysisCount >= getRandomInt(12, 25)) {
            state.analysisPauseUntil = Date.now() + getRandomInt(700, 2500);
            state.lastAnalysisCount = 0;
            log(`🛑 Anti-cheat: brief analysis pause (${Math.round((state.analysisPauseUntil - Date.now()) / 1000)}s)`);
            return true;
        }
        return false;
    }

const scheduleAutoMove = (fn, delayMs) => {
    if (state.pendingAutoMoveTimeout) clearTimeout(state.pendingAutoMoveTimeout);
    state.pendingAutoMoveTimeout = setTimeout(() => {
        state.pendingAutoMoveTimeout = null;
        // Re-check it's still our turn at execution time (not just scheduling time)
        if (state.board) {
            const tn = Platform.getTurn(state.board);
            const pa = Platform.getPlayingAs(state.board);
            const turnNum = (tn === 1 || tn === "w" || tn === "white") ? 1 : 2;
            const paNum = (pa === 1 || pa === "w" || pa === "white") ? 1 : 2;
            if (turnNum !== paNum) {
                console.warn(`[SF Engine] Auto-move cancelled: not our turn anymore (turn=${turnNum}, playingAs=${paNum})`);
                return;
            }
        }
        fn();
    }, delayMs);
};
const getMoveWinPct = (cp, mate) => {
    if (mate !== null && mate !== undefined && mate !== 0) {
        const absM = Math.abs(mate);
        const cert = 96 + 3 * Math.exp(-0.5 * absM);
        return mate > 0 ? cert : 100 - cert;
    }
    const c = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
};

// Humanizer: when enabled in local-engine mode, occasionally plays a
// MultiPV alternative (not the engine's best move) to simulate human errors.
    const shouldPlayBestMove = () => {
        if (!settings.humanizer || settings.engineMode !== 'local') return true;
        return Math.random() * 100 > settings.humanizeRate;
    };

    // --- BOARD FEN LOGIC ---
    function getRawBoardFEN() {
        return ErrorReporter.wrap('getRawBoardFEN', () => {
            if (!state.board) return null;
            try {
                return Platform.getFEN(state.board);
            } catch (e) {}
            return null;
        })();
    }
    function sanitizeFEN(rawFEN) {
        if (!rawFEN) return "";
        let parts = rawFEN.replace(/\s+/g, " ").trim().split(" ");
        if (parts.length < 6) {
            const def = ["w", "-", "-", "0", "1"];
            for (let i = parts.length; i < 6; i++) parts.push(def[i - 1]);
        }
        if (parts[3] && parts[3] !== "-") parts[3] = parts[3].toLowerCase();
        return parts.join(" ");
    }
    function fenPieceAt(pieces, square) {
        const file = square.charCodeAt(0) - 97, rank = parseInt(square.charAt(1));
        if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
        const ranks = pieces.split("/");
        const row = 8 - rank;
        if (row < 0 || row >= ranks.length) return null;
        let idx = 0, i = 0;
        while (i < ranks[row].length) {
            const ch = ranks[row][i];
            if (/\d/.test(ch)) { idx += parseInt(ch); }
            else {
                if (idx === file) return ch;
                idx++;
            }
            i++;
        }
        return null;
    }
    // --- VISUAL MANAGER ---
    const Visuals = {
        add: (move, type) => {
            if (!move) return;
            if (!settings.showMoveHighlights) return;
            if (type === 'history') {
                Visuals.removeByType('history');
                Visuals.removeByType('analysis');
            } else if (type === 'analysis') {
                Visuals.removeByType('analysis');
            }
            const id = `vis-${type}-${move}`;
            const existingIdx = state.visuals.findIndex(v => v.id === id);
            if (existingIdx !== -1) Visuals.remove(id);

            // NATIVE ARROW HANDLING
            if (settings.visualType === "nativeArrow") {
                state.board = Platform.getBoard();
                if (state.board?.game?.markings) {
                    state.board.game.markings.addOne({
                        type: "arrow",
                        tags: ["Arrows", id],
                        data: {
                            from: move.substring(0, 2),
                            to: move.substring(2, 4)
                        }
                    });
                    state.visuals.push({ id, move, type, interval: null, isFading: false });
                    return;
                }
            }

            Visuals.draw(id, move);
            if (type === 'history' && settings.visualDuration === -1) {
                const vis = state.visuals.find(v => v.id === id);
                if (vis) { const vr = ShadowKit.boardRoot(state.board); if (vr) vr.querySelectorAll(`.${id}`).forEach(el => el.remove()); state.visuals = state.visuals.filter(v => v.id !== id); }
                return;
            }
            const interval = setInterval(() => {
                const vis = state.visuals.find(v => v.id === id);
                if (!vis || vis.isFading) { clearInterval(interval); return; }
                Visuals.draw(id, move);
            }, 50);
            state.visuals.push({ id, move, type, interval, isFading: false });
            if (type === 'history') {
                if (settings.visualDuration > 0) {
                    const ms = settings.visualDuration * 1000;
                    if (settings.visualFadeOut) setTimeout(() => Visuals.fadeOut(id), ms);
                    else setTimeout(() => Visuals.remove(id), ms);
                }
            }
        },
        draw: (id, move) => {
            state.board = Platform.getBoard();
            if (!state.board) return;
            const root = ShadowKit.boardRoot(state.board);
            if (root.querySelector(`.${id}`)) return;
            const { r, g, b } = hexToRgb(settings.highlightColor);
            const col = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            const drawBox = () => {
                let isFlipped = Platform.isFlipped(state.board);
                [from, to].forEach((alg) => {
                    const file = alg.charCodeAt(0) - 97, rank = parseInt(alg.charAt(1)) - 1;
                    const left = isFlipped ? (7 - file) * 12.5 : file * 12.5;
                    const top = isFlipped ? rank * 12.5 : (7 - rank) * 12.5;
                    const sqId = `${alg.charCodeAt(0) - 96}${alg.charAt(1)}`;
                    const div = document.createElement("div");
                    div.className = `square-${sqId} bot-highlight ${id}`;
                    let baseStyle = `position: absolute; left: ${left}%; top: ${top}%; pointer-events: none !important; z-index: 1000000 !important; width: 12.5%; height: 12.5%; box-sizing: border-box; transition: none !important; `;
                    if (settings.visualType === "outline") {
                        let glow = settings.visualOutlineGlow ? `box-shadow: 0 0 ${settings.visualOutlineGlowRadius}px ${col(1)}, inset 0 0 ${settings.visualOutlineGlowRadius/2}px ${col(0.5)} !important;` : "";
                        div.style.cssText = baseStyle + `border: ${settings.visualOutlineWidth}px solid ${col(settings.visualOutlineOpacity)} !important; ${glow}`;
                    } else {
                        const bias = settings.gradientBias + "%";
                        div.style.cssText = baseStyle + `background: radial-gradient(closest-side, ${col(settings.innerOpacity)} ${bias}, ${col(settings.outerOpacity)} 100%) !important;`;
                    }
                    root.appendChild(div);
                });
            };
            if (settings.visualType === "arrow") drawArrow(move, id);
            else drawBox();
        },
        fadeOut: (id) => {
            const vis = state.visuals.find(v => v.id === id);
            if (!vis) return;
            vis.isFading = true;
            clearInterval(vis.interval);
            const fr = ShadowKit.boardRoot(state.board || Platform.getBoard());
            const els = fr ? fr.querySelectorAll(`.${id}`) : [];
            els.forEach(el => {
                el.style.setProperty("transition", `opacity ${settings.visualDuration}s linear`, "important");
                el.style.setProperty("opacity", "0", "important");
            });
            setTimeout(() => Visuals.remove(id), settings.visualDuration * 1000);
        },
        remove: (id) => {
            const idx = state.visuals.findIndex(v => v.id === id);
            if (idx !== -1) { clearInterval(state.visuals[idx].interval); state.visuals.splice(idx, 1); }
            const rr = ShadowKit.boardRoot(state.board || Platform.getBoard());
            if (rr) rr.querySelectorAll(`.${id}`).forEach(el => el.remove());

            if (settings.visualType === "nativeArrow") {
                const board = Platform.getBoard();
                if (board?.game?.markings) {
                    board.game.markings.removeAll();
                }
            }
        },
        removeByType: (type) => {
            const toRemove = state.visuals.filter(v => v.type === type);
            toRemove.forEach(v => Visuals.remove(v.id));
        }
    };
    // --- PV MANAGER ---
    const PV = {
        interval: null,
        lastMoves: [],
        update: (pvMoves) => {
            PV.lastMoves = pvMoves || [];
            if (!settings.showPVArrows) { PV.clear(); return; }
            PV.draw();
            if (!PV.interval) PV.interval = setInterval(PV.draw, 100);
        },
        clear: () => { if (PV.interval) { clearInterval(PV.interval); PV.interval = null; } const cr = ShadowKit.boardRoot(state.board || Platform.getBoard()); if (cr) cr.querySelectorAll('.pv-arrow').forEach(el => el.remove()); },
        draw: () => {
            state.board = Platform.getBoard();
            if (!state.board) return;
            if (!settings.showPVArrows || !PV.lastMoves.length) { PV.clear(); return; }
            const root = ShadowKit.boardRoot(state.board);
            const limit = Math.min(PV.lastMoves.length, settings.pvDepth);
            for (let i = 0; i < limit; i++) {
                const move = PV.lastMoves[i];
                const id = `pv-arrow-${i}`;
                const el = root.querySelector(`.${id}`);
                if (el) {
                    if (el.dataset.move === move) continue;
                    el.remove();
                }
                let color = settings.highlightColor;
                if (settings.pvCustomGradient) {
                    const start = hexToRgb(settings.pvStartColor);
                    const end = hexToRgb(settings.pvEndColor);
                    const factor = limit === 1 ? 0 : i / (limit - 1);
                    const r = Math.round(start.r + factor * (end.r - start.r));
                    const g = Math.round(start.g + factor * (end.g - start.g));
                    const b = Math.round(start.b + factor * (end.b - start.b));
                    color = `rgb(${r},${g},${b})`;
                }
                drawPVArrow(move, id, color, i + 1);
            }
            let i = limit;
            while (root.querySelector(`.pv-arrow-${i}`)) {
                root.querySelectorAll(`.pv-arrow-${i}`).forEach(e => e.remove());
                i++;
            }
        }
    };
    // --- EVALUATION BAR ---
    // Self-contained floating bar that attaches relative to the chess board.
    // Does NOT depend on Chess.com's internal CSS grid — works every time.
    const ShadowKit = (() => {
        let host = null;
        let root = null;
        const boardHosts = new WeakMap();
        return {
            root() {
                if (host && document.contains(host)) return root;
                host = document.createElement("div");
                host.className = "vx-host";
                host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;";
                root = host.attachShadow({ mode: "open" });
                document.body.appendChild(host);
                return root;
            },
            boardRoot(board) {
                if (!board) return null;
                let bHost = boardHosts.get(board);
                if (bHost && board.contains(bHost)) return bHost.shadowRoot;
                bHost = document.createElement("div");
                bHost.className = "vx-host";
                bHost.style.cssText = "all:initial;position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:1000000;isolation:isolate;";
                const bRoot = bHost.attachShadow({ mode: "open" });
                boardHosts.set(board, bHost);
                board.appendChild(bHost);
                return bRoot;
            }
        };
    })();
    const injectEvalStyles = () => {
        const r = ShadowKit.root();
        if (r.getElementById('custom-eval-styles')) return;
        const s = document.createElement('style');
        s.id = 'custom-eval-styles';
        s.innerHTML = `
            #custom-eval-overlay {
                position: fixed;
                pointer-events: none;
                z-index: 100000;
                display: flex;
                align-items: center;
                transition: opacity 0.3s;
            }
            #custom-eval-bar {
                width: 34px;
                height: 100%;
                border-radius: 9px;
                overflow: hidden;
                position: relative;
                background: #0d0d0d;
                border: 1px solid rgba(255,255,255,0.14);
                box-shadow: 0 0 0 1px rgba(0,0,0,0.7), 0 8px 22px rgba(0,0,0,0.5), inset 0 0 12px rgba(0,0,0,0.6);
                box-sizing: border-box;
            }
            #custom-eval-connector {
                width: 10px;
                height: 100%;
                flex-shrink: 0;
                background: linear-gradient(90deg, rgba(0,0,0,0.35), rgba(0,0,0,0) 75%);
            }
            #custom-eval-fill-area {
                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
            }
            #custom-eval-top-block, #custom-eval-bottom-block {
                transition: flex 0.35s cubic-bezier(0.4, 0.0, 0.2, 1);
                will-change: flex;
            }
            #custom-eval-top-block {
                background: linear-gradient(180deg, #2e2e2e 0%, #1b1b1b 60%, #101010 100%);
            }
            #custom-eval-bottom-block {
                background: linear-gradient(180deg, #fdfdfd 0%, #e6e6e6 60%, #d3d3d3 100%);
            }
            #custom-eval-mid {
                position: absolute;
                left: 0; right: 0; top: 50%;
                height: 0;
                border-top: 1px solid rgba(255,255,255,0.25);
                box-shadow: 0 0 6px rgba(255,255,255,0.35);
                z-index: 2;
            }
            #custom-eval-tick25, #custom-eval-tick75 {
                position: absolute;
                left: 0; right: 0;
                height: 0;
                border-top: 1px dashed rgba(255,255,255,0.10);
                z-index: 2;
            }
            #custom-eval-tick25 { top: 25%; }
            #custom-eval-tick75 { top: 75%; }
            #custom-eval-knob {
                position: absolute;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 17px;
                height: 7px;
                background: #999;
                border-radius: 4px;
                z-index: 3;
                transition: top 0.35s cubic-bezier(0.4, 0.0, 0.2, 1), background 0.2s, box-shadow 0.2s;
                box-shadow: 0 1px 4px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.2);
            }
            #custom-eval-text {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                background: rgba(12, 12, 12, 0.86);
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 9px;
                padding: 3px 6px;
                font-size: 9.5px;
                font-weight: 800;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                letter-spacing: 0.3px;
                line-height: 1;
                white-space: nowrap;
                color: #f0f0f0;
                z-index: 4;
                box-shadow: 0 2px 8px rgba(0,0,0,0.55), inset 0 0 3px rgba(255,255,255,0.07);
            }
        `;
        r.appendChild(s);
    };

    const EvalBar = {
        el: null,
        _lastBoard: null,
        _lastPosKey: null,
        _lastPlayingAs: null,
        _els: null,

        create: () => {
            injectEvalStyles();
            const board = state.board || Platform.getBoard();
            if (!board) return;

            if (EvalBar.el) {
                if (EvalBar._lastBoard === board && ShadowKit.root().contains(EvalBar.el)) return;
                EvalBar.el.remove();
                EvalBar.el = null;
            }

            EvalBar._lastBoard = board;
            EvalBar._lastPosKey = null;
            EvalBar._lastPlayingAs = null;

            const wrap = document.createElement('div');
            wrap.id = 'custom-eval-overlay';

            wrap.innerHTML = `
                <div id="custom-eval-bar">
                    <div id="custom-eval-fill-area">
                        <div id="custom-eval-top-block" style="flex:1;"></div>
                        <div id="custom-eval-bottom-block" style="flex:1;"></div>
                    </div>
                    <div id="custom-eval-mid"></div>
                    <div id="custom-eval-tick25"></div>
                    <div id="custom-eval-tick75"></div>
                    <div id="custom-eval-knob" style="top:50%;"></div>
                    <span id="custom-eval-text">0.0</span>
                </div>
                <div id="custom-eval-connector"></div>
            `;

            ShadowKit.root().appendChild(wrap);
            EvalBar.el = wrap;
            EvalBar._els = null;
            EvalBar._cacheEls();
        },

        _cacheEls: () => {
            const r = ShadowKit.root();
            const ep = r.getElementById('custom-eval-top-block');
            const bp = r.getElementById('custom-eval-bottom-block');
            const tx = r.getElementById('custom-eval-text');
            const kn = r.getElementById('custom-eval-knob');
            if (ep && bp && tx) EvalBar._els = { top: ep, bottom: bp, text: tx, knob: kn };
        },

        updatePosition: () => {
            if (!EvalBar.el) return;
            const board = state.board || Platform.getBoard();
            if (!board) return;
            if (EvalBar._lastBoard !== board) {
                EvalBar.el.remove();
                EvalBar.el = null;
                EvalBar.create();
                return;
            }
            const br = board.getBoundingClientRect();
            const posKey = `${Math.round(br.left)}|${Math.round(br.top)}|${Math.round(br.height)}`;
            if (EvalBar._lastPosKey === posKey) return;
            EvalBar._lastPosKey = posKey;
            EvalBar.el.style.cssText = `
                position: fixed;
                pointer-events: none;
                z-index: 100000;
                display: flex;
                align-items: center;
                left: ${br.left - 60}px;
                 top: ${br.top}px;
                 width: 50px;
                 height: ${br.height}px;
            `;
        },

        getPlayingAs: () => {
            const board = state.board || Platform.getBoard();
            if (board) {
                const pa = Platform.getPlayingAs(board);
                if (pa === 1 || pa === "w" || pa === "white") { state.playingAs = 1; return 1; }
                if (pa === 2 || pa === "b" || pa === "black") { state.playingAs = 2; return 2; }
            }
            return state.playingAs || 1;
        },

         update: (evalScore, mate) => {
             if (!settings.showEvalBar) return;
             if (!EvalBar.el) EvalBar.create();
             if (!EvalBar._els) EvalBar._cacheEls();
            const els = EvalBar._els;
            if (!els) return;

            const playingAsVal = EvalBar.getPlayingAs();
            const playingAsBlack = playingAsVal === 2;

            if (EvalBar._lastPlayingAs !== playingAsVal) {
                EvalBar._lastPlayingAs = playingAsVal;
            }

            // Always sync bar colors
            if (playingAsBlack) {
                els.top.style.background    = 'linear-gradient(180deg, #fdfdfd 0%, #e6e6e6 60%, #d3d3d3 100%)';
                els.bottom.style.background = 'linear-gradient(180deg, #2e2e2e 0%, #1b1b1b 60%, #101010 100%)';
            } else {
                els.top.style.background    = 'linear-gradient(180deg, #2e2e2e 0%, #1b1b1b 60%, #101010 100%)';
                els.bottom.style.background = 'linear-gradient(180deg, #fdfdfd 0%, #e6e6e6 60%, #d3d3d3 100%)';
            }

            let yourPct = 50;
            let displayScore = '0';

            if (mate !== null && mate !== undefined && mate !== 0) {
                const mVal = parseInt(mate);
                // Positive = we are mating them, negative = being mated
                displayScore = 'M' + Math.abs(mVal);
                if (mVal < 0) displayScore = '-' + displayScore;
                // Non-linear mate→% mapping: M1≈98%, M2≈97%, M4≈96.4%, asymptoting to 96%.
                // Closer mate = higher win% (we win sooner); we getting mated → near 0%.
                const absM = Math.abs(mVal);
                const mateCert = 96 + 3 * Math.exp(-0.5 * absM);
                yourPct = Math.round(mVal > 0 ? mateCert : 100 - mateCert);
                yourPct = Math.max(1, Math.min(99, yourPct));
            } else if (evalScore !== null && evalScore !== undefined) {
                const score = parseFloat(evalScore);
                // Chess.com/Lichess sigmoid: Win% = 50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1)
                // evalScore is in pawns → to centipawns. Cap at ±1500cp to avoid saturation.
                const cp = Math.max(-1500, Math.min(1500, score * 100));
                yourPct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
                // Clamp to 1%–99% to avoid extreme edge cases
                yourPct = Math.max(1, Math.min(99, yourPct));
                // Display score
                if (Math.abs(score) >= 10) displayScore = (score > 0 ? '+' : '') + Math.round(score);
                else if (Math.abs(score) >= 1) displayScore = (score > 0 ? '+' : '') + score.toFixed(1);
                else displayScore = (score > 0 ? '+' : '') + score.toFixed(2);
            }

            // yourPct = % of YOUR color (bottom block) — your color grows up from bottom
            els.top.style.flex = (100 - yourPct).toFixed(1);
            els.bottom.style.flex = yourPct.toFixed(1);

            els.text.innerText = displayScore;

            // Knob at the balance line
            const knobEl = els.knob;
            if (knobEl) {
                knobEl.style.top = (100 - yourPct).toFixed(1) + '%';
                const ourColor   = playingAsBlack ? '#3a3a3a' : '#f2f2f2';
                const oppColor   = playingAsBlack ? '#f2f2f2' : '#3a3a3a';
                const winner     = yourPct >= 50 ? ourColor : oppColor;
                knobEl.style.background = winner;
                const glow = winner === '#f2f2f2' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
                knobEl.style.boxShadow = `0 1px 4px rgba(0,0,0,0.85), 0 0 10px ${glow}, inset 0 0 0 1px rgba(255,255,255,0.2)`;
            }
        },

        reset: () => {
            const els = EvalBar._els;
            if (els) {
                els.top.style.flex = '1';
                els.bottom.style.flex = '1';
                els.text.innerText = '0.0';
                if (els.knob) {
                    els.knob.style.top = '50%';
                    els.knob.style.background = '#999';
                    els.knob.style.boxShadow = '0 1px 4px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.2)';
                }
            }
        }
    };

    // ─── OPENING BOOK ────────────────────────────────────────────────────────
    // Italian Game, Fried Liver, and common opening lines. Fast instant moves.
    const OpeningBook = {
        // Maps FEN position (pieces only) → best booked move
        // Italian Game / Giuoco Piano / Fried Liver Attack / Two Knights Defense
        book: {
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR": "e2e4", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR": "e7e5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR": "g1f3", "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R": "b8c6", "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R": "f1c4", "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "f8c5", "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "e1g1", "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R": "g8f6",
            "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R": "d2d3", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2BPP3/2P2N2/PP3PPP/RNBQK2R": "e5d4", "r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/2P2N2/PP3PPP/RNBQK2R": "f3d4", "r1bqk2r/pppp1ppp/2n2n2/2b5/2BNP3/2P5/PP3PPP/RNBQK2R": "c5b6", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R": "d7d5", "r1bqk2r/ppp2ppp/2n2n2/2bpp3/2B1P3/2PP1N2/PP3PPP/RNBQK2R": "e4d5", "r1bqk2r/ppp2ppp/2n2n2/2bpp3/2BPP3/2P2N2/PP3PPP/RNBQK2R": "e5d4", "r1bqk2r/ppp2ppp/2n2n2/2bp4/2BpP3/2P2N2/PP3PPP/RNBQK2R": "f3d4",
            "r1bqk2r/ppp2ppp/2n2n2/2bp4/2BNP3/2P5/PP3PPP/RNBQK2R": "c5d6", "r1bqk1nr/pppp1ppp/2n5/2b1p3/1PB1P3/5N2/P1PP1PPP/RNBQK2R": "c5b6", "r1bqk1nr/pppp1ppp/1bn5/4p3/1PB1P3/5N2/P1PP1PPP/RNBQK2R": "a2a4", "r1bqk1nr/pppp1ppp/1bn5/4p3/PPB1P3/5N2/2PP1PPP/RNBQK2R": "a7a6", "r1bqk1nr/1ppp1ppp/pbn5/4p3/PPB1P3/5N2/2PP1PPP/RNBQK2R": "b4b5", "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R": "f7f5", "r1bqk1nr/pppp2pp/2n5/2b1pp2/2B1P3/3P1N2/PPP2PPP/RNBQK2R": "b1c3", "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1": "g8f6",
            "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1": "d2d3", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1": "d7d5", "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "f3g5", "r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R": "d7d5", "r1bqkb1r/ppp2ppp/2n2n2/3pp1N1/2B1P3/8/PPPP1PPP/RNBQK2R": "e4d5", "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R": "c6a5", "r1bqkb1r/ppp2ppp/5n2/n2Pp1N1/2B5/8/PPPP1PPP/RNBQK2R": "c4b5", "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R": "a7a6",
            "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R": "b5a4", "r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R": "g8f6", "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R": "e1g1", "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1": "f8e7", "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1": "f1e1", "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQR1K1": "b7b5", "r1bqk2r/2ppbppp/p1n2n2/1p2p3/B3P3/5N2/PPPP1PPP/RNBQR1K1": "a4b3", "r1bqk2r/2ppbppp/p1n2n2/1p2p3/4P3/1B3N2/PPPP1PPP/RNBQR1K1": "e8g8",
            "r1bqk2r/2p1bppp/p1np1n2/1p2p3/4P3/1B3N2/PPPP1PPP/RNBQR1K1": "c2c3", "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/2P2N2/PP1P1PPP/RNBQ1RK1": "d7d5", "r1bqk2r/1pp1bppp/p1n2n2/3pp3/B3P3/2P2N2/PP1P1PPP/RNBQ1RK1": "f3e5", "r1bqk2r/2p1bppp/p1np1n2/1p2p3/4P3/1BP2N2/PP1P1PPP/RNBQR1K1": "e8g8", "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R": "e5d4", "r1bqkbnr/pppp1ppp/2n5/8/3pP3/5N2/PPP2PPP/RNBQKB1R": "f3d4", "r1bqkbnr/pppp1ppp/2n5/8/3NP3/8/PPP2PPP/RNBQKB1R": "g8f6", "r1bqkb1r/pppp1ppp/2n2n2/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3",
            "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R": "f3e5", "rnbqkb1r/pppp1ppp/5n2/4N3/4P3/8/PPPP1PPP/RNBQKB1R": "d7d6", "rnbqkb1r/ppp2ppp/3p1n2/4N3/4P3/8/PPPP1PPP/RNBQKB1R": "e5f3", "rnbqkbnr/pppppp1p/6p1/8/4P3/8/PPPP1PPP/RNBQKBNR": "d2d4", "rnbqkbnr/pppppp1p/6p1/8/3PP3/8/PPP2PPP/RNBQKBNR": "f8g7", "rnbqk1nr/ppppppbp/6p1/8/3PP3/8/PPP2PPP/RNBQKBNR": "b1c3", "rnbqk1nr/ppppppbp/6p1/8/3PP3/2N5/PPP2PPP/R1BQKBNR": "d7d6", "rnbqk1nr/ppp1ppbp/3p2p1/8/3PP3/2N5/PPP2PPP/R1BQKBNR": "c1e3",
            "rnbqk1nr/ppp1ppbp/3p2p1/8/3PP3/2N1B3/PPP2PPP/R2QKBNR": "a7a6", "rnbqk1nr/1pp1ppbp/p2p2p1/8/3PP3/2N1B3/PPP2PPP/R2QKBNR": "d1d2", "rnbqk1nr/p1p1ppbp/3p2p1/1p6/3PP3/2N1B3/PPP2PPP/R2QKBNR": "g2g4", "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR": "g1f3", "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "e7e6", "rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "d2d4", "rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R": "c5d4", "rnbqkbnr/pp2pppp/3p4/8/3pP3/5N2/PPP2PPP/RNBQKB1R": "f3d4",
            "rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R": "g8f6", "rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3", "rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "e7e6", "rnbqkb1r/pp3ppp/3ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "f1e2", "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "f1e2", "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP1BPPP/R1BQK2R": "e7e5", "rnbqkb1r/1p3ppp/p2p1n2/4p3/3NP3/2N5/PPP1BPPP/R1BQK2R": "d4b3", "rnbqkbnr/pp1p1ppp/4p3/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "d2d4",
            "rnbqkbnr/pp1p1ppp/4p3/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R": "c5d4", "rnbqkbnr/pp1p1ppp/4p3/8/3pP3/5N2/PPP2PPP/RNBQKB1R": "f3d4", "rnbqkbnr/pp1p1ppp/4p3/8/3NP3/8/PPP2PPP/RNBQKB1R": "d7d5", "rnbqkb1r/pp1p1ppp/4pn2/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3", "rnbqkb1r/pp1p1ppp/4pn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "d7d6", "rnbqk2r/pp1pbppp/4pn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "f1e2", "rnbqkb1r/1p1p1ppp/p3pn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "f1e2", "rnbqkbnr/1p1p1ppp/p3p3/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3",
            "r1bqkbnr/pp1p1ppp/2n1p3/8/3NP3/8/PPP2PPP/RNBQKB1R": "d4c6", "r1bqkbnr/pp1p1ppp/2N1p3/8/4P3/8/PPP2PPP/RNBQKB1R": "d7c6", "r1bqkbnr/p2p1ppp/2p1p3/8/4P3/8/PPP2PPP/RNBQKB1R": "e4e5", "r1bqkbnr/pp3ppp/2p1p3/8/4P3/8/PPP2PPP/RNBQKB1R": "f1c4", "r1bqkbnr/pp1p1ppp/2n1p3/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "d7d5", "r1bqkbnr/pp3ppp/2n1p3/3p4/3NP3/2N5/PPP2PPP/R1BQKB1R": "e4d5", "rnbqkbnr/1p1ppppp/p7/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "d2d4", "rnbqkbnr/1p1ppppp/p7/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R": "c5d4",
            "rnbqkbnr/1p1ppppp/p7/8/3pP3/5N2/PPP2PPP/RNBQKB1R": "f3d4", "rnbqkbnr/1p1ppppp/p7/8/3NP3/8/PPP2PPP/RNBQKB1R": "g8f6", "rnbqkb1r/1p1ppppp/p4n2/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3", "rnbqkb1r/1p1ppppp/p4n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "e7e6", "rnbqkb1r/1p1p1ppp/p4n2/4p3/3NP3/2N5/PPP2PPP/R1BQKB1R": "d4b3", "rnbqkb1r/1p1p1ppp/p3pn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R": "b7b5", "rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R": "e1g1", "rnbqkb1r/3p1ppp/p3pn2/1p6/3NP3/2N5/PPP1BPPP/R1BQK2R": "f2f4",
            "rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "c1e3", "rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N1B3/PPP2PPP/R2QKB1R": "f8g7", "rnbqk2r/pp2ppbp/3p1np1/8/3NP3/2N1B3/PPP2PPP/R2QKB1R": "f2f3", "rnbqk2r/pp2ppbp/3p1np1/8/3NP3/2N1BP2/PPP3PP/R2QKB1R": "e8g8", "r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "d2d4", "r1bqkbnr/pp1ppppp/2n5/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R": "c5d4", "r1bqkbnr/pp1ppppp/2n5/8/3pP3/5N2/PPP2PPP/RNBQKB1R": "f3d4", "r1bqkbnr/pp1ppppp/2n5/8/3NP3/8/PPP2PPP/RNBQKB1R": "g7g6",
            "r1bqkb1r/pp1ppppp/2n2n2/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3", "r1bqkb1r/pp1ppppp/2n2n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "e7e5", "r1bqkb1r/pp1p1ppp/2n2n2/4p3/3NP3/2N5/PPP2PPP/R1BQKB1R": "d4e2", "r1bqkb1r/pp1p1ppp/2n2n2/1N2p3/4P3/2N5/PPP2PPP/R1BQKB1R": "d7d6", "r1bqkb1r/pp3ppp/2np1n2/1N2p3/4P3/2N5/PPP2PPP/R1BQKB1R": "c1g5", "r1bqkb1r/pp3ppp/2np1n2/1N2p1B1/4P3/2N5/PPP2PPP/R2QKB1R": "a7a6", "rnbqkb1r/pp3ppp/3ppn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R": "a7a6", "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR": "d2d4",
            "rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR": "d7d5", "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR": "b1c3", "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR": "g8f6", "rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR": "c1g5", "rnbqkb1r/ppp2ppp/4pn2/3p2B1/3PP3/2N5/PPP2PPP/R2QKBNR": "h7h6", "rnbqk2r/ppp1bppp/4pn2/3p2B1/3PP3/2N5/PPP2PPP/R2QKBNR": "e4e5", "rnbqkb1r/ppp2pp1/4pn1p/3p2B1/3PP3/2N5/PPP2PPP/R2QKBNR": "g5h4", "rnbqkb1r/ppp2pp1/4pn1p/3p4/3PP2B/2N5/PPP2PPP/R2QKBNR": "a7a6",
            "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR": "d2d4", "rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR": "d7d5", "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR": "e4d5", "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR": "d5e4", "rnbqkbnr/pp2pppp/2p5/8/3Pp3/2N5/PPP2PPP/R1BQKBNR": "c3e4", "rnbqkbnr/pp2pppp/2p5/8/3PN3/8/PPP2PPP/R1BQKBNR": "c8f5", "rn1qkbnr/pp2pppp/2p5/5b2/3PN3/8/PPP2PPP/R1BQKBNR": "e4d6", "rnbqkbnr/pp2pppp/2p5/3P4/3P4/8/PPP2PPP/RNBQKBNR": "c6d5",
            "rnbqkbnr/pp2pppp/8/3p4/3P4/8/PPP2PPP/RNBQKBNR": "b1c3", "rnbqkbnr/pp2pppp/8/3p4/3P4/2N5/PPP2PPP/R1BQKBNR": "g8f6", "rnbqkb1r/pp2pppp/5n2/3p4/3P4/2N5/PPP2PPP/R1BQKBNR": "g1f3", "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR": "c7c5", "rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR": "b1c3", "rnbqkbnr/pppp1ppp/8/4p3/2P5/2N5/PP1PPPPP/R1BQKBNR": "g8f6", "rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N5/PP1PPPPP/R1BQKBNR": "g2g3", "rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "b7b6",
            "rnbqkb1r/ppp2ppp/5n2/3pp3/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "c4d5", "rnbqkb1r/p1pp1ppp/1p3n2/4p3/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "f1g2", "rnbqkb1r/p1pp1ppp/1p3n2/4p3/2P5/2N3P1/PP1PPPBP/R1BQK1NR": "c8b7", "rn1qkb1r/pbpp1ppp/1p3n2/4p3/2P5/2N3P1/PP1PPPBP/R1BQK1NR": "d2d3", "rn1qkb1r/pbpp1ppp/1p3n2/4p3/2P5/2NP2P1/PP2PPBP/R1BQK1NR": "d7d5", "rn1qkb1r/pbp2ppp/1p3n2/3pp3/2P5/2NP2P1/PP2PPBP/R1BQK1NR": "c4d5", "rnbqkbnr/pp1ppppp/8/2p5/2P5/8/PP1PPPPP/RNBQKBNR": "g1f3", "rnbqkbnr/pp1ppppp/8/2p5/2P5/2N5/PP1PPPPP/R1BQKBNR": "b8c6",
            "r1bqkbnr/pp1ppppp/2n5/2p5/2P5/2N5/PP1PPPPP/R1BQKBNR": "g2g3", "r1bqkbnr/pp1ppppp/2n5/2p5/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "g7g6", "r1bqkbnr/pp1ppp1p/2n3p1/2p5/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "f1g2", "rnbqkbnr/pppp1ppp/4p3/8/2P5/8/PP1PPPPP/RNBQKBNR": "b1c3", "rnbqkbnr/pppp1ppp/4p3/8/2P5/2N5/PP1PPPPP/R1BQKBNR": "g8f6", "rnbqkb1r/pppp1ppp/4pn2/8/2P5/2N5/PP1PPPPP/R1BQKBNR": "g2g3", "rnbqkb1r/pppp1ppp/4pn2/8/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "d7d5", "rnbqkb1r/ppp2ppp/4pn2/3p4/2P5/2N3P1/PP1PPP1P/R1BQKBNR": "f1g2",
            "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R": "g8f6", "rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R": "c2c4", "rnbqkbnr/ppp1pppp/8/3p4/2P5/5N2/PP1PPPPP/RNBQKB1R": "e7e6", "rnbqkbnr/ppp2ppp/4p3/3p4/2P5/5N2/PP1PPPPP/RNBQKB1R": "g2g3", "rnbqkbnr/ppp2ppp/4p3/3p4/2P5/5NP1/PP1PPP1P/RNBQKB1R": "g8f6", "rnbqkb1r/ppp2ppp/4pn2/3p4/2P5/5NP1/PP1PPP1P/RNBQKB1R": "f1g2", "rnbqkb1r/ppp2ppp/4pn2/3p4/2P5/5NP1/PP1PPPBP/RNBQK2R": "f8e7", "rnbqk2r/ppp1bppp/4pn2/3p4/2P5/5NP1/PP1PPPBP/RNBQK2R": "e1g1",
            "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R": "c2c4", "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR": "d7d5", "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR": "c2c4", "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "e7e6", "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "b1c3", "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR": "g8f6", "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR": "g1f3", "rnbqkb1r/ppp2ppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR": "h7h6",
            "rnbqk2r/ppp1bppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR": "e2e3", "rnbqkb1r/ppp2pp1/4pn1p/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR": "g5h4", "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R": "d5c4", "rnbqkb1r/ppp2ppp/4pn2/3P4/3P4/2N5/PP2PPPP/R1BQKBNR": "e6d5", "rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR": "g1f3", "rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "b1c3", "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR": "c2c4", "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR": "e7e6",
            "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR": "b1c3", "rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR": "d7d5", "rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR": "e2e4", "rnbqk2r/ppppppbp/5np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR": "d7d6", "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR": "f1e2", "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R": "e8g8", "rnbq1rk1/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R": "f1e2", "rnbq1rk1/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQK2R": "e7e5",
            "rnbq1rk1/ppp2pbp/3p1np1/4p3/2PPP3/2N2N2/PP2BPPP/R1BQK2R": "d4d5", "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR": "g1f3", "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/2N5/PP2PPPP/R1BQKBNR": "f8b4", "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR": "e2e3", "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N1P3/PP3PPP/R1BQKBNR": "d7d5", "rnbq1rk1/pppp1ppp/4pn2/8/1bPP4/2N1P3/PP3PPP/R1BQKBNR": "g1f3", "rnbqk2r/p1pp1ppp/1p2pn2/8/1bPP4/2N1P3/PP3PPP/R1BQKBNR": "f1d3", "rnbqk2r/p1pp1ppp/1p2pn2/8/1bPP4/2NBP3/PP3PPP/R1BQK1NR": "c8b7",
            "rn1qk2r/pbpp1ppp/1p2pn2/8/1bPP4/2NBP3/PP3PPP/R1BQK1NR": "g1e2", "rnbqk2r/ppp2ppp/4pn2/3p4/1bPP4/2N1P3/PP3PPP/R1BQKBNR": "f1d3", "rnbqkb1r/pp1ppppp/5n2/2p5/2PP4/8/PP2PPPP/RNBQKBNR": "d4d5", "rnbqkb1r/pp1ppppp/5n2/2pP4/2P5/8/PP2PPPP/RNBQKBNR": "b7b5", "rnbqkb1r/pp1p1ppp/4pn2/2pP4/2P5/8/PP2PPPP/RNBQKBNR": "b1c3", "rnbqkb1r/pp1p1ppp/4pn2/2pP4/2P5/2N5/PP2PPPP/R1BQKBNR": "e6d5", "rnbqkb1r/pp1p1ppp/5n2/2pp4/2P5/2N5/PP2PPPP/R1BQKBNR": "c4d5", "rnbqkb1r/pp1p1ppp/5n2/2pP4/8/2N5/PP2PPPP/R1BQKBNR": "d7d6",
            "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR": "d2d4", "rnbqkbnr/ppp1pppp/3p4/8/3PP3/8/PPP2PPP/RNBQKBNR": "g8f6", "rnbqkb1r/ppp1pppp/3p1n2/8/3PP3/8/PPP2PPP/RNBQKBNR": "b1c3", "rnbqkb1r/ppp1pppp/3p1n2/8/3PP3/2N5/PPP2PPP/R1BQKBNR": "g7g6", "rnbqkb1r/ppp1pp1p/3p1np1/8/3PP3/2N5/PPP2PPP/R1BQKBNR": "c1e3", "rnbqkb1r/ppp1pp1p/3p1np1/8/3PP3/2N1B3/PPP2PPP/R2QKBNR": "f8g7", "rnbqk2r/ppp1ppbp/3p1np1/8/3PP3/2N1B3/PPP2PPP/R2QKBNR": "d1d2", "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR": "e4d5",
            "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR": "d8d5", "rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR": "b1c3", "rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR": "d5a5", "rnb1kbnr/ppp1pppp/8/q7/8/2N5/PPPP1PPP/R1BQKBNR": "d2d4", "rnb1kbnr/ppp1pppp/8/q7/3P4/2N5/PPP2PPP/R1BQKBNR": "g8f6", "rnb1kb1r/ppp1pppp/5n2/q7/3P4/2N5/PPP2PPP/R1BQKBNR": "g1f3", "rnb1kb1r/ppp1pppp/5n2/q7/3P4/2N2N2/PPP2PPP/R1BQKB1R": "c8f5", "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR": "g1f3",
            "rnbqkb1r/pppppppp/5n2/8/4P3/5N2/PPPP1PPP/RNBQKB1R": "g7g6", "rnbqkb1r/pppppp1p/5np1/8/4P3/5N2/PPPP1PPP/RNBQKB1R": "d2d4", "rnbqkb1r/pppppp1p/5np1/8/3PP3/5N2/PPP2PPP/RNBQKB1R": "d7d6", "rnbqkb1r/ppp1pp1p/3p1np1/8/3PP3/5N2/PPP2PPP/RNBQKB1R": "b1c3", "rnbqkb1r/ppp1pp1p/3p1np1/8/3PP3/2N2N2/PPP2PPP/R1BQKB1R": "f8g7", "rnbqk2r/ppp1ppbp/3p1np1/8/3PP3/2N2N2/PPP2PPP/R1BQKB1R": "c1e3", "rnbqk2r/ppp1ppbp/3p1np1/8/3PP3/2N1BN2/PPP2PPP/R2QKB1R": "c7c5", "rnbqkb1r/ppp2ppp/3p1n2/8/4P3/5N2/PPPP1PPP/RNBQKB1R": "f6e4",
            "rnbqkb1r/ppp2ppp/3p4/8/4n3/5N2/PPPP1PPP/RNBQKB1R": "d2d4", "rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR": "g8f6", "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR": "g1f3", "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR": "f1c4", "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R": "b8c6", "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R": "f1c4", "rnbqkbnr/ppp1pppp/8/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R": "g8f6", "rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R": "c1g5",
            "rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R": "e7e6", "rnbqkb1r/ppp2ppp/4pn2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R": "e2e3", "rnbqkb1r/ppp2ppp/4pn2/3p4/3P1B2/4PN2/PPP2PPP/RN1QKB1R": "f8d6", "rnbqk2r/ppp2ppp/3bpn2/3p4/3P1B2/4PN2/PPP2PPP/RN1QKB1R": "f4d6", "rnbqkb1r/pppppppp/5n2/8/3P4/5N2/PPP1PPPP/RNBQKB1R": "d7d5", "rnbqkb1r/ppp1pppp/5n2/3p4/3P4/4PN2/PPP2PPP/RNBQKB1R": "c7c5", "rnbqkb1r/ppp2ppp/4pn2/3p4/3P4/4PN2/PPP2PPP/RNBQKB1R": "f1d3", "rnbqkb1r/pp2pppp/5n2/2pp4/3P4/4PN2/PPP2PPP/RNBQKB1R": "c2c3",
            "rnbqkb1r/ppp1pppp/5n2/3p2B1/3P4/5N2/PPP1PPPP/RN1QKB1R": "e7e6", "rnbqkb1r/ppp2ppp/4pn2/3p2B1/3P4/5N2/PPP1PPPP/RN1QKB1R": "g5f6", "rnbqkbnr/pp2pppp/2p5/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR": "g8f6", "rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR": "g1f3", "rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R": "d5c4", "rnbqkb1r/pp2pppp/2p2n2/8/2pP4/2N2N2/PP2PPPP/R1BQKB1R": "c1f4", "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R": "b7b6", "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R": "g2g3",
            "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/5NP1/PP2PP1P/RNBQKB1R": "f8e7", "rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/5NP1/PP2PP1P/RNBQKB1R": "f1g2", "rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/5NP1/PP2PPBP/RNBQK2R": "e8g8", "rnbq1rk1/ppp1bppp/4pn2/3p4/2PP4/5NP1/PP2PPBP/RNBQK2R": "e1g1", "rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR": "c2c4", "rnbqkbnr/ppppp1pp/8/5p2/2PP4/8/PP2PPPP/RNBQKBNR": "g8f6", "rnbqkb1r/ppppp1pp/5n2/5p2/2PP4/8/PP2PPPP/RNBQKBNR": "b1c3", "rnbqkb1r/ppppp1pp/5n2/5p2/2PP4/2N5/PP2PPPP/R1BQKBNR": "e7e6",
            "rnbqkb1r/pppp2pp/4pn2/5p2/2PP4/2N5/PP2PPPP/R1BQKBNR": "g2g3", "rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR": "e2e4", "rnbqkb1r/ppp1pp1p/5np1/3p4/2PPP3/2N5/PP3PPP/R1BQKBNR": "f8g7", "rnbqk2r/ppp1ppbp/5np1/3p4/2PPP3/2N5/PP3PPP/R1BQKBNR": "g1f3", "rnbqk2r/ppp1ppbp/5np1/3p4/2PPP3/2N2N2/PP3PPP/R1BQKB1R": "e8g8", "rnbqkb1r/pppp1ppp/5n2/4p3/2PP4/8/PP2PPPP/RNBQKBNR": "d4d5", "rnbqkb1r/pppp1ppp/5n2/3Pp3/2P5/8/PP2PPPP/RNBQKBNR": "f6e4", "rnbqkb1r/p2ppppp/5n2/1ppP4/2P5/8/PP2PPPP/RNBQKBNR": "g1f3",
            "rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR": "d7d5", "rnbqkbnr/ppp1pppp/8/3p4/5P2/8/PPPPP1PP/RNBQKBNR": "g1f3", "rnbqkbnr/ppp1pppp/8/3p4/5P2/5N2/PPPPP1PP/RNBQKB1R": "g8f6", "rnbqkb1r/ppp1pppp/5n2/3p4/5P2/5N2/PPPPP1PP/RNBQKB1R": "e2e3", "rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR": "d7d5", "rnbqkbnr/ppp1pppp/8/3p4/8/1P6/P1PPPPPP/RNBQKBNR": "c1b2", "rnbqkbnr/ppp1pppp/8/3p4/8/1P6/PBPPPPPP/RN1QKBNR": "g8f6", "rnbqkb1r/ppp1pppp/5n2/3p4/8/1P6/PBPPPPPP/RN1QKBNR": "e2e4",
            "rnbqkb1r/p1pp1ppp/1p2pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R": "g2g3", "rnbqkbnr/pp1ppppp/8/2p5/2P5/5N2/PP1PPPPP/RNBQKB1R": "g8f6", "rnbqkb1r/pp1ppppp/5n2/2p5/2P5/5N2/PP1PPPPP/RNBQKB1R": "d2d4", "rnbqkb1r/pp1ppppp/5n2/2p5/2PP4/5N2/PP2PPPP/RNBQKB1R": "c5d4", "rnbqkb1r/pp1ppppp/5n2/8/2Pp4/5N2/PP2PPPP/RNBQKB1R": "f3d4", "r1bqk2r/ppp2ppp/2n2n2/2bPp3/2B5/2PP1N2/PP3PPP/RNBQK2R": "f6d5", "r1bq1rk1/2ppbppp/p1n2n2/1p2p3/4P3/1B3N2/PPPP1PPP/RNBQR1K1": "c2c3", "r1bqkbnr/pp1ppp1p/2n3p1/8/3NP3/8/PPP2PPP/RNBQKB1R": "b1c3",
            "r1bqkbnr/pp1ppp1p/2n3p1/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "f8g7", "r1bqk1nr/pp1pppbp/2n3p1/8/3NP3/2N5/PPP2PPP/R1BQKB1R": "e4e5", "rnbqkbnr/pp3ppp/4p3/3p4/3NP3/8/PPP2PPP/RNBQKB1R": "e4d5", "rnbqk1nr/1pp1ppbp/p2p2p1/8/3PP3/2N1B3/PPPQ1PPP/R3KBNR": "b7b5", "rnbqk1nr/2p1ppbp/p2p2p1/1p6/3PP3/2N1B3/PPPQ1PPP/R3KBNR": "e4e5"
        },

        lookup: (fen) => {
            const parts = fen.split(" ");
            const boardOnly = parts[0];
            return OpeningBook.book[boardOnly] || null;
        },

        enabled: true,
    };

    // ─── THREAT DETECTION ────────────────────────────────────────────────────
    const ThreatDetector = {
        threatMove: null,
        threatScore: null,
        highlightEls: [],
        redrawInterval: null,

        show: () => {
            ThreatDetector.clear();
            if (!state.board) return;
            const move = ThreatDetector.threatMove;
            if (!move || move.length < 4) return;
            ThreatDetector.draw();

            // Redraw every 50ms so Chess.com board re-renders can't wipe the highlight.
            // (Same survival trick the regular bot-highlights use.)
            if (ThreatDetector.redrawInterval) clearInterval(ThreatDetector.redrawInterval);
            ThreatDetector.redrawInterval = setInterval(() => {
                if (!ThreatDetector.threatMove) { ThreatDetector.clear(); return; }
                if (!document.contains(state.board)) { ThreatDetector.reset(); return; }
                ThreatDetector.draw();
            }, 50);

            // Show threat score in status if available
            if (ThreatDetector.threatScore) {
                const scoreStr = typeof ThreatDetector.threatScore === 'string' && ThreatDetector.threatScore.startsWith('-') ? ThreatDetector.threatScore : '+' + ThreatDetector.threatScore;
                state.lastLiveResult = `<div><span style="color:#ff4444; font-weight:bold;">⚠ Threat!</span> ${ThreatDetector.threatMove} (${scoreStr})</div>`;
            }
        },

        draw: () => {
            const board = state.board;
            if (!board) return;
            const move = ThreatDetector.threatMove;
            if (!move || move.length < 4) return;

            // If the highlight already survives in the DOM, skip redraw (prevents stacking)
            const root = ShadowKit.boardRoot(board);
            const hasDivs = root.querySelectorAll(".threat-highlight").length > 0;
            const hasArrow = root.querySelector("#threat-arrow");
            if (hasDivs && hasArrow) return;
            // Partial leftovers after a re-render → clear and redraw fresh
            root.querySelectorAll(".threat-highlight, #threat-arrow").forEach(el => el.remove());

            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            // Ensure board has positioning context for absolute children
            if (!board.style.position || board.style.position === 'static') {
                board.style.position = 'relative';
            }
            // Ensure overflow is visible so highlights aren't clipped
            if (board.style.overflow === 'hidden') board.style.overflow = 'visible';

            const isFlipped = Platform.isFlipped(board);

            // Draw red highlight on attacking piece's source square
            const drawSquare = (sq, alpha) => {
                const sqId = `${sq.charCodeAt(0)-96}${sq.charAt(1)}`;
                const file = sq.charCodeAt(0) - 97;
                const rank = parseInt(sq[1]) - 1;
                const x = isFlipped ? (7-file)*12.5 : file*12.5;
                const y = isFlipped ? rank*12.5 : (7-rank)*12.5;
                const div = document.createElement("div");
                div.className = `square-${sqId} threat-highlight`;
                div.style.cssText = `
                    position: absolute; pointer-events: none; z-index: 1000001;
                    left: ${x}%; top: ${y}%;
                    width: 12.5%; height: 12.5%; box-sizing: border-box;
                    background: rgba(255, 0, 0, ${alpha}); border: 3px solid rgba(255,0,0,0.9);
                `;
                root.appendChild(div);
                ThreatDetector.highlightEls.push(div);
            };
            drawSquare(from, 0.5);
            drawSquare(to, 0.3);

            // Draw red arrow
            const ns = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(ns, "svg");
            svg.id = "threat-arrow";
            svg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:1000000;";

            const getSquareCoords = (sq) => {
                const file = sq.charCodeAt(0) - 97;
                const rank = parseInt(sq[1]) - 1;
                if (isFlipped) return { x: (7-file)*12.5+6.25, y: rank*12.5+6.25 };
                return { x: file*12.5+6.25, y: (7-rank)*12.5+6.25 };
            };
            const s = getSquareCoords(from);
            const e = getSquareCoords(to);
            const dx = e.x - s.x, dy = e.y - s.y;
            const len = Math.sqrt(dx*dx+dy*dy);
            if (len > 0) {
                const hLen = 5, hW = 3.5;
                const ux = dx/len, uy = dy/len;
                const ex2 = e.x - ux*hLen, ey2 = e.y - uy*hLen;
                const px = -uy, py = ux;
                svg.setAttribute("viewBox", "0 0 100 100");
                const line = document.createElementNS(ns, "line");
                line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
                line.setAttribute("x2", ex2); line.setAttribute("y2", ey2);
                line.setAttribute("stroke", "#ff0000"); line.setAttribute("stroke-width", "2.5");
                line.setAttribute("stroke-opacity", "0.85");
                const poly = document.createElementNS(ns, "polygon");
                poly.setAttribute("points", `${e.x},${e.y} ${ex2+px*(hW/2)},${ey2+py*(hW/2)} ${ex2-px*(hW/2)},${ey2-py*(hW/2)}`);
                poly.setAttribute("fill", "#ff0000"); poly.setAttribute("fill-opacity", "0.85");
                svg.appendChild(line); svg.appendChild(poly);
                root.appendChild(svg);
                ThreatDetector.highlightEls.push(svg);
            }
        },

        clear: () => {
            if (ThreatDetector.redrawInterval) { clearInterval(ThreatDetector.redrawInterval); ThreatDetector.redrawInterval = null; }
            ThreatDetector.highlightEls.forEach(el => el.remove());
            ThreatDetector.highlightEls = [];
            const tr = ShadowKit.boardRoot(state.board || Platform.getBoard());
            if (tr) tr.querySelectorAll(".threat-highlight, #threat-arrow").forEach(el => el.remove());
        },

        reset: () => {
            ThreatDetector.clear();
            ThreatDetector.threatMove = null;
            ThreatDetector.threatScore = null;
        },

        enabled: true,
    };

    // ─── INSTANT HIGHLIGHT REPOPULATION ──────────────────────────────────────
    // Chess.com re-renders the board constantly, wiping our overlay divs. The
    // 50ms redraw intervals are now a fallback only: this observer re-draws
    // immediately after any re-render, so highlights reappear within one frame
    // instead of up to 50ms later (feels instant, no lag).
    const HighlightObserver = {
        observer: null,
        node: null,
        ensure: () => {
            const board = state.board || Platform.getBoard();
            if (!board) return;
            if (HighlightObserver.observer && HighlightObserver.node === board) return;
            if (HighlightObserver.observer) HighlightObserver.observer.disconnect();
            HighlightObserver.node = board;
            HighlightObserver.observer = new MutationObserver(() => {
                if (!document.contains(HighlightObserver.node)) { HighlightObserver.disconnect(); return; }
                state.visuals.forEach(v => { if (!v.isFading) Visuals.draw(v.id, v.move); });
                ThreatDetector.draw();
                PV.draw();
            });
            HighlightObserver.observer.observe(board, { subtree: true, childList: true });
        },
        disconnect: () => {
            if (HighlightObserver.observer) { HighlightObserver.observer.disconnect(); HighlightObserver.observer = null; }
            HighlightObserver.node = null;
        },
    };


    function drawPVArrow(move, id, color, index) {
        if (!state.board) return;
        let isFlipped = Platform.isFlipped(state.board);
        const from = move.substring(0, 2), to = move.substring(2, 4);
        const getCoords = (sq) => {
            const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1]) - 1;
            return isFlipped ? { x: (7-file)*12.5+6.25, y: rank*12.5+6.25 } : { x: file*12.5+6.25, y: (7-rank)*12.5+6.25 };
        };
        const start = getCoords(from), end = getCoords(to);
        const dx = end.x - start.x, dy = end.y - start.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len === 0) return;
        const scale = (settings.arrowWidth || 15) / 15;
        const headLen = 4*scale, headWidth = 3*scale, lineWidth = 1.0*scale;
        const ux = dx/len, uy = dy/len;
        const endLineX = end.x - ux*headLen, endLineY = end.y - uy*headLen;
        const px = -uy, py = ux;
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", `pv-arrow ${id}`);
        svg.dataset.move = move;
        svg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:900;";
        svg.setAttribute("viewBox", "0 0 100 100");
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", start.x); line.setAttribute("y1", start.y);
        line.setAttribute("x2", endLineX); line.setAttribute("y2", endLineY);
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", lineWidth);
        line.setAttribute("stroke-opacity", settings.arrowOpacity || 0.8);
        line.setAttribute("stroke-linecap", "round");
        const poly = document.createElementNS(ns, "polygon");
        poly.setAttribute("points", `${end.x},${end.y} ${endLineX+px*(headWidth/2)},${endLineY+py*(headWidth/2)} ${endLineX-px*(headWidth/2)},${endLineY-py*(headWidth/2)}`);
        poly.setAttribute("fill", color); poly.setAttribute("fill-opacity", settings.arrowOpacity || 0.8);
        svg.appendChild(line); svg.appendChild(poly);
        if (settings.pvShowNumbers) {
            const text = document.createElementNS(ns, "text");
            text.setAttribute("x", (start.x+end.x)/2); text.setAttribute("y", (start.y+end.y)/2);
            text.setAttribute("dy", "0.3em"); text.setAttribute("text-anchor", "middle");
            text.setAttribute("fill", "#fff"); text.setAttribute("font-size", "2.5");
            text.setAttribute("font-weight", "bold"); text.setAttribute("stroke", "#000");
            text.setAttribute("stroke-width", "0.1"); text.textContent = index;
            svg.appendChild(text);
        }
        ShadowKit.boardRoot(state.board).appendChild(svg);
    }
    function drawArrow(move, id) {
        const color = settings.highlightColor, opacity = settings.arrowOpacity, width = settings.arrowWidth;
        let isFlipped = Platform.isFlipped(state.board);
        const from = move.substring(0, 2), to = move.substring(2, 4);
        const getCoords = (sq) => {
            const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1]) - 1;
            return isFlipped ? { x: (7-file)*12.5+6.25, y: rank*12.5+6.25 } : { x: file*12.5+6.25, y: (7-rank)*12.5+6.25 };
        };
        const start = getCoords(from), end = getCoords(to);
        const dx = end.x - start.x, dy = end.y - start.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len === 0) return;
        const scale = width/15, headLen = 4*scale, headWidth = 3*scale, lineWidth = 1.2*scale;
        const ux = dx/len, uy = dy/len;
        const endLineX = end.x - ux*headLen, endLineY = end.y - uy*headLen;
        const px = -uy, py = ux;
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", `bot-highlight ${id}`);
        svg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:200;";
        svg.setAttribute("viewBox", "0 0 100 100");
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", start.x); line.setAttribute("y1", start.y);
        line.setAttribute("x2", endLineX); line.setAttribute("y2", endLineY);
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", lineWidth);
        line.setAttribute("stroke-opacity", opacity);
        const polygon = document.createElementNS(ns, "polygon");
        polygon.setAttribute("points", `${end.x},${end.y} ${endLineX+px*(headWidth/2)},${endLineY+py*(headWidth/2)} ${endLineX-px*(headWidth/2)},${endLineY-py*(headWidth/2)}`);
        polygon.setAttribute("fill", color); polygon.setAttribute("fill-opacity", opacity);
        svg.appendChild(line); svg.appendChild(polygon);
        ShadowKit.boardRoot(state.board).appendChild(svg);
    }
    // --- EVAL STATUS LOGIC ---
    function getEvalStatusData(val, isMate) {
        // val is already normalized to "our perspective" (positive = good for us)
        const relativeScore = val;
        if (isMate) {
            if (relativeScore > 0) return { text: "Significant Advantage (Mate)", color: "#00ff00" };
            return { text: "Significant Disadvantage (Mate)", color: "#ff0000" };
        }
        if (relativeScore > 3) return { text: "Significant Advantage", color: "#00ff00" };
        if (relativeScore > 1.5) return { text: "Clear Advantage", color: "#55ff55" };
        if (relativeScore > 0.5) return { text: "Decisive Advantage", color: "#81b64c" };
        if (relativeScore > 0.25) return { text: "Slight Advantage", color: "#aaffaa" };
        if (relativeScore >= -0.25) return { text: "Equal", color: "#aaaaaa" };
        if (relativeScore >= -0.5) return { text: "Slight Disadvantage", color: "#ffaaaa" };
        if (relativeScore >= -1.5) return { text: "Decisive Disadvantage", color: "#ff7777" };
        if (relativeScore >= -3) return { text: "Clear Disadvantage", color: "#ff4444" };
        return { text: "Significant Disadvantage", color: "#ff0000" };
    }

    // --- SF18 ENGINE CORE ---

    // ─── MULTI-MODEL ENGINE CORE ──────────────────────────────────────────────

    // Send UCI init commands appropriate for the selected engine model
    function sendEngineInitCommands(eng) {
        const m = getEngineById(eng || settings.localModelId);
        const cmds = ["ucinewgame"];
        if (m.hasHash)         cmds.push(`setoption name Hash value ${settings.localHashMB}`);
        if (m.hasMoveOverhead) cmds.push(`setoption name Move Overhead value ${settings.localMoveOverhead}`);
        if (m.hasSlowMover)    cmds.push(`setoption name Slow Mover value ${settings.localSlowMover}`);
        if (m.hasMinThink)     cmds.push(`setoption name Minimum Thinking Time value ${settings.localMinThinkTime}`);
        if (m.hasWDL)          cmds.push(`setoption name UCI_ShowWDL value ${settings.localShowWDL}`);
        if (m.hasSkillLevel)   cmds.push(`setoption name Skill Level value ${settings.localSkillLevel}`);
        if (m.hasNNUE) {
            cmds.push(`setoption name UCI_LimitStrength value ${settings.localLimitStrength}`);
            cmds.push(`setoption name UCI_Elo value ${settings.localElo}`);
        }
        if (m.hasContempt) cmds.push(`setoption name Contempt value ${settings.localContempt}`);
        cmds.push("setoption name MultiPV value 1");
        cmds.forEach(c => state.localEngine.postMessage(c));
        state.lastMultiPV = 1;
    }

    const MODULE_CACHE_VERSION = 1;

    // Build a Worker from a patched JS blob (for WASM-based engines)
    function buildWasmPatchedEngine(jsCode, wasmBytes, compiledModule, wasmUrl) {
        const moduleMode = !!compiledModule;
        const bootstrapCode = `
var _wasmBytes = null;
var _wasmModule = null;
var _modulePosted = false;
self.postMessage("__probe:bootstrap-ready");
var _probeCount = 0;
setInterval(function(){ self.postMessage("__probe:beacon " + Math.round(performance.now())); }, 3000);
var _logFetch = function(u) { if (_probeCount++ < 20) self.postMessage("__probe:fetch " + String(u)); };
self.fetch = function(url, opts) {
    _logFetch(url);
    return Promise.resolve({
        ok: true,
        arrayBuffer: function() {
            self.postMessage("__probe:arrayBuffer-read n=" + (_wasmBytes ? _wasmBytes.length : 0));
            return Promise.resolve(_wasmBytes.buffer);
        }
    });
};
self.onmessage = function(e) {
    var d = e.data || {};
    if (d.__type === "launch" || d.__type === "launch-module") {
        if (d.wasmModule) {
            _wasmModule = d.wasmModule;
            _modulePosted = true;
            _wasmBytes = new Uint8Array(32);
            self.postMessage("__probe:module-mode");
        } else {
            _wasmBytes = new Uint8Array(d.wasmBytes);
            self.postMessage("__probe:bytes-received n=" + _wasmBytes.length);
        }
        self.onmessage = null;
        try {
            var F = new Function(d.jsCode);
            F();
        } catch (err) {
            self.postMessage("__probe:loader-error " + (err && err.message || err));
            throw err;
        }
    }
};
`;
        const blob = new Blob([bootstrapCode], { type: "application/javascript" });
        const worker = new Worker(URL.createObjectURL(blob));
        if (moduleMode) {
            worker.postMessage({ __type: "launch-module", jsCode: jsCode, wasmModule: compiledModule }, [compiledModule]);
        } else {
            const ab = wasmBytes instanceof ArrayBuffer ? wasmBytes : wasmBytes.buffer;
            worker.postMessage({ __type: "launch", jsCode: jsCode, wasmBytes: ab }, [ab]);
        }
        return worker;
    }

    // Build a Worker from a pure asm.js JS string (for old SF 6/8/10/11)
    function buildAsmJsEngine(jsCode) {
        const blob = new Blob([jsCode], { type: "application/javascript" });
        return new Worker(URL.createObjectURL(blob));
    }

    function finalizeEngine(modelId) {
        if (state.engineLoadWatchdog) { clearTimeout(state.engineLoadWatchdog); state.engineLoadWatchdog = null; }
        state.engineLoadingInProgress = false;
        // Don't set ready yet — wait for uciok from the engine
        setEngineStatus("loading", "Initializing...");
        const m = getEngineById(modelId);
        console.log(`[SF Engine] ${m.label} worker built, sending uci...`);
        state.engineBuildTime = performance.now();
        console.debug(`[SF Engine] Model caps:`, { hasHash: m.hasHash, hasMoveOverhead: m.hasMoveOverhead, hasSlowMover: m.hasSlowMover, hasWDL: m.hasWDL, hasSkillLevel: m.hasSkillLevel, hasNNUE: m.hasNNUE, hasContempt: m.hasContempt, hasMinThink: m.hasMinThink, maxDepth: m.maxDepth });
        // uci handshake → engine replies uciok → handleLocalMessage flips to ready
        state.localEngine.postMessage("uci");
        // Send all init options after uci (engine queues them internally)
        sendEngineInitCommands(modelId);
        state.localEngine.postMessage("isready");
        updateUI();
        updateLocalSettingsUI();

        // Heartbeat instead of a fixed kill-timeout: the 112MB wasm can take a
        // long time to compile+init (original code had NO timeout and just
        // waited). Every 15s while loading we send "isready"; a "readyok"
        // reply means the engine is alive and we keep waiting forever. Only
        // TWO consecutive missed heartbeats (dead worker) terminate it.
        // readyok also acknowledges the initial isready sent above.
        state.pendingReadyProbe = true;
        state.heartbeatMisses = 0;
        const stopHeartbeat = () => {
            if (state.engineHeartbeatTimer) { clearInterval(state.engineHeartbeatTimer); state.engineHeartbeatTimer = null; }
            state.pendingReadyProbe = false;
        };
        state.engineHeartbeatTimer = setInterval(() => {
            if (!state.localEngine || state.engineStatus !== "loading") { stopHeartbeat(); return; }
            // Worker-side probes (3s alive beacon) reset the miss counter —
            // beacons prove the event loop is free; their absence means the
            // script is blocked (dead or mid-compile). A blocked-but-alive
            // worker gets 6 misses (90s) before we declare it dead.
            if (state.lastWorkerProbeAt && performance.now() - state.lastWorkerProbeAt < 3500) {
                state.heartbeatMisses = 0;
                return;
            }
            if (state.pendingReadyProbe) {
                state.heartbeatMisses++;
                const elapsed = Math.round((performance.now() - (state.engineBuildTime || performance.now())) / 1000);
                console.warn(`[SF Engine] heartbeat miss ${state.heartbeatMisses}/6 at ${elapsed}s — worker unresponsive`);
                if (state.heartbeatMisses >= 6) {
                    stopHeartbeat();
                    const errMsg = `Engine worker unresponsive (${elapsed}s, 2 missed heartbeats). Model: ${m.label} (${modelId}). Check: 1) blob wasm URL fetch working? 2) CSP blocking worker? 3) JS parse error in worker?`;
                    console.error(`[SF Engine] ${errMsg}`);
                    try { state.localEngine.terminate(); } catch (e) { console.error(`[SF Engine] Error terminating worker:`, e); }
                    state.localEngine = null;
                    setEngineStatus("error", errMsg);
                    updateUI();
                    return;
                }
            } else {
                state.heartbeatMisses = 0;
                const elapsed = Math.round((performance.now() - (state.engineBuildTime || performance.now())) / 1000);
                console.log(`[SF Engine] engine alive at ${elapsed}s, still initializing — waiting`);
            }
            try { state.localEngine.postMessage("isready"); } catch (e) { console.error(`[SF Engine] heartbeat postMessage failed:`, e); }
            state.pendingReadyProbe = true;
        }, 15000);
    }

    function onEngineWorkerError(e) {
        if (state.engineHeartbeatTimer) { clearInterval(state.engineHeartbeatTimer); state.engineHeartbeatTimer = null; }
        state.pendingReadyProbe = false;
        const msg = e?.message || String(e);
        const filename = e?.filename || "unknown";
        const lineno = e?.lineno || "?";
        const colno = e?.colno || "?";
        const stack = e?.error?.stack || e?.stack || "no stack";

        // Classify error type
        let errorType = "Unknown";
        let suggestion = "";
        if (msg.includes("Maximum call stack size exceeded")) {
            errorType = "Infinite Recursion";
            suggestion = "Fetch interceptor calling itself. Check _origFetch is saved before override.";
        } else if (msg.includes("Failed to fetch") || msg.includes("fetch")) {
            errorType = "Fetch/WASM Load Failed";
            suggestion = "Fetch mock not returning valid Response. Check arrayBuffer()/blob()/headers implementation.";
        } else if (msg.includes("CompileError") || msg.includes("WebAssembly")) {
            errorType = "WASM Compile Error";
            suggestion = "WASM bytes corrupted or invalid. Clear cache (Reinstall) and re-download.";
        } else if (msg.includes("ReferenceError") || msg.includes("not defined")) {
            errorType = "JS Reference Error";
            suggestion = "Variable missing in patch code. Check _wasmBytes, _origFetch defined before use.";
        } else if (msg.includes("SecurityError") || msg.includes("CSP")) {
            errorType = "CSP/Security Blocked";
            suggestion = "Chess.com CSP blocking blob worker. Try 'Reinstall' to force fresh worker.";
        } else if (msg.includes("out of memory") || msg.includes("OOM")) {
            errorType = "Out of Memory";
            suggestion = "WASM too large (112MB). Close other tabs, reload page.";
        }

        const fullError = `[${errorType}] ${msg} at ${filename}:${lineno}:${colno}. Suggestion: ${suggestion}`;
        console.error(`[SF Engine] Worker error: ${fullError}`);
        console.error(`[SF Engine] Stack: ${stack}`);
        const currentModel = getEngineById(settings.localModelId || "sf18_05");
        console.error(`[SF Engine] Context: engineStatus=${state.engineStatus}, model=${currentModel.label}, hasCache=${!!state.localEngine}`);

        handleError(`Engine Worker Error (${errorType})`, e);
        setEngineStatus("error", `${errorType}: ${msg}`);
        state.localEngine = null;
        state.engineLoadingInProgress = false;
        state.engineRetryAt = Date.now() + 15000;
    }

    // ─── Cache helpers ────────────────────────────────────────────────────────
    function openCache(cb) {
        if (typeof indexedDB === "undefined" || !indexedDB) { cb(new Error("IndexedDB unavailable"), null); return; }
        let settled = false;
        let dbReq = null;
        try {
            dbReq = indexedDB.open("sfEngineCache", 2);
        } catch (e) {
            cb(new Error("IndexedDB open threw: " + (e && e.message || e)), null);
            return;
        }
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cb(new Error("IndexedDB open timed out"), null);
        }, 5000);
        dbReq.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("engines")) db.createObjectStore("engines");
        };
        dbReq.onsuccess = (e) => { if (settled) return; settled = true; clearTimeout(timer); cb(null, e.target.result); };
        dbReq.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); cb(new Error("IndexedDB open failed"), null); };
        dbReq.onblocked = () => { if (settled) return; settled = true; clearTimeout(timer); cb(new Error("IndexedDB open blocked — continuing without cache"), null); };
    }

    function readCache(db, key, cb) {
        let done = false;
        const finish = (err, val) => { if (!done) { done = true; clearTimeout(timer); cb(err, val); } };
        const timer = setTimeout(() => finish(new Error("readCache timed out"), null), 4000);
        try {
            const req = db.transaction("engines", "readonly").objectStore("engines").get(key);
            req.onsuccess = (e) => finish(null, e.target.result || null);
            req.onerror = () => finish(null, null);
        } catch (e) { finish(null, null); }
    }

    function writeCache(db, key, data) {
        try {
            const tx = db.transaction("engines", "readwrite");
            tx.objectStore("engines").put(data, key);
        } catch (e) {}
    }

    function writeCacheAsync(db, key, data) {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
            const timer = setTimeout(finish, 4000);
            try {
                const tx = db.transaction("engines", "readwrite");
                tx.objectStore("engines").put(data, key);
                tx.oncomplete = () => finish();
                tx.onerror = () => finish();
            } catch (e) { finish(); }
        });
    }

    function deleteCache(db, key, cb) {
        try {
            const tx = db.transaction("engines", "readwrite");
            const req = tx.objectStore("engines").delete(key);
            tx.oncomplete = () => cb && cb();
            req.onerror = () => cb && cb();
        } catch (e) { cb && cb(); }
    }

    // ─── Download helpers ─────────────────────────────────────────────────────
    function xhrText(url, cb, errCb) {
        GM_xmlhttpRequest({
            method: "GET", url, timeout: 30000,
            onload: (r) => {
                if (r.status >= 400) { errCb(new Error(`HTTP ${r.status}`)); return; }
                cb(r.responseText);
            },
            onerror: (e) => errCb(new Error("Network error: " + url)),
            ontimeout: () => errCb(new Error("Timeout: " + url)),
        });
    }

    function xhrBinary(url, cb, errCb) {
        GM_xmlhttpRequest({
            method: "GET", url, responseType: "arraybuffer", timeout: 30000,
            onload: (r) => {
                if (r.status >= 400) { errCb(new Error(`HTTP ${r.status}`)); return; }
                cb(new Uint8Array(r.response));
            },
            onerror: (e) => errCb(new Error("Binary download failed: " + url)),
            ontimeout: () => errCb(new Error("Binary timeout: " + url)),
        });
    }

// ─── Main load entry point ────────────────────────────────────────────────
    function loadLocalEngine() {
            if (state.localEngine || state.engineLoadingInProgress) {
                console.log(`[SF Engine] loadLocalEngine skipped: localEngine=${!!state.localEngine}, loadingInProgress=${state.engineLoadingInProgress}`);
                return;
            }
            if (state.engineRetryAt && Date.now() < state.engineRetryAt) {
                console.log(`[SF Engine] loadLocalEngine skipped: retry cooldown active (${Math.ceil((state.engineRetryAt - Date.now()) / 1000)}s left)`);
                state.isThinking = false;
                state.lastSanitizedBoardFEN = "";
                return;
            }
            const loadGeneration = ++state.engineLoadGeneration;
            const isCurrentLoad = () => state.engineLoadGeneration === loadGeneration;
            console.log(`[SF Engine] loadLocalEngine START`);
            state.engineLoadingInProgress = true;
            state.isThinking = false;
            const modelId = settings.localModelId || "sf18_05";
            const m = getEngineById(modelId);
            const label = m.format === "asmjs" ? `${m.label} (asm.js)` : m.label;
            console.log(`[SF Engine] Loading model: ${label} (id=${modelId}, format=${m.format})`);
            console.debug(`[SF Engine] Model URLs: jsUrl=${m.jsUrl}, wasmUrl=${m.wasmUrl}`);
            setEngineStatus("loading", "Checking cache...");
            state.lastMoveResult = `⏳ Loading ${label}...`;
            updateUI();

            // Last-resort safety net: every earlier step (IDB open, cache reads) is
            // timeout-guarded, but if anything unforeseen stalls the chain, this
            // fires once after 120s of "loading" with no worker built and reports a
            // real error instead of leaving the engine stuck loading forever
            // (incognito/private mode often blocks or stalls IndexedDB).
            if (state.engineLoadWatchdog) { clearTimeout(state.engineLoadWatchdog); state.engineLoadWatchdog = null; }
            state.engineLoadWatchdog = setTimeout(() => {
                state.engineLoadWatchdog = null;
                if (!isCurrentLoad()) return;
                if (!state.localEngine && state.engineLoadingInProgress) {
                    state.engineLoadingInProgress = false;
                    state.isThinking = false;
                    state.pendingLocalFEN = null;
                    state.pendingLocalDepth = null;
                    state.engineLoadGeneration++;
                    state.engineRetryAt = Date.now() + 120000;
                    setEngineStatus("error", "Engine load timed out (storage/network stalled in this window). Try the Reinstall button or a normal window.");
                }
            }, 300000);

            openCache((dbErr, db) => {
                if (!isCurrentLoad()) return;
                if (dbErr) {
                    console.warn(`[SF Engine] IndexedDB open failed (continuing without cache):`, dbErr);
                }
                console.log(`[SF Engine] IndexedDB ${db ? 'opened' : 'unavailable'}`);

                if (m.format === "asmjs") {
                    // ── asm.js path: XHR the JS text, build Worker directly ──────
                    const launch = (jsCode) => {
                        if (!isCurrentLoad()) return;
                        try {
                            console.log(`[SF Engine] Building asm.js worker...`);
                            state.localEngine = buildAsmJsEngine(jsCode);
                            state.localEngine.onerror = onEngineWorkerError;
                            state.localEngine.onmessage = handleLocalMessage;
                            console.log(`[SF Engine] asm.js worker created, finalizing...`);
                            finalizeEngine(modelId);
                        } catch (e) {
                            ErrorReporter.capture('loadLocalEngine.launch.asmjs', e, { modelId });
                            console.error(`[SF Engine] Failed to build asm.js worker:`, e);
                            state.engineLoadingInProgress = false;
                            setEngineStatus("error", e.message || "Build failed");
                        }
                    };
                state.isThinking = false;
                state.pendingLocalFEN = null;
                state.pendingLocalDepth = null;
                state.engineLoadGeneration++;
                state.engineRetryAt = Date.now() + 120000;
                setEngineStatus("error", "Engine load timed out (storage/network stalled in this window). Try the Reinstall button or a normal window.");
            }
        }, 300000);

        openCache((dbErr, db) => {
            if (!isCurrentLoad()) return;
            if (dbErr) {
                console.warn(`[SF Engine] IndexedDB open failed (continuing without cache):`, dbErr);
            }
            console.log(`[SF Engine] IndexedDB ${db ? 'opened' : 'unavailable'}`);

            if (m.format === "asmjs") {
                // ── asm.js path: XHR the JS text, build Worker directly ──────
                const launch = (jsCode) => {
                    if (!isCurrentLoad()) return;
                    try {
                        console.log(`[SF Engine] Building asm.js worker...`);
                        state.localEngine = buildAsmJsEngine(jsCode);
                        state.localEngine.onerror = onEngineWorkerError;
                        state.localEngine.onmessage = handleLocalMessage;
                        console.log(`[SF Engine] asm.js worker created, finalizing...`);
                        finalizeEngine(modelId);
                    } catch (e) {
                        ErrorReporter.capture('loadLocalEngine.launch.asmjs', e, { modelId });
                        console.error(`[SF Engine] Failed to build asm.js worker:`, e);
                        state.engineLoadingInProgress = false;
                        setEngineStatus("error", e.message || "Build failed");
                    }
                };
                if (db) {
                        readCache(db, m.cacheKey, (_, cached) => {
                            if (!isCurrentLoad()) return;
                            if (cached) {
                                console.log(`[SF Engine] Found cached JS, loading from cache...`);
                                setEngineStatus("loading", "Loading from cache...");
                                launch(cached);
                            } else {
                                console.log(`[SF Engine] No cache, downloading JS from ${m.jsUrl}...`);
                                setEngineStatus("loading", "Downloading JS...");
                                xhrText(m.jsUrl,
                                    (js) => { if (!isCurrentLoad()) return; console.log(`[SF Engine] JS downloaded (${js.length} chars), caching...`); if (db) writeCache(db, m.cacheKey, js); launch(js); },
                                    (e)  => {
                                        if (!isCurrentLoad()) return;
                                        const err = `JS download failed: ${e.message || e}. URL: ${m.jsUrl}. Check: 1) Network connectivity 2) unpkg.com accessible 3) GM_xmlhttpRequest allowed`;
                                        console.error(`[SF Engine] ${err}`);
                                        state.engineLoadingInProgress = false;
                                        setEngineStatus("error", err);
                                    }
                                );
                            }
                        });
                    } else {
                        console.log(`[SF Engine] No IndexedDB, downloading JS directly...`);
                        xhrText(m.jsUrl, launch, (e) => {
                            if (!isCurrentLoad()) return;
                            const err = `JS download failed (no DB): ${e.message || e}. URL: ${m.jsUrl}. Check network.`;
                            console.error(`[SF Engine] ${err}`);
                            state.engineLoadingInProgress = false;
                            setEngineStatus("error", err);
                        });
                    }

            } else {
                // ── wasm format: cache BOTH js text and wasm bytes in IndexedDB ──
                // Keys: m.cacheKey + "_js" for the JS text, m.cacheKey + "_wasm" for bytes.
                // NEW: m.cacheKey + "_patched" for the fully patched worker blob (fastest load)
                // Optimized: download JS and WASM in PARALLEL for faster loading.
                const jsKey      = m.cacheKey + "_js";
                const wasmKey    = m.cacheKey + "_wasm";
                const patchedKey = m.cacheKey + "_patched";
                let fromPatchedCache = false;

                const launch = (jsCode, wasmBytes, compiledModule) => {
                    if (!isCurrentLoad()) return;
                    try {
                        const usingModule = !!compiledModule;
                        console.log(`[SF Engine] Building WASM-patched worker (${usingModule ? "COMPILED-MODULE mode" : "bytes mode"}: JS ${jsCode?.length || 0} chars, WASM ${wasmBytes?.length || 0} bytes)...`);
                        // Cache BEFORE building — buildWasmPatchedEngine transfers
                        // wasmBytes.buffer to the worker (zero-copy), which
                        // neuters the ArrayBuffer for structured cloning.
                        if (db && wasmBytes && !fromPatchedCache) {
                            console.log(`[SF Engine] Caching patched worker data...`);
                            writeCacheAsync(db, patchedKey, { jsCode, wasmBytes }).catch(() => {});
                        }
                        state.localEngine = buildWasmPatchedEngine(jsCode, wasmBytes, compiledModule, m.wasmUrl);
                        state.localEngine.onerror = onEngineWorkerError;
                        state.localEngine.onmessage = handleLocalMessage;
                        console.log(`[SF Engine] WASM worker created, finalizing...`);

                        finalizeEngine(modelId);
                    } catch (e) {
                        console.error(`[SF Engine] Failed to build WASM worker:`, e);
                        state.engineLoadingInProgress = false;
                        setEngineStatus("error", e.message || "Build failed");
                    }
                };

                // Fetch both JS and WASM in parallel, cache each independently
                const fetchJs = (resolve, reject) => {
                    const bundled = GM_getResourceText("stockfish.js");
                    if (bundled) {
                        console.log(`[SF Engine] Using bundled stockfish.js resource (${bundled.length} chars)`);
                        resolve(bundled); return;
                    }
                    if (db) {
                        readCache(db, jsKey, (_, cachedJs) => {
                            if (!isCurrentLoad()) return;
                            if (cachedJs) {
                                console.log(`[SF Engine] Found cached JS in IndexedDB (${cachedJs.length} chars)`);
                                resolve(cachedJs);
                            } else {
                                console.log(`[SF Engine] No cached JS, downloading from ${m.jsUrl}...`);
                                xhrText(m.jsUrl, (js) => { if (!isCurrentLoad()) return; console.log(`[SF Engine] JS downloaded (${js.length} chars), caching...`); writeCacheAsync(db, jsKey, js); resolve(js); }, reject);
                            }
                        });
                    } else {
                        console.log(`[SF Engine] No IndexedDB, downloading JS directly from ${m.jsUrl}...`);
                        xhrText(m.jsUrl, resolve, reject);
                    }
                };

                const fetchWasm = (resolve, reject) => {
                    if (!m.wasmUrl) { console.log(`[SF Engine] No WASM URL for this model`); resolve(null); return; }
                    if (db) {
                        readCache(db, wasmKey, (_, cachedWasm) => {
                            if (!isCurrentLoad()) return;
                            if (cachedWasm) {
                                console.log(`[SF Engine] Found cached WASM in IndexedDB (${cachedWasm.length} bytes)`);
                                resolve(cachedWasm);
                            } else {
                                console.log(`[SF Engine] No cached WASM, downloading from ${m.wasmUrl}...`);
                                xhrBinary(m.wasmUrl, (bytes) => { if (!isCurrentLoad()) return; console.log(`[SF Engine] WASM downloaded (${bytes.length} bytes), caching...`); writeCacheAsync(db, wasmKey, bytes); resolve(bytes); },
                                (e) => { if (!isCurrentLoad()) return; reject(new Error(`WASM download failed: ${e.message || e}. URL: ${m.wasmUrl}. Check: 1) Network 2) unpkg.com 3) ~113MB download allowed`)); });
                            }
                        });
                    } else {
                        console.log(`[SF Engine] No IndexedDB, downloading WASM directly from ${m.wasmUrl}...`);
                        xhrBinary(m.wasmUrl, resolve, (e) => reject(new Error(`WASM download failed (no DB): ${e.message || e}. URL: ${m.wasmUrl}`)));
                    }
                };

                // Check for a COMPILED MODULE first (fastest path — skips the
                // entire wasm compile; Module is structured-cloneable so IDB
                // can hold it). Engine updates (V8 upgrade) invalidate it —
                // the read/instantiate is wrapped and falls back to bytes.
                const moduleKey = patchedKey + "_module";
                state.engineModuleKey = moduleKey;
                state.engineDB = db;
                const tryCompiledModule = () => {
                    if (!db || state.engineModuleCacheBroken) return loadFromPatchedCache();
                    readCache(db, moduleKey, (_, cachedModule) => {
                        if (!isCurrentLoad()) return;
                        if (cachedModule && cachedModule.v === MODULE_CACHE_VERSION && cachedModule.module) {
                            console.log(`[SF Engine] Found COMPILED MODULE in IndexedDB — skipping compile!`);
                            fromPatchedCache = true;
                            setEngineStatus("loading", "Loading compiled module...");
                            // Only the 20KB loader JS is needed in module mode
                            if (db) {
                                readCache(db, jsKey, (_, cachedJs) => {
                                    if (!isCurrentLoad()) return;
                                    if (cachedJs) launch(cachedJs, null, cachedModule.module);
                                    else launchFromModuleWithJsFallback(cachedModule.module);
                                });
                            } else {
                                launchFromModuleWithJsFallback(cachedModule.module);
                            }
                        } else {
                            loadFromPatchedCache();
                        }
                    });
                };
                const launchFromModuleWithJsFallback = (mod) => {
                    fetchJs((js) => { if (js) launch(js, null, mod); else loadFromPatchedCache(); }, () => loadFromPatchedCache());
                };

                // Check for cached patched worker data second (bytes mode)
                const loadFromPatchedCache = () => {
                    if (db) {
                        readCache(db, patchedKey, (_, cachedPatched) => {
                            if (!isCurrentLoad()) return;
                            if (cachedPatched && cachedPatched.jsCode && cachedPatched.wasmBytes) {
                                console.log(`[SF Engine] Found cached PATCHED worker, instant load!`);
                                fromPatchedCache = true;
                                setEngineStatus("loading", "Loading from cache...");
                                launch(cachedPatched.jsCode, cachedPatched.wasmBytes);
                                return;
                            }
                            // No patched cache, fall through to normal parallel download
                        startParallelDownload();
                    });
                } else {
                            startParallelDownload();
                        }
                    };

                    tryCompiledModule();

                function startParallelDownload() {
                    setEngineStatus("loading", "Downloading engine...");
                    console.log(`[SF Engine] Starting parallel JS/WASM download...`);

                    const jsPromise      = new Promise(fetchJs);
                    const wasmPromise    = new Promise(fetchWasm);

                    Promise.all([jsPromise, wasmPromise])
                        .then(([jsCode, wasmBytes]) => {
                            if (!isCurrentLoad()) return;
                            console.log(`[SF Engine] Both downloads complete: JS=${!!jsCode}, WASM=${!!wasmBytes}`);
                            if (!jsCode) {
                                const err = "JS code unavailable after download. Both promises resolved but JS is empty.";
                                console.error(`[SF Engine] ${err}`);
                                state.engineLoadingInProgress = false;
                                setEngineStatus("error", err);
                                return;
                            }
                            launch(jsCode, wasmBytes);
                        })
                        .catch((e) => {
                            if (!isCurrentLoad()) return;
                            const msg = e?.message || String(e);
                            let err = `Download failed: ${msg}`;
                            if (msg.includes("WASM")) err += " (WASM download error - large file ~113MB, check network/quota)";
                            if (msg.includes("JS")) err += " (JS download error - small file, check unpkg.com)";
                            if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) err += " - network blocked or offline";
                            console.error(`[SF Engine] ${err}`);
                            state.engineLoadingInProgress = false;
                            setEngineStatus("error", err);
                        });
                }
            }
        });
    }
    function reinstallEngine() {
        if (state.engineLoadWatchdog) { clearTimeout(state.engineLoadWatchdog); state.engineLoadWatchdog = null; }
        if (state.localEngine) {
            try { state.localEngine.terminate(); } catch (e) {}
            state.localEngine = null;
        }
        state.engineLoadingInProgress = false;
        state.engineLoadGeneration++;
        state.engineRetryAt = 0;
        const m = getEngineById(settings.localModelId);
        setEngineStatus("loading", "Clearing cache...");
        state.engineModuleCacheBroken = false;
        state.engineModuleKey = null;
        openCache((dbErr, db) => {
            if (!db) { loadLocalEngine(); return; }
            // Delete JS, WASM, patched blob, compiled module, and legacy keys, then reload
            const patchedKey = m.cacheKey + "_patched";
            deleteCache(db, m.cacheKey + "_js",   () =>
                deleteCache(db, m.cacheKey + "_wasm", () =>
                    deleteCache(db, patchedKey, () =>
                        deleteCache(db, patchedKey + "_module", () =>
                            deleteCache(db, m.cacheKey, () => loadLocalEngine()) // legacy key too
                        )
                    )
                )
            );
        });
    }

    function uninstallEngine() {
        if (state.engineLoadWatchdog) { clearTimeout(state.engineLoadWatchdog); state.engineLoadWatchdog = null; }
        if (state.localEngine) {
            try { state.localEngine.terminate(); } catch (e) {}
            state.localEngine = null;
        }
        state.engineLoadingInProgress = false;
        state.engineLoadGeneration++;
        state.engineRetryAt = 0;
        const m = getEngineById(settings.localModelId);
        state.engineModuleCacheBroken = false;
        state.engineModuleKey = null;
        openCache((dbErr, db) => {
            if (!db) { setEngineStatus("not_installed", ""); return; }
            const patchedKey = m.cacheKey + "_patched";
            deleteCache(db, m.cacheKey + "_js",   () =>
                deleteCache(db, m.cacheKey + "_wasm", () =>
                    deleteCache(db, patchedKey, () =>
                        deleteCache(db, patchedKey + "_module", () =>
                            deleteCache(db, m.cacheKey, () => setEngineStatus("not_installed", ""))
                        )
                    )
                )
            );
        });
        state.lastMoveResult = "Local engine uninstalled.";
        updateUI();
    }

    function triggerFallback() {
        if (settings.engineMode === 'local') return;
        console.warn(`API Error. Switching to Local SF18 at Depth ${settings.depth}.`);
        state.isThinking = false;
        settings.engineMode = 'local';
        saveSetting('engineMode', 'local');
        if (state.ui.selMode) state.ui.selMode.value = 'local';
        state.lastMoveResult = `⚠️ API Error. Switched to Local SF18.`;
        loadLocalEngine();
        if (state.lastSanitizedBoardFEN) analyzeLocal(state.lastSanitizedBoardFEN, settings.depth, state.isThinking);
        updateUI();
    }
    function computeSmartDepth(userDepth) {
        return settings.depth;
    }
    function computeTimeManagedDelay() {
        if (!settings.timeManagement) return null;
        const mySec = getPlayerClockSeconds();
        const oppSec = getOpponentClockSeconds();
        if (mySec === null || oppSec === null) return null;
        const diff = mySec - oppSec;
        let delay;
        if (diff < -10) {
            delay = 0.05 + Math.random() * 0.20;
        } else if (diff < -3) {
            delay = 0.10 + Math.random() * 0.30;
        } else if (diff <= 3) {
            delay = 0.15 + Math.random() * 0.50;
        } else if (diff <= 10) {
            delay = 0.20 + Math.random() * 0.55;
        } else {
            delay = 0.35 + Math.random() * 0.85;
            const remainCap = mySec > 0 ? mySec * 0.05 : 1.5;
            delay = Math.min(delay, Math.max(remainCap, 0.4), 1.5);
        }
        const capped = Math.max(0.05, Math.min(1.5, delay));
        return capped * 1000;
    }
    function analyze(depth = settings.depth, fenOverride = null, isRetry = !1) {
        depth = computeSmartDepth(depth);
        if (state.isThinking && !fenOverride && !isRetry) return;
        
        // ─── LICHESS FIX: Check player color FIRST (Chess.com style) ───
        // Only analyze if it's YOUR turn, not opponent's move
        if (Platform.isLichess?.()) {
            const board = state.board || Platform.getBoard();
            if (board && !lichessState.isYourTurn(board)) {
                console.log('[SF Engine] Lichess: Skipping analysis (opponent\'s turn)');
                return;  // Skip opponent moves
            }
        }
        
        const wasThinking = state.isThinking;
        let finalFEN = fenOverride || sanitizeFEN(getRawBoardFEN());
        if (!finalFEN) return;
        state.lastSentFEN = finalFEN;
        if (!fenOverride) state.lastSanitizedBoardFEN = finalFEN;
        state.isThinking = !0;
        state.analysisStartTime = performance.now();
        if (state.analysisWatchdog) { clearTimeout(state.analysisWatchdog); state.analysisWatchdog = null; }
        const watchdogMs = settings.engineMode === "cloud" ? 30000 : 90000;
        state.analysisWatchdog = setTimeout(() => {
            state.analysisWatchdog = null;
            if (state.isThinking && performance.now() - state.analysisStartTime > watchdogMs) {
                console.warn(`[SF Engine] analysis watchdog: no result within ${Math.round(watchdogMs / 1000)}s — forcing retry`);
                state.isThinking = false;
                state.pendingLocalFEN = null;
                state.pendingLocalDepth = null;
                state.lastSanitizedBoardFEN = "";
                if (state.currentCloudRequest) { try { state.currentCloudRequest.abort(); } catch (_) {} state.currentCloudRequest = null; }
                updateUI();
            }
        }, watchdogMs + 2000);
        if (state.pendingAutoMoveTimeout) { clearTimeout(state.pendingAutoMoveTimeout); state.pendingAutoMoveTimeout = null; }
        if (settings.showEvalBar) EvalBar.reset();
        const tmDelay = computeTimeManagedDelay();
        let delay;
        if (tmDelay !== null) {
            delay = tmDelay;
        } else {
            const minMs = settings.minDelay * 1000, maxMs = settings.maxDelay * 1000;
            let lo = minMs, hi = maxMs;
            if (hi <= lo) { lo = 200; hi = Math.max(hi, 600); }
            delay = Math.random() * (hi - lo) + lo;
        }
        state.moveTargetTime = performance.now() + delay;
        updateUI();

        // ─── Opening Book shortcut ── instant move if we know the position AND we
        // aren't running a deep search. When depth is high (healthy clock / user wants
        // strength), skip the book and let the engine return its best move — otherwise
        // the bot would play a depth-0 book move instead of the full-depth answer.
        if (OpeningBook.enabled && !fenOverride && settings.autoMove && depth <= 12) {
            const bookMove = OpeningBook.lookup(finalFEN);
            if (bookMove) {
                const board = state.board;
                if (board) {
                    const tn = Platform.getTurn(board);
                    const pn = Platform.getPlayingAs(board);
                    const turnNum = (tn === 1 || tn === "w" || tn === "white") ? 1 : 2;
                    const paNum = (pn === 1 || pn === "w" || pn === "white") ? 1 : 2;
                    if (turnNum === paNum) {
                        const from = bookMove.substring(0, 2);
                        const to = bookMove.substring(2, 4);
                        const legalMoves = Platform.getLegalMoves(board);
                        if (legalMoves.some(m => m.from === from && m.to === to)) {
                            // Book moves should have human-like delays too, not instant
                            const tmDelay = computeTimeManagedDelay();
                            let bookDelay;
                            if (tmDelay !== null) {
                                bookDelay = tmDelay;
                            } else {
                                const minMs = settings.minDelay * 1000, maxMs = settings.maxDelay * 1000;
                                let lo = minMs, hi = maxMs;
                                if (hi <= lo) { lo = 200; hi = Math.max(hi, 600); }
                                bookDelay = Math.random() * (hi - lo) + lo;
                            }
                            // Add extra randomness (±50-150ms) to book moves for more human feel
                            bookDelay += getRandomInt(50, 150);
                            state.moveTargetTime = performance.now() + bookDelay;
                            updateUI();
                            state.pendingAnalysis = setTimeout(() => {
                                state.pendingAnalysis = null;
                                try {
                                    processBestMove(bookMove, 0, null, [bookMove], null, bookDelay / 1000, 0, true, finalFEN);
                                    if (settings.showEvalBar) EvalBar.update(0, null);
                                } catch (e) {
                                    console.error(`[SF Engine] book-move tick failed:`, e);
                                }
                                state.isThinking = false;
                            }, bookDelay);
                            return;
                        }
                    }
                }
            }
        }

        try {
            if (settings.engineMode === "cloud") analyzeCloud(finalFEN, depth, isRetry);
            else if (settings.engineMode === "sfonline") analyzeSF16(finalFEN, depth);
            else analyzeLocal(finalFEN, depth, wasThinking);
        } catch (e) {
            console.error(`[SF Engine] analyze dispatch failed:`, e);
            handleError("Analyze failed", e);
        }
    }
    function analyzeCloud(finalFEN, depth, isRetry) {
        const actualDepth = Math.min(depth, 18);
        const payload = {
            fen: finalFEN,
            depth: actualDepth,
            maxThinkingTime: Math.min(settings.maxThinkingTime, CONFIG.API.MAX_TIME),
            taskId: Math.random().toString(36).substring(7),
        };
        if (settings.searchMoves.trim()) payload.searchmoves = settings.searchMoves.trim();
        state.lastPayload = `POST https://chess-api.com/v1\n${JSON.stringify(payload, null, 2)}`;
        if (state.ui.liveOutput) state.ui.liveOutput.textContent = isRetry ? "♻️ Retrying Safe FEN..." : "☁️ SF18 Cloud Analysis...";
        updateUI();
        state.currentCloudRequest = GM_xmlhttpRequest({
            method: "POST", url: "https://chess-api.com/v1",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload), timeout: 15000,
            onload: (res) => handleCloudResponse(res, finalFEN, actualDepth, isRetry),
            onerror: (err) => { handleError("Network Error", err); triggerFallback(); },
            ontimeout: () => { handleError("Timeout (15s)"); triggerFallback(); },
        });
    }
    function analyzeSF16(finalFEN, depth) {
        const actualDepth = Math.min(depth, 15);
        const url = `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(finalFEN)}&depth=${actualDepth}&mode=bestmove`;
        state.lastPayload = `GET ${url}`;
        if (state.ui.liveOutput) state.ui.liveOutput.textContent = "☁️ SF17.1.0 Analysis...";
        updateUI();
        state.currentCloudRequest = GM_xmlhttpRequest({
            method: "GET", url, timeout: 20000,
            onload: (res) => handleSF16Response(res, finalFEN),
            onerror: (err) => { handleError("Network Error (SF16)", err); triggerFallback(); },
            ontimeout: () => { handleError("Timeout (SF16 20s)"); triggerFallback(); },
        });
    }
    function handleSF16Response(response, sentFEN) {
        state.isThinking = !1;
        state.lastResponse = response.responseText;
        try {
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            const data = JSON.parse(response.responseText);
            if (!data.success || !data.bestmove) { triggerFallback(); return; }
            const bestMove = data.bestmove.split(" ")[1] || data.bestmove;
            const duration = ((performance.now() - state.analysisStartTime) / 1000).toFixed(2);
            const contRaw = data.continuation;
            const cont = Array.isArray(contRaw) ? contRaw : (typeof contRaw === "string" ? contRaw.trim().split(/\s+/) : null);
            processBestMove(bestMove, data.evaluation, data.mate, cont, null, duration, true, sentFEN);
        } catch (e) { triggerFallback(); }
        updateUI();
    }
    function handleCloudResponse(response, sentFEN, depth, isRetry) {
        state.isThinking = !1;
        state.lastResponse = response.responseText;
        if (response.responseText.includes("HIGH_USAGE") || response.status === 429) { triggerFallback(); return; }
        try {
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            const rawData = JSON.parse(response.responseText);
            const result = Array.isArray(rawData) ? rawData[0] : rawData;
            if (!result || result.error || result.status === "error") {
                const errText = result?.error || result?.message || "Unknown Error";
                if (errText.includes("HIGH_USAGE")) { triggerFallback(); return; }
                if ((errText.includes("FEN") || errText.includes("VALIDATION")) && !isRetry) {
                    const parts = sentFEN.split(" ");
                    if (parts.length >= 4 && parts[3] !== "-") { parts[3] = "-"; analyze(depth, parts.join(" "), !0); return; }
                }
                triggerFallback(); return;
            }
            if (result.move || result.bestmove) {
                const duration = ((performance.now() - state.analysisStartTime) / 1000).toFixed(2);
                processBestMove(result.move || result.bestmove, result.eval, result.mate, result.continuationArr, result.winChance, duration, true, sentFEN);
            } else { triggerFallback(); }
        } catch (e) { triggerFallback(); }
        updateUI();
    }
    function analyzeLocal(fen, depth, wasThinking = false) {
        console.log(`[SF Engine] analyzeLocal called: fen=${fen?.substring(0,40)}..., depth=${depth}, engineStatus=${state.engineStatus}, hasEngine=${!!state.localEngine}`);
    if (!state.localEngine || state.engineStatus !== "ready") {
        console.warn(`[SF Engine] Cannot analyze: engine not ready (status=${state.engineStatus}, hasEngine=${!!state.localEngine})`);
        state.isThinking = false;
        state.lastSanitizedBoardFEN = "";
        state.pendingLocalFEN = fen;
        state.pendingLocalDepth = depth;
        if (!state.localEngine) loadLocalEngine();
        return;
    }
        state.isThinking = !0;
        state.analysisStartTime = performance.now();
        state.localEval = null; state.localMate = null; state.localPV = null; state.localDepth = null;
        const m = getEngineById(settings.localModelId);
        let actualDepth = Math.min(depth, m.maxDepth);

        state.multiPVMap = {};
        state.humanAlternatives = [];
        const wantMultiPV = settings.humanizer ? 5 : 1;
        if (state.lastMultiPV !== wantMultiPV) {
            console.log(`[SF Engine] → setoption name MultiPV value ${wantMultiPV}`);
            state.localEngine.postMessage(`setoption name MultiPV value ${wantMultiPV}`);
            state.lastMultiPV = wantMultiPV;
        }
        console.log(`[SF Engine] → position fen ${fen}`);
        console.log(`[SF Engine] → go depth ${actualDepth}`);
        state.currentSearchFEN = fen;
        state.localEngine.postMessage(`position fen ${fen}`);
        state.localEngine.postMessage(`go depth ${actualDepth}`);
        // A dispatch that interrupts a running search makes the old search's
        // bestmove an abort-echo: it was computed for a FEN we've abandoned.
        // Count it so the bestmove handler drops that stale result.
        if (wasThinking) state.pendingAbortEchoes = (state.pendingAbortEchoes || 0) + 1;
        state.lastPayload = `Worker CMDs:\nsetoption name MultiPV value ${wantMultiPV}\nposition fen ${fen}\ngo depth ${actualDepth}`;
        state.ui.liveOutput.textContent = "⚡ Local SF18 Analysis...";
        updateUI();
    }
    function handleLocalMessage(e) {
        // Object messages: the worker posts the COMPILED module once per worker
        // ({__type:"module", module}) so repeat loads skip the 4-5s wasm compile.
        if (e.data && typeof e.data === "object" && e.data.__type === "module" && e.data.module) {
            console.log(`[SF Engine] ⬆ worker posted compiled module → caching (${state.engineModuleKey || "no key"})`);
            if (state.engineDB && state.engineModuleKey) {
                writeCacheAsync(state.engineDB, state.engineModuleKey, { v: MODULE_CACHE_VERSION, module: e.data.module })
                    .catch((err) => console.warn(`[SF Engine] Module cache write failed:`, err));
            }
            return;
        }
        const msg = typeof e.data === "string" ? e.data : (e.data?.toString ? e.data.toString() : null);
        if (!msg || typeof msg !== "string") {
            console.warn(`[SF Engine] Received non-string message:`, e.data);
            return;
        }
        if (msg.startsWith("__probe:module-instantiate-failed")) {
            console.error(`[SF Engine] Compiled module failed to instantiate (browser update?): ${msg.slice(8)} — falling back to bytes path`);
            state.engineModuleCacheBroken = true;
            if (state.localEngine) {
                state.localEngine.onerror = null;
                try { state.localEngine.terminate(); } catch (e2) {}
                state.localEngine = null;
            }
            state.engineLoadingInProgress = false;
            loadLocalEngine();
            return;
        }
        if (msg.startsWith("__probe:")) {
            // Any probe from the worker proves it is ALIVE (the 3s beacon keeps
            // firing while the event loop is free). Reset heartbeat misses so a
            // long concurrent compile is never misjudged as a dead worker.
            state.lastWorkerProbeAt = performance.now();
            state.heartbeatMisses = 0;
            if (msg.startsWith("__probe:beacon")) {
                if (state.engineStatus === "loading")
                    console.log(`[SF Engine] ⤵ worker alive at ${Math.round((performance.now() - (state.engineBuildTime || performance.now())) / 1000)}s (compiling)`);
                return;
            }
            console.log(`[SF Engine] ⤵ worker probe: ${msg.slice(8)}`);
            return;
        }
        // Log all engine messages for debugging
        if (msg.startsWith("info") || msg.startsWith("bestmove") || msg === "uciok" || msg === "readyok" || msg.startsWith("option")) {
            console.debug(`[SF Engine] ← ${msg}`);
        } else if (!msg.startsWith("info")) {
            console.log(`[SF Engine] ← ${msg}`);
        }
        state.lastResponse = (state.lastResponse.length > 500 ? "..." + state.lastResponse.slice(-500) : state.lastResponse) + "\n" + msg;
        if (state.ui.logRec) state.ui.logRec.innerText = state.lastResponse;

        // Engine signals it's ready — flip status immediately.
        if (msg === "uciok" || msg.startsWith("uciok")) {
            console.log(`[SF Engine] Received uciok, engine initialized`);
            if (state.engineBuildTime) {
                console.log(`[SF Engine] Engine ready in ${((performance.now() - state.engineBuildTime) / 1000).toFixed(1)}s`);
                state.engineBuildTime = null;
            }
            if (state.engineHeartbeatTimer) { clearInterval(state.engineHeartbeatTimer); state.engineHeartbeatTimer = null; }
            state.pendingReadyProbe = false;
            state.engineRetryAt = 0;
            if (state.engineStatus !== "ready") {
                const m = getEngineById(settings.localModelId || "sf18_05");
                setEngineStatus("ready", "");
                state.lastMoveResult = `✅ ${m.label} ready.`;
                updateUI();
            }
            if (state.pendingLocalFEN && state.localEngine) {
                console.log(`[SF Engine] Processing pending FEN after uciok`);
                const fFEN = state.pendingLocalFEN, fDepth = state.pendingLocalDepth;
                state.pendingLocalFEN = null; state.pendingLocalDepth = null;
                state.isThinking = !1;
                analyzeLocal(fFEN, fDepth);
            }
            return;
        }
        if (msg === "readyok") {
            console.log(`[SF Engine] Received readyok`);
            state.pendingReadyProbe = false;
            if (state.engineStatus !== "ready") {
                const m = getEngineById(settings.localModelId || "sf18_05");
                setEngineStatus("ready", "");
                state.lastMoveResult = `✅ ${m.label} ready.`;
                updateUI();
            }
            if (state.pendingLocalFEN && state.localEngine) {
                console.log(`[SF Engine] Processing pending FEN after readyok`);
                const fFEN = state.pendingLocalFEN, fDepth = state.pendingLocalDepth;
                state.pendingLocalFEN = null; state.pendingLocalDepth = null;
                state.isThinking = !1;
                analyzeLocal(fFEN, fDepth);
            }
            return;
        }
        if (msg.startsWith("info") && msg.includes("depth") && msg.includes("score")) {
            const depthMatch = msg.match(/depth (\d+)/);
            const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
            const pvMatch = msg.match(/ pv (.*)/);
            const multipvMatch = msg.match(/multipv (\d+)/);
            const isMainLine = !multipvMatch || multipvMatch[1] === "1";
            if (depthMatch && scoreMatch) {
                const depth = depthMatch[1];
                // UCI "score" is from the side-to-move perspective. We always analyze
                // on OUR turn (side to move = us), so val is already our perspective.
                const val = parseInt(scoreMatch[2]);
                const type = scoreMatch[1];
                const pv = pvMatch ? pvMatch[1] : "";
                if (isMainLine) {
                    if (type === "mate") { state.localMate = val; state.localEval = null; }
                    else { state.localMate = null; state.localEval = (val / 100).toFixed(2); }
                    state.localPV = pv; state.localDepth = depth;
                }
                if (settings.humanizer && state.multiPVMap && pv) {
                    const firstMove = pv.split(" ")[0];
                    if (firstMove && firstMove.length >= 4) {
                        state.multiPVMap[firstMove] = { move: firstMove, evalRaw: val, mate: type === "mate" ? val : null, depth: parseInt(depth), pv };
                    }
                }
                if (isMainLine) {
                    if (pv) state.currentPV = pv.split(" ");

                    if (settings.showEvalBar) EvalBar.update(type === "mate" ? null : parseFloat(state.localEval), type === "mate" ? val : null);
                    let scoreTxt;
                    if (type === "mate") { scoreTxt = "M" + Math.abs(val); if (val < 0) scoreTxt = "-" + scoreTxt; }
                    else { scoreTxt = (val > 0 ? "+" : "") + (val / 100).toFixed(2); }
                    const evalVal = type === "mate" ? val : parseFloat(state.localEval);
                    const statusData = getEvalStatusData(evalVal, type === "mate");
                    const duration = ((performance.now() - state.analysisStartTime) / 1000).toFixed(2);
                    if (pv) {
                        const best = pv.split(" ")[0];
                        Visuals.add(best, 'analysis');
                        PV.update(state.currentPV);
                        state.lastMoveResult = `⏳ D${depth}: <span style="font-weight:bold; color:var(--bot-primary);">${best}</span>`;
                    }
                    state.lastLiveResult = `
                        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold;">
                            <div style="display:flex; align-items:center; gap: 8px;">
                                <span style="color:var(--bot-primary); font-size:1.1em;">${scoreTxt}</span>
                                <span style="font-size:0.85em; color:${statusData.color}; font-weight:bold;">${statusData.text}</span>
                            </div>
                            <span style="font-size:0.7em; color:#aaa; font-weight:normal;">(${duration}s)</span>
                        </div>`;
                    updateUI();
                }
            }
        }
        if (msg.startsWith("bestmove")) {
            state.isThinking = !1;
            // Stale-result guard: a bestmove that belongs to a search we already
            // superseded (new game reset / newer dispatch interrupted it) was
            // computed for a FEN we're no longer on. Drop it and let the poll
            // loop re-analyze the current position.
            if ((state.pendingAbortEchoes || 0) > 0) {
                state.pendingAbortEchoes--;
                console.warn(`[SF Engine] dropped stale bestmove (aborted search echo, ${state.pendingAbortEchoes} remaining)`);
                state.lastSanitizedBoardFEN = "";
                updateUI();
                return;
            }
            const parts = msg.split(" ");
            const bestMove = parts[1];
            if (state.multiPVMap && Object.keys(state.multiPVMap).length) {
                const entries = Object.values(state.multiPVMap);
                entries.sort((a, b) => {
                    const ka = a.mate !== null ? (a.mate > 0 ? 100000 - a.mate : -100000 + Math.abs(a.mate)) : a.evalRaw;
                    const kb = b.mate !== null ? (b.mate > 0 ? 100000 - b.mate : -100000 + Math.abs(b.mate)) : b.evalRaw;
                    return kb - ka;
                });
                state.humanAlternatives = entries.slice(0, 5);
                const bestEntry = entries.find(e => e.move === bestMove) || entries[0];
                if (bestEntry) {
                    if (bestEntry.mate !== null) { state.localMate = bestEntry.mate; state.localEval = null; }
                    else { state.localMate = null; state.localEval = (bestEntry.evalRaw / 100).toFixed(2); }
                    state.localDepth = bestEntry.depth;
                    if (bestEntry.pv) state.localPV = bestEntry.pv;
                }
            }
            if (bestMove && bestMove !== "(none)") {
                const duration = ((performance.now() - state.analysisStartTime) / 1000).toFixed(2);
                processBestMove(bestMove, state.localEval, state.localMate, state.localPV ? state.localPV.split(" ") : null, null, duration, state.localDepth, true, state.currentSearchFEN);
            } else state.lastMoveResult = "⚠️ No move found";


            updateUI();
        }
    }
    function processBestMove(bestMove, evalScore, mate, continuationArr, winChance, duration, depth = null, isFinal = false, fen = null) {
        state.currentBestMove = bestMove;
        state.currentPV = continuationArr || (bestMove ? [bestMove] : []);
        if (isFinal || !state.isThinking) { Visuals.add(bestMove, 'history'); PV.clear(); }
        else { Visuals.add(bestMove, 'analysis'); PV.update(state.currentPV); }
        const evalNum = (evalScore !== null && evalScore !== undefined) ? parseFloat(evalScore) : null;
        const mateNum = (mate !== null && mate !== undefined && mate !== 0) ? parseInt(mate) : null;

        // Normalize engine score to "our perspective" (positive = good for us):
        // - chess-api (cloud) and stockfish.online (sfonline) return WHITE-perspective
        //   eval AND mate (confirmed via API docs + original bar logic).
        // - local engine returns side-to-move perspective; we always analyze on our turn.
        const playingAsRaw = Platform.getPlayingAs(state.board) || state.playingAs || 1;
        const playingAsNorm = (playingAsRaw === 1 || playingAsRaw === "w" || playingAsRaw === "white") ? 1 : 2;
        const ourSign = (playingAsNorm === 2) ? -1 : 1;
        const needsFlip = settings.engineMode !== "local";
        const normEval = evalNum !== null ? (needsFlip ? ourSign * evalNum : evalNum) : null;
        const normMate = mateNum !== null ? (needsFlip ? ourSign * mateNum : mateNum) : null;
        state.currentMateNorm = normMate;

        if (settings.showEvalBar) EvalBar.update(normEval, normMate);

        // ─── Auto-Resign ── check for hopelessly lost position
        let scoreTxt = "", pvStr = "N/A", numericValForStatus = 0, isMate = false;

        if (normEval !== null || normMate !== null) {
            if (normMate !== null) {
                isMate = true; numericValForStatus = normMate;
                scoreTxt = `M${Math.abs(normMate)}`; if (normMate < 0) scoreTxt = "-" + scoreTxt;
            } else {
                const sc = normEval; numericValForStatus = sc;
                scoreTxt = (sc > 0 ? "+" : "") + sc.toFixed(2);
            }
            if (continuationArr) pvStr = continuationArr.join(" ");
        }
        const statusData = getEvalStatusData(numericValForStatus, isMate);
        const durHtml = duration ? `<span style="font-size:0.7em; color:#aaa; font-weight:normal;">(${duration}s)</span>` : "";
        state.lastMoveResult = `✅ Best: <span style="font-weight:bold; color:var(--bot-primary);">${bestMove}</span>`;

        // ─── Threat Detection ── detect if opponent's last move created a threat
        // Works in all engine modes (cloud, local, SF16) by using the current
        // analysis result. Only runs when it's our turn (opponent just moved).
        if (ThreatDetector.enabled && isOurTurnNow()) {
            // normEval/normMate are already "our perspective" (positive = good for us).

            let threatMove = '';
            let threatScore = '';

            if (normMate !== null && normMate < 0) {
                // Negative mate = opponent mates us (threat!)
                threatMove = bestMove || '';
                threatScore = 'M' + Math.abs(normMate);
            } else if (normEval !== null && normEval < -0.5) {
                // Significant disadvantage — opponent has advantage
                threatMove = bestMove || '';
                threatScore = (normEval < 0 ? '' : '+') + normEval;
            }

            if (threatMove) {
                ThreatDetector.threatMove = threatMove;
                ThreatDetector.threatScore = threatScore;
                ThreatDetector.show();
            } else {
                // No threat anymore → clear stale highlight/score
                ThreatDetector.reset();
            }
        }

        let wcHtml = "";
        if (winChance) wcHtml = `<span style="color:#aaa; font-size:0.8em;">(${Math.round(winChance)}%)</span>`;
        else if (depth) wcHtml = `<span style="font-size:0.8em; color:#aaa;">(D${depth})</span>`;
        state.lastLiveResult = `
            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold;">
                <div style="display:flex; align-items:center; gap: 8px;">
                    <span style="color:var(--bot-primary); font-size:1.1em;">${scoreTxt}</span>
                    <span style="font-size:0.85em; color:${statusData.color}; font-weight:bold;">${statusData.text}</span>
                </div>
                <div>${wcHtml} ${durHtml}</div>
            </div>
            <div style="margin-top:5px; font-size:0.85em; color:#bbb; width:100%; max-width:100%; box-sizing:border-box; word-wrap:break-word; overflow-wrap:anywhere; white-space:normal;">
                <span style="color:#888;">PV:</span> ${pvStr}
            </div>`;
        if (settings.autoMove && isFinal) triggerAutoMove(fen);
    }

    // ─── CLOCK READER ────────────────────────────────────────────────────────
    function getPlayerClockSeconds() {
        const board = state.board;
        if (!board) return null;
        const pa = state.playingAs;
        const playingAsBlack = (pa === 2 || pa === "b" || pa === "black");
        let clockEl = null;
        
        if (Platform.isLichess()) {
            clockEl = document.querySelector('.rclock-bottom, .rclock-bottom .clock-time');
        } else {
            // Chess.com clock selectors
            if (playingAsBlack) {
                clockEl = document.querySelector(".clock-bottom .clock-time-monospace");
                if (!clockEl) clockEl = document.querySelector(".clock-bottom");
                if (!clockEl) {
                    const clocks = document.querySelectorAll(".clock-time-monospace, .clock-time");
                    if (clocks.length >= 2) clockEl = clocks[1];
                    else if (clocks.length === 1) clockEl = clocks[0];
                }
            } else {
                clockEl = document.querySelector(".clock-bottom .clock-time-monospace");
                if (!clockEl) clockEl = document.querySelector(".clock-bottom");
                if (!clockEl) {
                    const clocks = document.querySelectorAll(".clock-time-monospace, .clock-time");
                    if (clocks.length >= 1) clockEl = clocks[0];
                }
            }
        }
        if (!clockEl) return null;
        const text = clockEl.textContent.trim();
        let match = text.match(/(\d+):(\d+):(\d+)/);
        if (match) {
            const h = parseInt(match[1]), m = parseInt(match[2]), s = parseInt(match[3]);
            return h * 3600 + m * 60 + s;
        }
        match = text.match(/(\d+):(\d+)/);
        if (!match) return null;
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        return min * 60 + sec;
    }
    function getOpponentClockSeconds() {
        const board = state.board;
        if (!board) return null;
        const pa = state.playingAs;
        const playingAsBlack = (pa === 2 || pa === "b" || pa === "black");
        let clockEl = null;
        
        if (Platform.isLichess()) {
            clockEl = document.querySelector('.rclock-top, .rclock-top .clock-time');
        } else {
            // Chess.com clock selectors
            if (playingAsBlack) {
                clockEl = document.querySelector(".clock-top .clock-time-monospace");
                if (!clockEl) clockEl = document.querySelector(".clock-top");
                if (!clockEl) {
                    const clocks = document.querySelectorAll(".clock-time-monospace, .clock-time");
                    if (clocks.length >= 1) clockEl = clocks[0];
                }
            } else {
                clockEl = document.querySelector(".clock-top .clock-time-monospace");
                if (!clockEl) clockEl = document.querySelector(".clock-top");
                if (!clockEl) {
                    const clocks = document.querySelectorAll(".clock-time-monospace, .clock-time");
                    if (clocks.length >= 2) clockEl = clocks[1];
                    else if (clocks.length === 1) clockEl = clocks[0];
                }
            }
        }
        if (!clockEl) return null;
        const text = clockEl.textContent.trim();
        let match = text.match(/(\d+):(\d+):(\d+)/);
        if (match) {
            const h = parseInt(match[1]), m = parseInt(match[2]), s = parseInt(match[3]);
            return h * 3600 + m * 60 + s;
        }
        match = text.match(/(\d+):(\d+)/);
        if (!match) return null;
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        return min * 60 + sec;
    }

    // ─── IS OUR TURN? ─────────────────────────────────────────────────────────
    const isOurTurnNow = () => {
        if (!state.board) return false;
        try {
            const turn = Platform.getTurn(state.board);
            const playingAs = Platform.getPlayingAs(state.board);
            // Normalize: handle both number (1/2) and string ("w"/"b") returns
            const turnNum = (turn === 1 || turn === "w" || turn === "white") ? 1 : 2;
            const paNum = (playingAs === 1 || playingAs === "w" || playingAs === "white") ? 1 : 2;
            return turnNum === paNum;
        } catch(e) {}
        return false;
    };

function triggerAutoMove(fen = null) {
     if (!state.currentBestMove || !state.board) { console.warn(`[SF Engine] triggerAutoMove aborted: no bestMove or no board`); return; }
     const tn = Platform.getTurn(state.board);
     const pa = Platform.getPlayingAs(state.board);
     const turnNum = (tn === 1 || tn === "w" || tn === "white") ? 1 : 2;
     const paNum = (pa === 1 || pa === "w" || pa === "white") ? 1 : 2;
     if (turnNum !== paNum) { console.warn(`[SF Engine] triggerAutoMove aborted: not our turn (turn=${turnNum}, playingAs=${paNum})`); return; }

     // Race condition guard: verify the board hasn't changed since THIS analysis
     // started. `fen` is the exact position this move was computed for (captured
     // at dispatch), NOT the shared lastSentFEN — a newer analyze() overwrites
     // lastSentFEN, which let stale final callbacks stroke the wrong squares.
     const analyzedFEN = fen || state.lastSentFEN;
     if (!analyzedFEN) { console.warn(`[SF Engine] triggerAutoMove aborted: no analyzed FEN`); return; }
     const currentRaw = getRawBoardFEN();
     if (currentRaw && sanitizeFEN(currentRaw).split(" ")[0] !== analyzedFEN.split(" ")[0]) {
         console.warn(`[SF Engine] triggerAutoMove aborted: board changed since analysis (analyzed=${analyzedFEN.split(" ")[0]}, current=${sanitizeFEN(currentRaw).split(" ")[0]})`);
         return;
     }

     // Forced winning mate: play the mating move instantly (pre-move-style) and
     // never let the humanizer deviate off the forced win. Each mating move is
     // re-confirmed on our turn, so the full mate plays out across turns even if
     // the opponent deviates within their (still losing) legal replies.
      const mateNorm = state.currentMateNorm;
      if (mateNorm !== null && mateNorm > 0) {
          const mateMove = state.currentBestMove;
          console.log(`[SF Engine] Mate in ${mateNorm}, playing best move immediately: ${mateMove}`);
          scheduleAutoMove(() => playMove(mateMove, analyzedFEN), 0);
          return;
      }

 if (!shouldPlayBestMove()) {
         const alts = state.humanAlternatives || [];
         console.log(`[SF Engine] Humanizer active, alternatives=${alts.length}`);
         if (alts.length >= 2) {
             const weights = [0.70, 0.20, 0.10];
             const bestWin = getMoveWinPct(alts[0].evalRaw, alts[0].mate);
             const safe = [];
             for (let i = 1; i < alts.length; i++) {
                 const a = alts[i];
                 const aw = getMoveWinPct(a.evalRaw, a.mate);
                 const flipsLoss = bestWin >= 50 && aw < 50;
                 if (!flipsLoss && (bestWin - aw) <= 20) safe.push(a);
             }
             if (safe.length >= 1) {
                 safe.sort((a, b) => getMoveWinPct(b.evalRaw, b.mate) - getMoveWinPct(a.evalRaw, a.mate));
                 const w = weights.slice(0, safe.length);
                 let total = 0; for (let k = 0; k < w.length; k++) total += w[k];
                 let r = Math.random() * total;
                 let chosen = safe[safe.length - 1];
                 for (let k = 0; k < safe.length; k++) {
                     r -= w[k];
                     if (r <= 0) { chosen = safe[k]; break; }
                 }
                 if (chosen && chosen.move) {
                     console.log(`[SF Engine] Humanizer chose alternative: ${chosen.move} (winPct=${getMoveWinPct(chosen.evalRaw, chosen.mate)})`);
                     const wait = Math.max(0, state.moveTargetTime - performance.now());
                     scheduleAutoMove(() => playMove(chosen.move, analyzedFEN), wait);
                     return;
                 }
             }
         }
     }

    const moveToPlay = state.currentBestMove;
    const wait = Math.max(0, state.moveTargetTime - performance.now());
    console.log(`[SF Engine] Playing best move: ${moveToPlay} after ${wait}ms`);
    scheduleAutoMove(() => playMove(moveToPlay, analyzedFEN), wait);
 }
    function handleError(type, err) {
        state.isThinking = !1;
        console.error(`[SF Engine] ${type}:`, err);
        console.error(`[SF Engine] Error stack:`, err?.stack);
        console.error(`[SF Engine] State at error: engineStatus=${state.engineStatus}, isThinking=${state.isThinking}, hasEngine=${!!state.localEngine}`);
        state.lastResponse = `${type}: ${err?.message || err}`;
        state.lastMoveResult = `❌ ${type}`;
        updateUI();
    }
    function playMove(move, fen = null, playingAs = null) {
        console.log(`[SF Engine] playMove: ${move}`);
        if (!state.board) { console.warn(`[SF Engine] playMove aborted: no board`); return; }
        // Final turn check at execution time
        const tn = Platform.getTurn(state.board);
        const pa = playingAs !== null ? playingAs : Platform.getPlayingAs(state.board);
        const turnNum = (tn === 1 || tn === "w" || tn === "white") ? 1 : 2;
        const paNum = (pa === 1 || pa === "w" || pa === "white") ? 1 : 2;
        if (turnNum !== paNum) { console.warn(`[SF Engine] playMove aborted: not our turn (turn=${turnNum}, playingAs=${paNum})`); return; }

        const from = move.substring(0, 2), to = move.substring(2, 4);
        const analyzedFEN = fen || state.lastSentFEN;
        if (!analyzedFEN) { console.warn(`[SF Engine] playMove aborted: no analyzed FEN`); return; }
        const currentRaw = getRawBoardFEN();
        if (currentRaw && sanitizeFEN(currentRaw).split(" ")[0] !== analyzedFEN.split(" ")[0]) { console.warn(`[SF Engine] playMove aborted: board changed since analysis`); return; }
        // Ownership backstop: ensure the from-square piece belongs to us
        const piecesPart = analyzedFEN.split(" ")[0];
        const fromPiece = fenPieceAt(piecesPart, from);
        if (!fromPiece || (turnNum === 1 && fromPiece === fromPiece.toLowerCase()) || (turnNum === 2 && fromPiece === fromPiece.toUpperCase())) {
            console.warn(`[SF Engine] playMove aborted: from square ${from} holds an opponent piece or is empty`);
            return;
        }
        const legalMoves = Platform.getLegalMoves(state.board);
        for (const m of legalMoves) {
            if (m.from === from && m.to === to) {
                const promotion = move.length > 4 ? move.substring(4, 5) : "q";
                console.log(`[SF Engine] Executing move: ${from}${to}${promotion !== 'q' ? '=' + promotion : ''}`);
                Platform.makeMove(state.board, { ...m, promotion });
                return;
            }
        }
        if (Platform.isLichess() && !legalMoves.length) {
            const promotion = move.length > 4 ? move.substring(4, 5) : "q";
            console.log(`[SF Engine] Executing Lichess fallback move: ${from}${to}${promotion !== 'q' ? '=' + promotion : ''}`);
            if (Platform.makeMove(state.board, { from, to, promotion })) return;
        }
        console.warn(`[SF Engine] playMove: move ${move} not in legal moves`);
    }
    function toggleAutoQueue() {
        if (state.newGameObserver) { state.newGameObserver.disconnect(); state.newGameObserver = null; }
        if (state.queueTimeout) { clearTimeout(state.queueTimeout); state.queueTimeout = null; }
        if (settings.autoQueue) {
            state.newGameObserver = new MutationObserver(() => {
                const btns = Array.from(document.querySelectorAll("button"));
                const newGameBtn = btns.find((b) => {
                    const txt = b.innerText.toLowerCase();
                    return txt.includes("new") && !txt.includes("rematch") && isElVisible(b);
                });
                if (newGameBtn && !state.queueTimeout) {
                    state.queueTimeout = setTimeout(() => { newGameBtn.click(); state.queueTimeout = null; }, 100);
                }
            });
            state.newGameObserver.observe(document.body, { childList: !0, subtree: !0 });
        }
    }
    function resetSettings() {
        const currentModel = settings.engineMode;
        Object.assign(settings, DEFAULT_SETTINGS);
        settings.engineMode = currentModel;
        Object.keys(DEFAULT_SETTINGS).forEach((k) => { if (k !== "engineMode") saveSetting(k, DEFAULT_SETTINGS[k]); });
        saveSetting("engineMode", currentModel);
        const hsl = rgbToHsl(...Object.values(hexToRgb(settings.highlightColor)));
        state.h = hsl.h; state.s = hsl.s; state.l = hsl.l;
        if (settings.engineMode === "local" && (state.localEngine || state.engineLoadingInProgress)) {
            if (state.localEngine) { try { state.localEngine.terminate(); } catch (_) {} state.localEngine = null; }
            state.engineLoadingInProgress = false;
            state.engineLoadGeneration++;
            state.engineRetryAt = 0;
            loadLocalEngine();
        }
        toggleAutoQueue();
        createUI();
        applyMenuPosition();
    }
    function syncColor() {
        const rgb = hslToRgb(state.h, state.s, state.l);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
        settings.highlightColor = hex;
        saveSetting("highlightColor", hex);
        if (state.ui.inpR) {
            state.ui.inpR.value = rgb.r; state.ui.inpG.value = rgb.g; state.ui.inpB.value = rgb.b;
            state.ui.inpHex.value = hex;
            state.ui.colorPreview.style.background = hex;
            state.ui.sliderH.value = state.h; state.ui.sliderS.value = state.s; state.ui.sliderL.value = state.l;
            if (state.ui.sliderHNum) state.ui.sliderHNum.value = Math.round(state.h);
            if (state.ui.sliderSNum) state.ui.sliderSNum.value = Math.round(state.s);
            if (state.ui.sliderLNum) state.ui.sliderLNum.value = Math.round(state.l);
        }
        Visuals.removeByType('history');
        if (state.currentBestMove) Visuals.add(state.currentBestMove, 'history');
    }
    function applyTheme() {
        const modals = [state.ui.panel, state.ui.modal, state.ui.localModal];
        modals.forEach(m => {
            if (!m) return;
            m.style.setProperty("--bot-bg", settings.themeBg);
            m.style.setProperty("--bot-t", settings.themeText);
            m.style.setProperty("--bot-b", settings.themeBorder);
            m.style.setProperty("--bot-p", settings.themePrimary);
            m.style.color = settings.themeText;
            if (m === state.ui.panel) {
                m.style.opacity = settings.menuOpacity;
            } else {
                const overlayId = m.id === "modal" ? "modalOv" : "localModalOv";
                const overlay = document.getElementById(overlayId);
                if (overlay) overlay.style.opacity = "1";
                m.style.opacity = settings.menuOpacity;
            }
        });
    }
    function applyMenuPosition() {
        const p = state.ui.panel;
        if (!p) return;
        const margin = "10px";
        p.style.transform = "none";
        p.style.top = ""; p.style.bottom = ""; p.style.left = ""; p.style.right = "";
        if (settings.menuPosition === "custom") {
            const savedX = GM_getValue("bot_pX", "auto");
            const savedY = GM_getValue("bot_pY", "0");
            if (savedX === "auto") { p.style.right = "0px"; p.style.left = "auto"; }
            else p.style.left = savedX + "px";
            p.style.top = savedY + "px";
            const rect = p.getBoundingClientRect();
            if (rect.left < 0) p.style.left = "0px";
            if (rect.top < 0) p.style.top = "0px";
            if (rect.right > window.innerWidth) p.style.left = (window.innerWidth - rect.width) + "px";
            if (rect.bottom > window.innerHeight) p.style.top = (window.innerHeight - rect.height) + "px";
        } else {
            switch (settings.menuPosition) {
                case "top-left": p.style.top = margin; p.style.left = margin; break;
                case "top-right": p.style.top = margin; p.style.right = margin; break;
                case "bottom-left": p.style.bottom = margin; p.style.left = margin; break;
                case "bottom-right": p.style.bottom = margin; p.style.right = margin; break;
            }
        }
    }

    // Sync all local settings input elements to current settings.localXxx values.
    // Called when the modal opens or when the model changes.
    function syncLocalSettingsInputs() {
        const byId = (id) => document.getElementById(id);
        const set  = (id, val) => { const el = byId(id); if (el) el.value = val; };
        const chk  = (id, val) => { const el = byId(id); if (el) el.checked = val; };
        set("localHashMB",        settings.localHashMB);
        set("localMoveOverhead",  settings.localMoveOverhead);
        set("localSkillLevel",    settings.localSkillLevel);
        set("localSkillLevelRange", settings.localSkillLevel);
        chk("localLimitStrength", settings.localLimitStrength);
        set("localElo",           settings.localElo);
        chk("localShowWDL",       settings.localShowWDL);
        set("localMinThinkingTime", settings.localMinThinkTime);
        set("localSlowMover",     settings.localSlowMover);
        set("localContempt",      settings.localContempt);
        // Show/hide elo row based on limit strength state
        const eloRow = byId("localEloRow");
        if (eloRow) eloRow.style.display = settings.localLimitStrength ? "flex" : "none";
    }

    function updateLocalSettingsUI() {
        const statusEl     = document.getElementById("localEngineStatus");
        const statusMsgEl  = document.getElementById("localEngineStatusMsg");
        const btnInstall   = document.getElementById("btnLocalInstall");
        const btnReinstall = document.getElementById("btnLocalReinstall");
        const btnUninstall = document.getElementById("btnLocalUninstall");
        if (!statusEl) return;

        const m = getEngineById(settings.localModelId || "sf18_05");

        // ── Status badge ──
        const statusMap = {
            not_installed: { text: "❌ Not Installed", color: "#ff5555" },
            loading:       { text: "⏳ Loading...",    color: "#ffaa00" },
            ready:         { text: "✅ Ready",          color: "#81b64c" },
            error:         { text: "⚠️ Error",          color: "#ff7777" },
        };
        const s = statusMap[state.engineStatus] || statusMap.not_installed;
        statusEl.textContent = s.text;
        statusEl.style.color = s.color;
        if (statusMsgEl) statusMsgEl.textContent = state.engineStatusMsg;

        const isLoading = state.engineStatus === "loading";
        const isReady   = state.engineStatus === "ready";
        if (btnInstall)   btnInstall.disabled   = isReady || isLoading;
        if (btnReinstall) btnReinstall.disabled  = isLoading;
        if (btnUninstall) btnUninstall.disabled  = !isReady && !isLoading;

        // ── Model caps → show/hide option rows ──
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? "" : "none";
        };
        show("rowMoveOverhead",  m.hasMoveOverhead);
        show("rowSkillLevel",    m.hasSkillLevel);
        show("rowLimitStrength", m.hasNNUE);
        show("rowWDL",           m.hasWDL);
        show("rowSlowMover",     m.hasSlowMover);
        show("rowContempt",      m.hasContempt);
        show("rowMinThink",      m.hasMinThink);

        // ── Model info panel ──
        const infoEl = document.getElementById("localModelInfo");
        if (infoEl) {
            const fmtLabel = m.format === "asmjs" ? "asm.js — single JS file (no WASM)" : "WASM + JS (unpkg)";
            const caps = [
                m.hasNNUE         ? "NNUE" : "HCE (classical eval)",
                m.hasSkillLevel   ? "Skill Level" : null,
                m.hasNNUE         ? "Elo Limit" : null,
                m.hasWDL          ? "WDL" : null,
                m.hasContempt     ? "Contempt" : null,
                m.hasSlowMover    ? "Slow Mover" : null,
                m.hasMinThink     ? "Min Think" : null,
                m.hasMoveOverhead ? "Move Overhead" : null,
            ].filter(Boolean).join(" · ");
            infoEl.innerHTML =
                `<b>Format:</b> ${fmtLabel}<br>` +
                `<b>Max Depth:</b> ${m.maxDepth}<br>` +
                `<b>Options:</b> ${caps}<br>` +
                `<b>JS:</b> ${m.jsUrl || "(bundled @resource)"}<br>` +
                (m.wasmUrl ? `<b>WASM:</b> ${m.wasmUrl}` : "<b>WASM:</b> N/A");
        }

        // ── Source info box ──
        const srcEl = document.getElementById("localSrcInfo");
        if (srcEl) {
            srcEl.innerHTML =
                `<b>JS:</b> ${m.jsUrl || "(bundled @resource)"}<br>` +
                (m.wasmUrl ? `<b>WASM:</b> ${m.wasmUrl}` : "<b>WASM:</b> N/A — asm.js engine");
        }

        // ── Depth cap ──
        if (state.ui.inpDepth)    state.ui.inpDepth.max = m.maxDepth;
        if (state.ui.lblMaxDepth) state.ui.lblMaxDepth.innerText = m.maxDepth;
    }

    function createUI() {
        if (document.getElementById("enginePanel")) document.getElementById("enginePanel").remove();
        if (document.getElementById("modalOv")) document.getElementById("modalOv").remove();
        if (document.getElementById("localModalOv")) document.getElementById("localModalOv").remove();
        if (document.getElementById("fenTooltip")) document.getElementById("fenTooltip").remove();
        loadSettings();
        const initHsl = rgbToHsl(...Object.values(hexToRgb(settings.highlightColor)));
        state.h = initHsl.h; state.s = initHsl.s; state.l = initHsl.l;
        const savedW = GM_getValue("bot_panelW", "25vw");
        const savedH = GM_getValue("bot_panelH", "50vh");
        const S  = "#enginePanel";
        const SM = "#modal";
        const SL = "#localModal";
        const SO = "#modalOv, #localModalOv";

        // ─────────────────────────────────────────────────────────────────────
        // IMPROVED CSS — same variables/selectors, cleaner visual system
        // ─────────────────────────────────────────────────────────────────────
        const style = `
            /* ── CSS custom properties ── */
            ${S}  { --bot-bg:${settings.themeBg}; --bot-b:${settings.themeBorder}; --bot-p:${settings.themePrimary}; --bot-t:${settings.themeText}; --bot-primary:${settings.themePrimary}; }
            ${SM} { --bot-bg:${settings.themeBg}; --bot-b:${settings.themeBorder}; --bot-p:${settings.themePrimary}; --bot-t:${settings.themeText}; --bot-primary:${settings.themePrimary}; }
            ${SL} { --bot-bg:${settings.themeBg}; --bot-b:${settings.themeBorder}; --bot-p:${settings.themePrimary}; --bot-t:${settings.themeText}; --bot-primary:${settings.themePrimary}; }
            ${S} *, ${SM} *, ${SL} * { box-sizing: border-box; }

            /* ── Main panel ── */
            ${S} {
                position: fixed;
                width: ${savedW}; height: ${savedH};
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
                opacity: ${settings.menuOpacity};
                border-radius: 6px;
            }

            /* ── Hidden state — completely invisible, H key toggles it back ── */
            ${S}.bot-hidden { display: none !important; }

            /* ── Panel header ── */
            #panelHeader {
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
            #panelHeader .header-left {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #minBtn {
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                background: rgba(0,0,0,0.15);
                border-radius: 4px;
                font-size: 11px;
                transition: background 0.15s;
            }
            #minBtn:hover { background: rgba(0,0,0,0.28); }

            /* ── Panel content ── */
            #panelContent {
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                overflow-y: auto;
                flex: 1;
                min-height: 0;
            }

            /* ── Sections ── */
            ${S} .sect, ${SM} .sect, ${SL} .sect {
                border-top: 1px solid var(--bot-b);
                padding-top: 10px;
                display: flex;
                flex-direction: column;
                gap: 7px;
            }
            ${S} .sect-title, ${SM} .sect-title, ${SL} .sect-title {
                font-size: 0.7em;
                color: #888;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 2px;
            }

            /* ── Rows ── */
            ${S} .row, ${SM} .row, ${SL} .row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 2px;
            }
            ${S} .row label, ${SM} .row label, ${SL} .row label {
                font-size: 0.85em;
                color: var(--bot-t);
                opacity: 0.85;
                font-weight: 500;
            }

            /* ── Inputs ── */
            ${S} input, ${S} select,
            ${SM} input, ${SM} select,
            ${SL} input, ${SL} select {
                background: rgba(255,255,255,0.06);
                color: var(--bot-t);
                border: 1px solid var(--bot-b);
                padding: 4px 7px;
                border-radius: 4px;
                font-size: 12px;
                height: 26px;
                transition: border-color 0.15s;
            }
            ${S} select, ${SM} select, ${SL} select {
                background-color: #2a2a2a;
            }
            ${S} select option, ${SM} select option, ${SL} select option {
                background-color: #2a2a2a;
                color: #eeeeee;
            }
            ${S} input:focus, ${S} select:focus,
            ${SM} input:focus, ${SM} select:focus,
            ${SL} input:focus, ${SL} select:focus {
                outline: none;
                border-color: var(--bot-p);
            }
            ${S} input[type="number"], ${SM} input[type="number"], ${SL} input[type="number"] { width: 60px; text-align: center; }
            ${S} select, ${SM} select, ${SL} select { width: 120px; }
            ${S} input[type="text"], ${SM} input[type="text"], ${SL} input[type="text"] { flex: 1; }

            /* ── Checkboxes ── */
            ${S} input[type="checkbox"], ${SM} input[type="checkbox"], ${SL} input[type="checkbox"] {
                width: 15px; height: 15px;
                accent-color: var(--bot-p);
                cursor: pointer;
                border: none;
                background: transparent;
            }

            /* ── Range sliders ── */
            ${S} input[type=range], ${SM} input[type=range] {
                -webkit-appearance: none;
                width: 100%;
                background: transparent;
                padding: 0; margin: 0;
                border: none;
                height: 18px;
            }
            ${S} input[type=range]:focus, ${SM} input[type=range]:focus { outline: none; }
            ${S} input[type=range]::-webkit-slider-runnable-track,
            ${SM} input[type=range]::-webkit-slider-runnable-track {
                width: 100%; height: 4px; cursor: pointer;
                background: var(--bot-b); border-radius: 2px;
            }
            ${S} input[type=range]::-webkit-slider-thumb,
            ${SM} input[type=range]::-webkit-slider-thumb {
                height: 14px; width: 14px; border-radius: 50%;
                background: var(--bot-p); cursor: pointer;
                -webkit-appearance: none; margin-top: -5px;
                border: 2px solid rgba(0,0,0,0.2);
                box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                transition: transform 0.1s;
            }
            ${S} input[type=range]::-webkit-slider-thumb:hover,
            ${SM} input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.15); }
            #sliderH { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00) !important; }
            #sliderH::-webkit-slider-thumb { background: #fff !important; border: 2px solid #000 !important; }

            /* ── Buttons ── */
            ${S} button, ${SM} button, ${SL} button {
                background: var(--bot-p);
                border: none;
                padding: 0 12px;
                height: 30px;
                color: #000;
                font-weight: 700;
                font-size: 12px;
                cursor: pointer;
                border-radius: 4px;
                transition: filter 0.15s, transform 0.1s;
                letter-spacing: 0.02em;
                white-space: nowrap;
            }
            ${S} button:hover, ${SM} button:hover, ${SL} button:hover {
                filter: brightness(1.12);
            }
            ${S} button:active, ${SM} button:active { transform: scale(0.97); }
            ${S} button:disabled, ${SM} button:disabled, ${SL} button:disabled {
                opacity: 0.45; cursor: not-allowed; filter: none; transform: none;
            }

            /* ── Specific named buttons ── */
            #btnReset {
                padding: 0 8px;
                height: 24px;
                font-size: 11px;
                background: rgba(0,0,0,0.18) !important;
                color: rgba(0,0,0,0.8) !important;
                border-radius: 3px;
            }
            #custBtn  { background: #4fc3f7 !important; color: #000 !important; }
            #localBtn { background: #ffcc80 !important; color: #000 !important; }
            #btnAnalyze {
                width: 100%;
                height: 34px;
                font-size: 13px;
                letter-spacing: 0.04em;
            }
            #custBtn, #localBtn { width: 100%; }

            /* ── Utility button row ── */
            .btn-row {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            /* ── Log boxes ── */
            .log-box {
                background: rgba(0,0,0,0.4);
                padding: 7px 9px;
                font-family: 'Cascadia Code', 'Fira Mono', monospace;
                font-size: 0.72em;
                border-radius: 4px;
                overflow-y: auto;
                word-break: break-all;
                white-space: pre-wrap;
                border: 1px solid var(--bot-b);
                height: 90px;
                resize: vertical;
                user-select: text !important;
                -webkit-user-select: text !important;
                cursor: text;
                color: #ccc;
            }

            /* ── Status box ── */
            #statusBox {
                background: rgba(0,0,0,0.18);
                padding: 8px 10px;
                border: 1px solid rgba(0,188,212,0.35);
                border-radius: 5px;
                font-size: 0.88em;
                min-height: 42px;
                width: 100%;
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            /* ── Move result ── */
            #moveResult {
                background: rgba(0,0,0,0.18);
                padding: 5px 10px;
                border-radius: 4px;
                text-align: center;
                font-size: 0.88em;
                border: 1px solid var(--bot-b);
            }

            /* ── Overlays ── */
            ${SO} {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.75);
                z-index: 10000;
                display: none;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(2px);
            }

            /* ── Modals ── */
            ${SM}, ${SL} {
                background: var(--bot-bg);
                padding: 0;
                border-radius: 8px;
                width: 480px;
                border: 1px solid var(--bot-b);
                display: flex;
                flex-direction: column;
                max-height: 90vh;
                opacity: ${settings.menuOpacity};
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            }
            ${SM} *, ${SL} * { color: var(--bot-t); }
            ${SM} label, ${SL} label { opacity: 1 !important; font-weight: 600; font-size: 0.88em; }
            ${SM} input[type="color"], ${SL} input[type="color"] { height: 26px; padding: 0; width: 40px; cursor: pointer; border: none; }
            ${SM} select, ${SL} select { height: 26px; padding: 0 6px; font-size: 0.88em; }

            /* ── Mode-dependent cloud rows ── */
            ${S} .show-cloud { display: none; }
            ${S} .show-local { display: none; }
            body.mode-cloud ${S} .show-cloud { display: flex; }
            body.mode-local ${S} .show-local { display: flex; }

            /* ── RGB inputs ── */
            ${SM} .rgb-inputs, ${S} .rgb-inputs { display: flex; gap: 5px; flex: 1; justify-content: flex-end; }
            ${SM} .rgb-inputs input, ${S} .rgb-inputs input { width: 46px; text-align: center; }

            /* ── FEN tooltip ── */
            #fenTooltip {
                position: fixed;
                border: 2px solid #444;
                background: #1a1a1a;
                z-index: 10001;
                display: none;
                pointer-events: none;
                box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                border-radius: 5px;
                overflow: hidden;
            }
            .fen-board { display: grid; grid-template-columns: repeat(8, 1fr); width: 240px; height: 240px; }
            .fen-sq { width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; background-size: 100%; background-repeat: no-repeat; }
            .fen-sq.light { background-color: #eeeed2; }
            .fen-sq.dark  { background-color: #769656; }

            /* ── Modal header ── */
            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 16px;
                border-bottom: 1px solid var(--bot-b);
            }
            .modal-header h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.03em; }
            .modal-header button {
                padding: 0 !important;
                width: 26px; height: 26px;
                background: rgba(255,255,255,0.08) !important;
                color: var(--bot-t) !important;
                border-radius: 4px;
                font-size: 16px;
                line-height: 1;
            }
            .modal-header button:hover { background: rgba(255,255,255,0.16) !important; }

            /* ── Modal tabs ── */
            .modal-tabs { display: flex; border-bottom: 1px solid var(--bot-b); }
            ${SM} .tab-btn {
                flex: 1;
                background: transparent !important;
                border: none !important;
                border-bottom: 2px solid transparent !important;
                padding: 10px;
                color: var(--bot-t) !important;
                cursor: pointer;
                opacity: 0.55;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.03em;
                transition: opacity 0.15s;
                height: auto;
            }
            ${SM} .tab-btn:hover { opacity: 0.85; }
            ${SM} .tab-btn.active { opacity: 1; border-bottom: 2px solid var(--bot-p) !important; }

            /* ── Modal content ── */
            .modal-content { padding: 14px 16px; overflow-y: auto; flex: 1; }
            ${SM} .modal-content .row { display: flex; align-items: center; margin-bottom: 11px; }
            ${SM} .modal-content .row label { flex: 0 0 128px; text-align: left; font-weight: 600; }
            ${SM} .modal-content .row > input[type="text"],
            ${SM} .modal-content .row > input[type="color"],
            ${SM} .modal-content .row > select { flex: 1; }

            /* ── Slider groups ── */
            ${S} .slider-group, ${SM} .slider-group {
                display: flex; align-items: center; gap: 7px; flex: 1; justify-content: flex-end;
            }
            ${S} .slider-group input[type=range], ${SM} .slider-group input[type=range] { flex: 1; }
            ${S} .slider-group input[type=number], ${SM} .slider-group input[type=number] { width: 46px; text-align: center; }
            ${S} .slider-group span, ${SM} .slider-group span { font-size: 0.78em; color: #777; min-width: 14px; }

            /* ── Advanced toggles ── */
            .adv-toggle {
                cursor: pointer;
                font-size: 0.78em;
                color: var(--bot-p);
                text-decoration: none;
                margin-top: 4px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                opacity: 0.85;
                transition: opacity 0.15s;
            }
            .adv-toggle:hover { opacity: 1; }
            .adv-sect {
                margin-top: 8px;
                padding-left: 10px;
                border-left: 2px solid var(--bot-b);
                display: flex;
                flex-direction: column;
                gap: 7px;
            }

            /* ── Theme presets ── */
            .theme-presets { display: flex; gap: 8px; margin-bottom: 12px; }
            ${SM} .theme-btn {
                flex: 1;
                padding: 0 !important;
                height: 30px !important;
                border: 1px solid var(--bot-b) !important;
                background: rgba(255,255,255,0.05) !important;
                color: var(--bot-t) !important;
                font-size: 12px !important;
            }

            /* ── Local modal specifics ── */
            #localEngineStatus { font-weight: 700; font-size: 1em; }
            #localEngineStatusMsg { font-size: 0.78em; color: #888; margin-top: 3px; min-height: 14px; }
            .local-action-btn { padding: 0 14px !important; font-size: 0.83em !important; height: 30px !important; }
            .local-btn-install   { background: #27ae60 !important; color: #fff !important; }
            .local-btn-reinstall { background: #2980b9 !important; color: #fff !important; }
            .local-btn-uninstall { background: #c0392b !important; color: #fff !important; }
            ${SL} .info-box {
                background: rgba(0,0,0,0.25);
                border: 1px solid var(--bot-b);
                border-radius: 4px;
                padding: 7px 10px;
                font-size: 0.78em;
                font-family: 'Cascadia Code', 'Fira Mono', monospace;
                color: #999;
                word-break: break-all;
            }
            ${SL} input[type="text"] { width: 100%; font-size: 0.83em; }
            ${SL} select { width: 100%; }

            /* ── Automation checkboxes layout ── */
            .auto-checks {
                display: flex;
                gap: 14px;
                flex-wrap: wrap;
            }
            .auto-checks label {
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 0.83em;
                cursor: pointer;
                white-space: nowrap;
            }

            /* ── PV section header ── */
            .pv-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            }
        `;

        const fullHTML = `<style>${style}</style>` + `
            <div id="enginePanel" class="bot-hidden">
                <div id="panelHeader">
                    <div class="header-left">
                        <span>SF Engine</span>
                        <span id="minBtn">\u2715</span>
                    </div>
                    <button id="btnReset">Reset Defaults</button>
                </div>
                <div id="panelContent">
                    <div id="statusBox">${state.lastLiveResult}</div>
                    <div id="moveResult">${state.lastMoveResult}</div>

                    <div class="sect">
                        <div class="sect-title">Engine</div>
                        <div class="row">
                            <label>Model</label>
                            <select id="selMode" style="width:200px;">
                                <option value="cloud">SF 18.0.0 — Cloud (fast)</option>
                                <option value="sfonline">SF 17.1.0 — Cloud (variable)</option>
                                <option value="local">SF — Local (offline)</option>
                            </select>
                        </div>
                        <div class="row">
                            <label>Depth <span style="color:#666;">(max <span id="lblMaxDepth">18</span>)</span></label>
                            <input type="number" id="inpDepth" min="1" max="18" value="${settings.depth}">
                        </div>
                        <div class="row show-cloud">
                            <label>Max Time (ms)</label>
                            <input type="number" id="inpTime" value="${settings.maxThinkingTime}">
                        </div>
                        <div class="row show-cloud">
                            <label>Search Moves</label>
                            <input type="text" id="inpSearch" value="${settings.searchMoves}" placeholder="e.g. e2e4 d2d4">
                        </div>
                    </div>

                    <div class="sect">
                        <div class="pv-header">
                            <div class="sect-title" style="margin:0;">PV Arrows</div>
                            <input type="checkbox" id="chkPV" ${settings.showPVArrows ? "checked" : ""}>
                        </div>
                        <div id="pvSettings" style="display:none; display:flex; flex-direction:column; gap:7px;">
                            <div class="row">
                                <label>Depth (1–45)</label>
                                <div class="slider-group">
                                    <input type="range" id="inpPVDepth" min="1" max="45" step="1" value="${settings.pvDepth}">
                                    <input type="number" id="inpPVDepthNum" min="1" max="45" value="${settings.pvDepth}">
                                </div>
                            </div>
                            <div class="row">
                                <label>Show Numbers</label>
                                <input type="checkbox" id="chkPVNums" ${settings.pvShowNumbers ? "checked" : ""}>
                            </div>
                            <div class="row">
                                <label>Custom Gradient</label>
                                <input type="checkbox" id="chkPVGrad" ${settings.pvCustomGradient ? "checked" : ""}>
                            </div>
                            <div id="pvGradSettings" style="display:none; padding-left:10px; border-left:2px solid #333; margin-top:3px; flex-direction:column; gap:6px;">
                                <div class="row"><label>Start Color</label><input type="color" id="inpPVStart" value="${settings.pvStartColor}"></div>
                                <div class="row"><label>End Color</label><input type="color" id="inpPVEnd" value="${settings.pvEndColor}"></div>
                            </div>
                        </div>
                    </div>

                    <div class="sect">
                        <div class="sect-title">Automation</div>
                        <div class="auto-checks">
                            <label><input type="checkbox" id="chkRun" ${settings.autoRun ? "checked" : ""}> Auto-Analyze</label>
                            <label><input type="checkbox" id="chkMove" ${settings.autoMove ? "checked" : ""}> Auto-Move</label>
                            <label><input type="checkbox" id="chkQueue" ${settings.autoQueue ? "checked" : ""}> Auto-Queue</label>
                        </div>
                        <div class="auto-checks" style="margin-top:4px;">
                            <label><input type="checkbox" id="chkThreatDet" ${settings.threatDetection ? "checked" : ""}> Threat Detection</label>
                            <label><input type="checkbox" id="chkOpeningBook" ${settings.openingBookEnabled ? "checked" : ""}> Opening Book</label>
                            <label><input type="checkbox" id="chkTimeMgmt" ${settings.timeManagement ? "checked" : ""}> Time Management</label>
                        </div>
<div class="auto-checks" style="margin-top:4px;">
                                <!-- Humanizer: empty div spans both rows -->
                                <label><input type="checkbox" id="chkHumanizer" ${settings.humanizer ? "checked" : ""}> Humanizer</label>
                            </div>

                            <div class="row" style="margin-top:4px;">
<label>Humanize Rate (%)</label>
                                <input type="number" id="inpHumanizeRate" min="5" max="80" value="${settings.humanizeRate}" style="width:60px;">
                            </div>
                            <div class="auto-checks" style="margin-top:4px;">
                                <label><input type="checkbox" id="chkRematch" ${settings.autoRematch ? "checked" : ""}> Auto-Rematch</label>
                            </div>
                    </div>

                    <div class="sect">
                        <div class="sect-title">Display</div>
                        <div class="row">
                            <label>Eval Bar</label>
                            <input type="checkbox" id="chkEvalBar" ${settings.showEvalBar ? "checked" : ""}>
                        </div>
                        <div class="row">
                            <label>Move Highlights</label>
                            <input type="checkbox" id="chkMoveHighlights" ${settings.showMoveHighlights ? "checked" : ""}>
                        </div>
                    </div>

<div class="btn-row">
                        <button id="btnAnalyze">▶ Analyze</button>
                        <button id="btnRematch" style="background:#c0392b !important; color:white !important;">🔄 Rematch</button>
                        <button id="custBtn">🎨 Visuals & Theme</button>
                        <button id="localBtn">⚙ Local Engine Settings</button>
                    </div>

                    <div class="sect">
                        <div class="row">
                            <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                                <input type="checkbox" id="chkDebug" ${settings.debugLogs ? "checked" : ""}> Debug Logs
                            </label>
                        </div>
                        <div id="debugArea" style="display:${settings.debugLogs ? "flex" : "none"}; flex-direction:column; gap:5px;">
                            <div class="log-box" id="sentCommandOutput"></div>
                            <div class="log-box" id="receivedMessageOutput"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="modalOv">
                <div id="modal">
                    <div class="modal-header">
                        <h3 style="color:var(--bot-p);">Visuals &amp; Theme</h3>
                        <button id="modalClose">×</button>
                    </div>
                    <div class="modal-tabs">
                        <button class="tab-btn active" id="tabMove">Move Display</button>
                        <button class="tab-btn" id="tabTheme">Menu Theme</button>
                    </div>
                    <div class="modal-content" id="tabContentMove">
                        <div class="sect" style="border:none; padding:0;">
                            <div class="row">
                                <label>Visual Type</label>
                                <select id="visType" style="width:120px; height:26px;">
                                    <option value="boxes">Boxes</option>
                                    <option value="arrow">Arrow</option>
                                    <option value="outline">Outline</option>
                                    <option value="nativeArrow">Chess.com's Arrow</option>
                                </select>
                            </div>
                            <div class="row" id="rowDuration">
                                <label>Display Duration</label>
                                <div class="slider-group">
                                    <input type="range" id="visDuration" min="0" max="100" step="1" value="100">
                                    <span id="visDurationText" style="width:52px; text-align:right; font-size:0.85em; font-family:monospace;">Forever</span>
                                </div>
                            </div>
                            <div class="row" id="rowFadeOut" style="display:none;">
                                <label>Fade Out</label>
                                <input type="checkbox" id="chkFadeOut">
                            </div>
                            <div class="row">
                                <label>Hide After Move</label>
                                <input type="checkbox" id="chkHideAfterMove" ${settings.hideAfterMove ? "checked" : ""}>
                            </div>
                        </div>

                        <div class="sect" id="sectHighlightColor">
                            <div class="sect-title">Highlight Color</div>
                            <div style="display:flex; flex-direction:column; gap:9px;">
                                <div class="row">
                                    <div id="colorPreview" style="width:32px; height:32px; border-radius:50%; border:2px solid #555; background:${settings.highlightColor}; flex:0 0 32px;"></div>
                                    <div class="rgb-inputs">
                                        <input type="number" id="inpR" min="0" max="255" placeholder="R">
                                        <input type="number" id="inpG" min="0" max="255" placeholder="G">
                                        <input type="number" id="inpB" min="0" max="255" placeholder="B">
                                    </div>
                                </div>
                                <div class="row"><label>Hue</label><div class="slider-group"><input type="range" id="sliderH" min="0" max="360" value="${state.h}"><input type="number" id="sliderHNum" min="0" max="360" value="${Math.round(state.h)}"></div></div>
                                <div class="row"><label>Saturation</label><div class="slider-group"><input type="range" id="sliderS" min="0" max="100" value="${state.s}"><input type="number" id="sliderSNum" min="0" max="100" value="${Math.round(state.s)}"><span>%</span></div></div>
                                <div class="row"><label>Brightness</label><div class="slider-group"><input type="range" id="sliderL" min="0" max="100" value="${state.l}"><input type="number" id="sliderLNum" min="0" max="100" value="${Math.round(state.l)}"><span>%</span></div></div>
                                <div class="row"><label>Hex</label><input type="text" id="inpHex" style="text-transform:uppercase; text-align:center; font-family:monospace;"></div>
                            </div>
                        </div>

                        <div class="sect" id="sectAdvancedVis">
                            <div class="adv-toggle" id="advToggle">▼ Advanced Visual Settings</div>
                            <div class="adv-sect" id="advSect" style="display:none;">
                                <div id="visBoxSettings">
                                    <div class="row"><label>Inner Opacity</label><div class="slider-group"><input type="range" id="visInnerOp" min="0" max="1" step="0.01" value="${settings.innerOpacity}"><input type="number" id="visInnerOpNum" min="0" max="100" value="${Math.round(settings.innerOpacity*100)}"><span>%</span></div></div>
                                    <div class="row"><label>Outer Opacity</label><div class="slider-group"><input type="range" id="visOuterOp" min="0" max="1" step="0.01" value="${settings.outerOpacity}"><input type="number" id="visOuterOpNum" min="0" max="100" value="${Math.round(settings.outerOpacity*100)}"><span>%</span></div></div>
                                    <div class="row"><label>Gradient Bias</label><div class="slider-group"><input type="range" id="visBias" min="0" max="100" step="1" value="${settings.gradientBias}"><input type="number" id="visBiasNum" min="0" max="100" value="${settings.gradientBias}"><span>%</span></div></div>
                                </div>
                                <div id="visArrowSettings" style="display:none;">
                                    <div class="row"><label>Arrow Opacity</label><div class="slider-group"><input type="range" id="visArrowOp" min="0" max="1" step="0.01" value="${settings.arrowOpacity}"><input type="number" id="visArrowOpNum" min="0" max="100" value="${Math.round(settings.arrowOpacity*100)}"><span>%</span></div></div>
                                    <div class="row"><label>Arrow Width</label><div class="slider-group"><input type="range" id="visArrowWidth" min="5" max="50" step="1" value="${settings.arrowWidth}"><input type="number" id="visArrowWidthNum" min="5" max="50" value="${settings.arrowWidth}"><span>px</span></div></div>
                                </div>
                                <div id="visOutlineSettings" style="display:none;">
                                    <div class="row"><label>Line Opacity</label><div class="slider-group"><input type="range" id="visOutOp" min="0" max="1" step="0.01" value="${settings.visualOutlineOpacity}"><input type="number" id="visOutOpNum" min="0" max="100" value="${Math.round(settings.visualOutlineOpacity*100)}"><span>%</span></div></div>
                                    <div class="row"><label>Line Width</label><div class="slider-group"><input type="range" id="visOutWidth" min="1" max="10" step="1" value="${settings.visualOutlineWidth}"><input type="number" id="visOutWidthNum" min="1" max="10" value="${settings.visualOutlineWidth}"><span>px</span></div></div>
                                    <div class="row"><label>Glow Effect</label><input type="checkbox" id="visOutGlow" ${settings.visualOutlineGlow ? "checked" : ""}></div>
                                    <div class="row"><label>Glow Radius</label><div class="slider-group"><input type="range" id="visOutGlowRad" min="1" max="50" step="1" value="${settings.visualOutlineGlowRadius}"><input type="number" id="visOutGlowRadNum" min="1" max="50" value="${settings.visualOutlineGlowRadius}"><span>px</span></div></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-content" id="tabContentTheme" style="display:none;">
                        <div class="theme-presets">
                            <button class="theme-btn" id="btnThemeDark">🌙 Dark</button>
                            <button class="theme-btn" id="btnThemeLight">☀ Light</button>
                        </div>
                        <div class="sect" style="border:none; padding:0; gap:10px;">
                            <div class="sect-title">Menu Position</div>
                            <div class="row">
                                <label>Panel Position</label>
                                <select id="selMenuPos">
                                    <option value="custom">Custom (Drag)</option>
                                    <option value="top-left">Top Left</option>
                                    <option value="top-right">Top Right</option>
                                    <option value="bottom-left">Bottom Left</option>
                                    <option value="bottom-right">Bottom Right</option>
                                </select>
                            </div>
                        </div>
                        <div class="sect">
                            <div class="sect-title">Opacity</div>
                            <div class="row">
                                <label>Menu Opacity</label>
                                <div class="slider-group">
                                    <input type="range" id="inpMenuOp" min="0.1" max="1" step="0.01" value="${settings.menuOpacity}">
                                    <input type="number" id="inpMenuOpNum" min="10" max="100" value="${Math.round(settings.menuOpacity*100)}">
                                    <span>%</span>
                                </div>
                            </div>
                        </div>
                        <div class="sect">
                            <div class="sect-title">Custom Colors</div>
                            <div class="row"><label>Background</label><input type="color" id="colBg" value="${settings.themeBg}"></div>
                            <div class="row"><label>Text</label><input type="color" id="colTxt" value="${settings.themeText}"></div>
                            <div class="row"><label>Border</label><input type="color" id="colBorder" value="${settings.themeBorder}"></div>
                            <div class="row"><label>Accent / Primary</label><input type="color" id="colPrim" value="${settings.themePrimary}"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="localModalOv">
                <div id="localModal">
                    <div class="modal-header">
                        <h3 style="color:#e67e22;">Local Engine Settings</h3>
                        <button id="localModalClose">×</button>
                    </div>
                    <div class="modal-content" style="display:flex; flex-direction:column; gap:0;">

                        <!-- Model selector -->
                        <div class="sect" style="border:none; padding:10px 0 0 0;">
                            <div class="sect-title">Engine Model</div>
                            <select id="localModelSel" style="width:100%; height:28px; font-size:0.88em;">
                                ${LOCAL_ENGINES.map(e => `<option value="${e.id}"${(settings.localModelId||"sf18_05")===e.id?" selected":""}>${e.label}</option>`).join("")}
                            </select>
                            <div id="localModelInfo" style="margin-top:6px; font-size:0.71em; color:#888; font-family:monospace; word-break:break-all; background:rgba(0,0,0,0.18); border:1px solid var(--bot-b); border-radius:4px; padding:5px 8px; line-height:1.6;"></div>
                        </div>

                        <!-- Status + actions -->
                        <div class="sect">
                            <div class="sect-title">Status</div>
                            <div id="localEngineStatus">❌ Not Installed</div>
                            <div id="localEngineStatusMsg"></div>
                            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                                <button id="btnLocalInstall"   class="local-action-btn local-btn-install">Install / Load</button>
                                <button id="btnLocalReinstall" class="local-action-btn local-btn-reinstall">Reinstall</button>
                                <button id="btnLocalUninstall" class="local-action-btn local-btn-uninstall">Uninstall</button>
                            </div>
                            <div style="font-size:0.7em; color:#666; margin-top:6px;">Each model is cached separately. Switching models requires Install / Load.</div>
                        </div>

                        <!-- Engine options — rows shown/hidden by model caps -->
                        <div class="sect">
                            <div class="sect-title">Engine Options</div>

                            <div class="row" id="rowHash">
                                <label>Hash Size (MB)</label>
                                <input type="number" id="localHashMB" min="1" max="2048" value="${settings.localHashMB}" style="width:70px;">
                            </div>

                            <div class="row" id="rowMoveOverhead">
                                <label>Move Overhead (ms)</label>
                                <input type="number" id="localMoveOverhead" min="0" max="5000" value="${settings.localMoveOverhead}" style="width:70px;">
                            </div>

                            <div id="rowSkillLevel" style="display:flex; flex-direction:column; gap:5px; margin-bottom:2px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                    <label>Skill Level (0–20)</label>
                                    <input type="number" id="localSkillLevel" min="0" max="20" value="${settings.localSkillLevel}" style="width:55px;">
                                </div>
                                <input type="range" id="localSkillLevelRange" min="0" max="20" step="1" value="${settings.localSkillLevel}" style="width:100%; margin:0;">
                                <div style="font-size:0.72em; color:#666;">20 = full strength. Lower values intentionally weaken play.</div>
                            </div>

                            <div id="rowLimitStrength">
                                <div class="row" style="margin-top:4px;">
                                    <label>Limit to Elo</label>
                                    <input type="checkbox" id="localLimitStrength" ${settings.localLimitStrength ? "checked" : ""}>
                                </div>
                                <div class="row" id="localEloRow" style="${settings.localLimitStrength ? "" : "display:none;"}">
                                    <label>Target Elo (1320–3190)</label>
                                    <input type="number" id="localElo" min="1320" max="3190" value="${settings.localElo}" style="width:70px;">
                                </div>
                                <div style="font-size:0.72em; color:#666; margin-top:2px;">Elo limit overrides Skill Level when enabled.</div>
                            </div>
                        </div>

                        <div class="sect">
                            <div class="adv-toggle" id="localAdvToggle">▼ Advanced Options</div>
                            <div id="localAdvSect" style="display:none; flex-direction:column; gap:9px;">

                                <div id="rowWDL">
                                    <div class="row" style="margin-top:6px;">
                                        <label>Show WDL in output</label>
                                        <input type="checkbox" id="localShowWDL" ${settings.localShowWDL ? "checked" : ""}>
                                    </div>
                                    <div style="font-size:0.72em; color:#666;">Adds win/draw/loss % to each info line in debug logs.</div>
                                </div>

                                <div id="rowMinThink">
                                    <div class="row">
                                        <label>Min Thinking Time (ms)</label>
                                        <input type="number" id="localMinThinkingTime" min="0" max="5000" value="${settings.localMinThinkTime}" style="width:70px;">
                                    </div>
                                    <div style="font-size:0.72em; color:#666;">Minimum ms engine spends per move regardless of time control.</div>
                                </div>

                                <div id="rowSlowMover">
                                    <div class="row">
                                        <label>Slow Mover (10–1000)</label>
                                        <input type="number" id="localSlowMover" min="10" max="1000" value="${settings.localSlowMover}" style="width:70px;">
                                    </div>
                                    <div style="font-size:0.72em; color:#666;">Lower = faster moves. Default 100.</div>
                                </div>

                                <div id="rowContempt">
                                    <div class="row">
                                        <label>Contempt (-100–100)</label>
                                        <input type="number" id="localContempt" min="-100" max="100" value="${settings.localContempt}" style="width:70px;">
                                    </div>
                                    <div style="font-size:0.72em; color:#666;">How much the engine avoids draws. 0 = neutral, higher = more aggressive. (SF 9–11 only)</div>
                                </div>
                            </div>
                        </div>

                        <!-- Exa AI Search Integration -->
                        <div class="sect">
                            <div class="sect-title">Exa AI Search</div>
                            <div class="row" style="margin-top:4px;">
                                <label>Enable Exa Search</label>
                                <input type="checkbox" id="exaSearchEnabled" ${settings.exaSearchEnabled ? "checked" : ""}>
                            </div>
                            <div class="row" style="margin-top:4px;">
                                <label>Exa API Key</label>
                                <input type="password" id="exaApiKey" value="${settings.exaApiKey}" placeholder="Enter your Exa API key" style="flex:1;">
                            </div>
                            <div style="font-size:0.72em; color:#666; margin-top:2px;">
                                Get your API key at <a href="https://dashboard.exa.ai/api-keys" target="_blank" style="color:var(--bot-p);">exa.ai</a>. Enables opening lookup, player stats, and endgame theory search.
                            </div>
                        </div>

                        <!-- Source info — populated dynamically -->
                        <div class="sect">
                            <div class="sect-title">Source URLs</div>
                            <div class="info-box" id="localSrcInfo" style="font-size:0.71em; line-height:1.7;"></div>
                        </div>

                    </div>
                </div>
            </div>

            <div id="fenTooltip"></div>
        `;
        document.body.insertAdjacentHTML("beforeend", fullHTML);
        const panel = document.getElementById("enginePanel");
        const computed = window.getComputedStyle(panel);
        panel.style.width = computed.width;
        panel.style.height = computed.height;
        state.ui = {
            panel: panel,
            header: document.getElementById("panelHeader"),
            minBtn: document.getElementById("minBtn"),
            moveResult: document.getElementById("moveResult"),
            liveOutput: document.getElementById("statusBox"),
            logSent: document.getElementById("sentCommandOutput"),
            logRec: document.getElementById("receivedMessageOutput"),
            btnAnalyze: document.getElementById("btnAnalyze"),
            btnRematch: document.getElementById("btnRematch"),
            selMode: document.getElementById("selMode"),
            inpDepth: document.getElementById("inpDepth"),
            inpTime: document.getElementById("inpTime"),
            inpSearch: document.getElementById("inpSearch"),
            chkRun: document.getElementById("chkRun"),
            chkMove: document.getElementById("chkMove"),
            chkQueue: document.getElementById("chkQueue"),
            chkHideAfterMove: document.getElementById("chkHideAfterMove"),
            chkPV: document.getElementById("chkPV"),
            inpPVDepth: document.getElementById("inpPVDepth"),
            inpPVDepthNum: document.getElementById("inpPVDepthNum"),
            chkPVNums: document.getElementById("chkPVNums"),
            chkPVGrad: document.getElementById("chkPVGrad"),
inpPVStart: document.getElementById("inpPVStart"),
            inpPVEnd: document.getElementById("inpPVEnd"),
pvSettings: document.getElementById("pvSettings"),
            pvGradSettings: document.getElementById("pvGradSettings"),
            chkDebug: document.getElementById("chkDebug"),
            debugArea: document.getElementById("debugArea"),
            btnReset: document.getElementById("btnReset"),
            lblMaxDepth: document.getElementById("lblMaxDepth"),
            custBtn: document.getElementById("custBtn"),
            localBtn: document.getElementById("localBtn"),
            modal: document.getElementById("modalOv"),
            modalClose: document.getElementById("modalClose"),
            chkMoveHighlights: document.getElementById("chkMoveHighlights"),
            chkEvalBar: document.getElementById("chkEvalBar"),
            localModal: document.getElementById("localModalOv"),
            localModalClose: document.getElementById("localModalClose"),
            visType: document.getElementById("visType"),
            visBoxSettings: document.getElementById("visBoxSettings"),
            visArrowSettings: document.getElementById("visArrowSettings"),
            visOutlineSettings: document.getElementById("visOutlineSettings"),
            sliderH: document.getElementById("sliderH"),
            sliderHNum: document.getElementById("sliderHNum"),
            sliderS: document.getElementById("sliderS"),
            sliderSNum: document.getElementById("sliderSNum"),
            sliderL: document.getElementById("sliderL"),
            sliderLNum: document.getElementById("sliderLNum"),
            colorPreview: document.getElementById("colorPreview"),
            inpR: document.getElementById("inpR"),
            inpG: document.getElementById("inpG"),
            inpB: document.getElementById("inpB"),
            inpHex: document.getElementById("inpHex"),
            fenTooltip: document.getElementById("fenTooltip"),
            tabMove: document.getElementById("tabMove"),
            tabTheme: document.getElementById("tabTheme"),
            tabContentMove: document.getElementById("tabContentMove"),
            tabContentTheme: document.getElementById("tabContentTheme"),
            advToggle: document.getElementById("advToggle"),
            advSect: document.getElementById("advSect"),
            visInnerOp: document.getElementById("visInnerOp"),
            visInnerOpNum: document.getElementById("visInnerOpNum"),
            visOuterOp: document.getElementById("visOuterOp"),
            visOuterOpNum: document.getElementById("visOuterOpNum"),
            visBias: document.getElementById("visBias"),
            visBiasNum: document.getElementById("visBiasNum"),
            visArrowOp: document.getElementById("visArrowOp"),
            visArrowOpNum: document.getElementById("visArrowOpNum"),
            visArrowWidth: document.getElementById("visArrowWidth"),
            visArrowWidthNum: document.getElementById("visArrowWidthNum"),
            visOutOp: document.getElementById("visOutOp"),
            visOutOpNum: document.getElementById("visOutOpNum"),
            visOutWidth: document.getElementById("visOutWidth"),
            visOutWidthNum: document.getElementById("visOutWidthNum"),
            visOutGlow: document.getElementById("visOutGlow"),
            visOutGlowRad: document.getElementById("visOutGlowRad"),
            visOutGlowRadNum: document.getElementById("visOutGlowRadNum"),
            btnThemeDark: document.getElementById("btnThemeDark"),
            btnThemeLight: document.getElementById("btnThemeLight"),
            inpMenuOp: document.getElementById("inpMenuOp"),
            inpMenuOpNum: document.getElementById("inpMenuOpNum"),
            colBg: document.getElementById("colBg"),
            colTxt: document.getElementById("colTxt"),
            colBorder: document.getElementById("colBorder"),
            colPrim: document.getElementById("colPrim"),
            selMenuPos: document.getElementById("selMenuPos"),
            chkRematch: document.getElementById("chkRematch")
        };
        applyMenuPosition();
        // Engine is loaded lazily only when user selects "Local Engine" mode.
        // Do NOT load at startup — avoids downloading 20MB Stockfish in cloud/sfonline modes.
        if (state.localEngine) {
            setEngineStatus("ready", "");
        } else {
            updateLocalSettingsUI();
        }
        // Bindings (all identical to original)
        state.ui.selMode.value = settings.engineMode;
        state.ui.selMenuPos.value = settings.menuPosition;
        state.ui.btnAnalyze.onclick = () => analyze();
        state.ui.btnRematch.onclick = () => {
            const allBtns = document.querySelectorAll("button");
            for (let b of allBtns) {
                const txt = b.innerText.toLowerCase().trim();
                if ((txt === "rematch" || txt === "new game" || txt === "play again" || txt === "new opponent" || txt === "find new opponent") && isElVisible(b) && !b.disabled) {
                    b.click();
                    return;
                }
            }
        };
        state.ui.btnReset.onclick = resetSettings;
        state.ui.custBtn.onclick = () => (state.ui.modal.style.display = "flex");
        state.ui.modalClose.onclick = () => (state.ui.modal.style.display = "none");
        state.ui.localBtn.onclick = () => { loadModelSettings(settings.localModelId); syncLocalSettingsInputs(); updateLocalSettingsUI(); state.ui.localModal.style.display = "flex"; };
        state.ui.localModalClose.onclick = () => (state.ui.localModal.style.display = "none");

        document.getElementById("btnLocalInstall").onclick   = () => { state.engineRetryAt = 0; loadLocalEngine(); updateLocalSettingsUI(); };
        document.getElementById("btnLocalReinstall").onclick = () => reinstallEngine();
        document.getElementById("btnLocalUninstall").onclick = () => { if (confirm("Uninstall local engine and clear cache?")) uninstallEngine(); };

        // ── Model selector ─────────────────────────────────────────────────
        const localModelSel = document.getElementById("localModelSel");
        localModelSel.onchange = (e) => {
            const newId = e.target.value;
            // Shut down any currently running engine
            if (state.localEngine) {
                try { state.localEngine.terminate(); } catch(_) {}
                state.localEngine = null;
            }
            state.engineLoadingInProgress = false;
            saveSetting("localModelId", newId);
            // Load this model's saved per-model settings into working state
            loadModelSettings(newId);
            // Clamp depth to new model's cap
            const m = getEngineById(newId);
            if (settings.depth > m.maxDepth) {
                settings.depth = m.maxDepth;
                saveSetting("depth", m.maxDepth);
                if (state.ui.inpDepth) state.ui.inpDepth.value = m.maxDepth;
            }
            // Refresh all input values in the modal to show this model's settings
            syncLocalSettingsInputs();
            setEngineStatus("not_installed", "");
            updateLocalSettingsUI();
            state.engineLoadGeneration++;
            state.engineRetryAt = 0;
            loadLocalEngine();
        };
        // Populate model info immediately on open
        syncLocalSettingsInputs();
        updateLocalSettingsUI();

        // ── Shared helpers ─────────────────────────────────────────────────
        const sendOpt = (name, val) => {
            if (state.localEngine) state.localEngine.postMessage(`setoption name ${name} value ${val}`);
        };
        // Save a setting scoped to the currently selected model
        const ms = (key, val) => saveModelSetting(key, val);

        // ── Hash ───────────────────────────────────────────────────────────
        document.getElementById("localHashMB").oninput = (e) => {
            const v = parseInt(e.target.value) || 64;
            ms("localHashMB", v); sendOpt("Hash", v);
        };

        // ── Move Overhead ──────────────────────────────────────────────────
        document.getElementById("localMoveOverhead").oninput = (e) => {
            const v = parseInt(e.target.value) || 100;
            ms("localMoveOverhead", v); sendOpt("Move Overhead", v);
        };

        // ── Skill Level (range + number synced) ───────────────────────────
        const skillNum   = document.getElementById("localSkillLevel");
        const skillRange = document.getElementById("localSkillLevelRange");
        const applySkill = (v) => { ms("localSkillLevel", v); sendOpt("Skill Level", v); };
        skillNum.oninput   = (e) => { const v = Math.min(20, Math.max(0, parseInt(e.target.value)||0)); skillRange.value = v; applySkill(v); };
        skillRange.oninput = (e) => { skillNum.value = e.target.value; applySkill(parseInt(e.target.value)); };

        // ── Elo Limit ──────────────────────────────────────────────────────
        const limitChk = document.getElementById("localLimitStrength");
        const eloRow   = document.getElementById("localEloRow");
        const eloInp   = document.getElementById("localElo");
        limitChk.onchange = (e) => {
            ms("localLimitStrength", e.target.checked);
            eloRow.style.display = e.target.checked ? "flex" : "none";
            sendOpt("UCI_LimitStrength", e.target.checked);
        };
        eloInp.oninput = (e) => {
            const v = Math.min(3190, Math.max(1320, parseInt(e.target.value)||1320));
            ms("localElo", v); sendOpt("UCI_Elo", v);
        };

        // ── Advanced toggle ────────────────────────────────────────────────
        const localAdvToggle = document.getElementById("localAdvToggle");
        const localAdvSect   = document.getElementById("localAdvSect");
        localAdvToggle.onclick = () => {
            const open = localAdvSect.style.display === "none" || localAdvSect.style.display === "";
            localAdvSect.style.display = open ? "flex" : "none";
            localAdvToggle.innerText   = open ? "▲ Advanced Options" : "▼ Advanced Options";
        };

        // ── WDL ────────────────────────────────────────────────────────────
        document.getElementById("localShowWDL").onchange = (e) => {
            ms("localShowWDL", e.target.checked);
            sendOpt("UCI_ShowWDL", e.target.checked);
        };

        // ── Min Thinking Time ──────────────────────────────────────────────
        document.getElementById("localMinThinkingTime").oninput = (e) => {
            const v = parseInt(e.target.value) || 20;
            ms("localMinThinkTime", v); sendOpt("Minimum Thinking Time", v);
        };

        // ── Slow Mover ─────────────────────────────────────────────────────
        document.getElementById("localSlowMover").oninput = (e) => {
            const v = Math.min(1000, Math.max(10, parseInt(e.target.value)||100));
            ms("localSlowMover", v); sendOpt("Slow Mover", v);
        };

        // ── Contempt ────────────────────────────────────────────────────────
        {
            const contemptInp = document.getElementById("localContempt");
            if (contemptInp) contemptInp.oninput = (e) => {
                const v = Math.min(100, Math.max(-100, parseInt(e.target.value) || 0));
                ms("localContempt", v); sendOpt("Contempt", v);
            };
        }

        // ── Exa AI Search ────────────────────────────────────────────────────
        const exaSearchChk = document.getElementById("exaSearchEnabled");
        if (exaSearchChk) {
            exaSearchChk.onchange = (e) => {
                settings.exaSearchEnabled = e.target.checked;
                ExaSearch.setApiKey(settings.exaApiKey);
                saveSetting("exaSearchEnabled", e.target.checked);
            };
        }
        const exaApiKeyInp = document.getElementById("exaApiKey");
        if (exaApiKeyInp) {
            exaApiKeyInp.oninput = (e) => {
                settings.exaApiKey = e.target.value;
                ExaSearch.setApiKey(e.target.value);
                saveSetting("exaApiKey", e.target.value);
            };
        }

        const hidePanel = () => {
            state.ui.panel.classList.add("bot-hidden");
            saveSetting("panelHidden", true);
        };
        state.ui.minBtn.onclick = (e) => { e.stopPropagation(); hidePanel(); };
        state.ui.minBtn.innerHTML = "\u2715";
        const bind = (el, key, type = "val") => {
            if (!el) return;
            el.addEventListener(type === "chk" ? "change" : "input", (e) => {
                const val = type === "chk" ? e.target.checked : type === "num" ? parseFloat(e.target.value) : e.target.value;
                saveSetting(key, val);
                if (key === "autoMove" && val === !0) triggerAutoMove(state.lastSentFEN);
                if (key === "autoQueue") toggleAutoQueue();
                if (key === "hideAfterMove" && val === !0) { Visuals.removeByType('history'); Visuals.removeByType('analysis'); PV.clear(); }
                if (["innerOpacity","outerOpacity","gradientBias","arrowOpacity","arrowWidth","visualOutlineWidth","visualOutlineOpacity","visualOutlineGlow","visualOutlineGlowRadius"].includes(key) && state.currentBestMove) {
                    Visuals.removeByType('history');
                    Visuals.add(state.currentBestMove, 'history');
                }
                if (["themeBg","themeText","themeBorder","themePrimary","menuOpacity"].includes(key)) applyTheme();
                updateUI();
            });
        };
        const bindSlider = (rangeEl, numEl, key, isPct = false) => {
            if (!rangeEl || !numEl) return;
            rangeEl.oninput = () => {
                let val = parseFloat(rangeEl.value);
                saveSetting(key, val);
                numEl.value = isPct ? Math.round(val * 100) : val;
                if (key === "menuOpacity") applyTheme();
                if (state.currentBestMove) { Visuals.removeByType('history'); Visuals.add(state.currentBestMove, 'history'); }
            };
            numEl.oninput = () => {
                let val = parseFloat(numEl.value);
                if (isPct) val /= 100;
                saveSetting(key, val);
                rangeEl.value = val;
                if (key === "menuOpacity") applyTheme();
                if (state.currentBestMove) { Visuals.removeByType('history'); Visuals.add(state.currentBestMove, 'history'); }
            };
        };
        state.ui.selMenuPos.onchange = (e) => { saveSetting("menuPosition", e.target.value); applyMenuPosition(); };
        state.ui.header.onmousedown = (e) => {
            if (e.target.id === "minBtn" || e.target.id === "btnReset") return;
            if (state.ui.panel.classList.contains("minified")) return;
            if (settings.menuPosition !== 'custom') { saveSetting("menuPosition", 'custom'); state.ui.selMenuPos.value = 'custom'; }
            e.preventDefault();
            const startX = e.clientX - state.ui.panel.offsetLeft;
            const startY = e.clientY - state.ui.panel.offsetTop;
            const onMove = (mv) => {
                let x = mv.clientX - startX, y = mv.clientY - startY;
                x = Math.max(0, Math.min(x, window.innerWidth - state.ui.panel.offsetWidth));
                y = Math.max(0, Math.min(y, window.innerHeight - state.ui.panel.offsetHeight));
                state.ui.panel.style.left = x + "px"; state.ui.panel.style.top = y + "px";
                state.ui.panel.style.right = "auto"; state.ui.panel.style.bottom = "auto";
                saveSetting("pX", x); saveSetting("pY", y);
            };
            document.addEventListener("mousemove", onMove);
            document.onmouseup = () => document.removeEventListener("mousemove", onMove);
        };
        new ResizeObserver(() => {
            if (!state.ui.panel.classList.contains("minified")) {
                saveSetting("panelW", state.ui.panel.style.width);
                saveSetting("panelH", state.ui.panel.style.height);
            }
        }).observe(state.ui.panel);
        state.ui.selMode.onchange = (e) => {
            saveSetting("engineMode", e.target.value);
            state.isThinking = false;
            if (settings.engineMode === "local") {
                // Auto-load immediately when switching to local
                if (!state.localEngine && !state.engineLoadingInProgress) {
                    loadLocalEngine();
                }
            } else {
                // Switching away from local — kill thinking but keep engine warm
                if (state.currentCloudRequest) {
                    try { state.currentCloudRequest.abort(); } catch(_) {}
                    state.currentCloudRequest = null;
                }
            }
            updateUI();
        };
        state.ui.chkDebug.onchange = (e) => { saveSetting("debugLogs", e.target.checked); updateUI(); };
        const durSlider = document.getElementById("visDuration");
        const durText = document.getElementById("visDurationText");
        const rowFade = document.getElementById("rowFadeOut");
        const chkFade = document.getElementById("chkFadeOut");
        const sliderToSeconds = (val) => { if (val <= 0) return -1; if (val >= 100) return 0; return Math.round((59.9 * Math.pow((val-1)/98,2)+0.1)*10)/10; };
        const secondsToSlider = (secs) => { if (secs === -1) return 0; if (secs === 0) return 100; return Math.round(Math.sqrt((secs-0.1)/59.9)*98)+1; };
        durSlider.value = secondsToSlider(settings.visualDuration);
        chkFade.checked = settings.visualFadeOut;
        const updateDurUI = () => {
            const val = parseInt(durSlider.value);
            const isNative = settings.visualType === "nativeArrow";
            if (val >= 100) { durText.innerText = "Forever"; if(rowFade) rowFade.style.display = "none"; saveSetting("visualDuration", 0); }
            else if (val <= 0) { durText.innerText = "Disabled"; if(rowFade) rowFade.style.display = "none"; saveSetting("visualDuration", -1); }
            else { const secs = sliderToSeconds(val); durText.innerText = secs.toFixed(1) + "s"; if(rowFade) rowFade.style.display = isNative ? "none" : "flex"; saveSetting("visualDuration", secs); }
        };
        durSlider.oninput = updateDurUI;
        chkFade.onchange = (e) => saveSetting("visualFadeOut", e.target.checked);
        updateDurUI();
        state.ui.visType.onchange = (e) => { saveSetting("visualType", e.target.value); toggleVisualInputs(); Visuals.removeByType('history'); if (state.currentBestMove) Visuals.add(state.currentBestMove, 'history'); };
        function toggleVisualInputs() {
            state.ui.visBoxSettings.style.display = "none";
            state.ui.visArrowSettings.style.display = "none";
            state.ui.visOutlineSettings.style.display = "none";

            const isNative = settings.visualType === "nativeArrow";
            const rowDur = document.getElementById("rowDuration");
            const sectColor = document.getElementById("sectHighlightColor");
            const sectAdv = document.getElementById("sectAdvancedVis");

            if (rowDur) rowDur.style.display = isNative ? "none" : "flex";
            if (sectColor) sectColor.style.display = isNative ? "none" : "flex";
            if (sectAdv) sectAdv.style.display = isNative ? "none" : "block";

            updateDurUI(); // Update fade out visibility based on the new logic

            if (!isNative) {
                if (settings.visualType === "arrow") state.ui.visArrowSettings.style.display = "block";
                else if (settings.visualType === "outline") state.ui.visOutlineSettings.style.display = "block";
                else state.ui.visBoxSettings.style.display = "block";
            }
        }
        state.ui.visType.value = settings.visualType;
        toggleVisualInputs();
        state.ui.tabMove.onclick = () => { state.ui.tabMove.classList.add("active"); state.ui.tabTheme.classList.remove("active"); state.ui.tabContentMove.style.display = "block"; state.ui.tabContentTheme.style.display = "none"; };
        state.ui.tabTheme.onclick = () => { state.ui.tabTheme.classList.add("active"); state.ui.tabMove.classList.remove("active"); state.ui.tabContentTheme.style.display = "block"; state.ui.tabContentMove.style.display = "none"; };
        state.ui.advToggle.onclick = () => { const isH = state.ui.advSect.style.display==="none"; state.ui.advSect.style.display = isH?"block":"none"; state.ui.advToggle.innerText = isH?"▲ Advanced Visual Settings":"▼ Advanced Visual Settings"; };
        state.ui.btnThemeDark.onclick = () => {
            state.ui.colBg.value="#222222"; state.ui.colTxt.value="#eeeeee"; state.ui.colBorder.value="#444444"; state.ui.colPrim.value="#81b64c";
            ["themeBg","themeText","themeBorder","themePrimary"].forEach(k => saveSetting(k, k==="themeBg"?"#222222":k==="themeText"?"#eeeeee":k==="themeBorder"?"#444444":"#81b64c"));
            applyTheme();
        };
        state.ui.btnThemeLight.onclick = () => {
            state.ui.colBg.value="#f0f0f0"; state.ui.colTxt.value="#222222"; state.ui.colBorder.value="#cccccc"; state.ui.colPrim.value="#81b64c";
            ["themeBg","themeText","themeBorder","themePrimary"].forEach(k => saveSetting(k, k==="themeBg"?"#f0f0f0":k==="themeText"?"#222222":k==="themeBorder"?"#cccccc":"#81b64c"));
            applyTheme();
        };
        bind(state.ui.inpDepth, "depth", "num"); bind(state.ui.inpTime, "maxThinkingTime", "num");
        bind(state.ui.inpSearch, "searchMoves"); bind(state.ui.chkRun, "autoRun", "chk");
        bind(state.ui.chkMove, "autoMove", "chk"); bind(state.ui.chkQueue, "autoQueue", "chk");

        // ─── New feature settings bindings ──
        const chkThreatDet   = document.getElementById("chkThreatDet");
        const chkOpeningBook = document.getElementById("chkOpeningBook");
        const chkTimeMgmt    = document.getElementById("chkTimeMgmt");
        const chkHumanizer   = document.getElementById("chkHumanizer");
        const inpHumanizeRate = document.getElementById("inpHumanizeRate");

        if (chkThreatDet)   chkThreatDet.onchange = (e) => { settings.threatDetection = e.target.checked; saveSetting("threatDetection", e.target.checked); ThreatDetector.enabled = e.target.checked; };
        if (chkOpeningBook) chkOpeningBook.onchange = (e) => { settings.openingBookEnabled = e.target.checked; saveSetting("openingBookEnabled", e.target.checked); OpeningBook.enabled = e.target.checked; };
        if (chkTimeMgmt)    chkTimeMgmt.onchange   = (e) => { settings.timeManagement = e.target.checked; saveSetting("timeManagement", e.target.checked); };
        if (chkHumanizer)   chkHumanizer.onchange  = (e) => { settings.humanizer = e.target.checked; saveSetting("humanizer", e.target.checked); };
        if (inpHumanizeRate) inpHumanizeRate.oninput = (e) => { const v = Math.min(80, Math.max(5, parseInt(e.target.value) || 15)); settings.humanizeRate = v; saveSetting("humanizeRate", v); };
        if (state.ui.chkRematch) state.ui.chkRematch.onchange = (e) => { settings.autoRematch = e.target.checked; saveSetting("autoRematch", e.target.checked); };
        // Toggle the visibility of the Keybind row when Auto-Move is checked/unchecked
        bind(state.ui.chkHideAfterMove, "hideAfterMove", "chk"); bind(state.ui.chkPV, "showPVArrows", "chk");
        bind(state.ui.chkMoveHighlights, "showMoveHighlights", "chk");
        state.ui.chkMoveHighlights.onchange = () => { if (!state.ui.chkMoveHighlights.checked) { Visuals.removeByType('history'); Visuals.removeByType('analysis'); } };
        bind(state.ui.chkEvalBar, "showEvalBar", "chk");
        state.ui.chkEvalBar.onchange = () => { if (!state.ui.chkEvalBar.checked) { const ov = EvalBar.el; if (ov) ov.remove(); EvalBar.el = null; EvalBar._els = null; } };

        // Sync threat detection toggle from settings
        ThreatDetector.enabled = !!settings.threatDetection;
        bindSlider(state.ui.inpPVDepth, state.ui.inpPVDepthNum, "pvDepth", false);
        bind(state.ui.chkPVNums, "pvShowNumbers", "chk"); bind(state.ui.chkPVGrad, "pvCustomGradient", "chk");
        bind(state.ui.inpPVStart, "pvStartColor"); bind(state.ui.inpPVEnd, "pvEndColor");
        bindSlider(state.ui.visInnerOp, state.ui.visInnerOpNum, "innerOpacity", true);
        bindSlider(state.ui.visOuterOp, state.ui.visOuterOpNum, "outerOpacity", true);
        bindSlider(state.ui.visBias, state.ui.visBiasNum, "gradientBias", false);
        bindSlider(state.ui.visArrowOp, state.ui.visArrowOpNum, "arrowOpacity", true);
        bindSlider(state.ui.visArrowWidth, state.ui.visArrowWidthNum, "arrowWidth", false);
        bindSlider(state.ui.visOutOp, state.ui.visOutOpNum, "visualOutlineOpacity", true);
        bindSlider(state.ui.visOutWidth, state.ui.visOutWidthNum, "visualOutlineWidth", false);
        bind(state.ui.visOutGlow, "visualOutlineGlow", "chk");
        bindSlider(state.ui.visOutGlowRad, state.ui.visOutGlowRadNum, "visualOutlineGlowRadius", false);
        bindSlider(state.ui.inpMenuOp, state.ui.inpMenuOpNum, "menuOpacity", true);
        bind(state.ui.colBg, "themeBg"); bind(state.ui.colTxt, "themeText");
        bind(state.ui.colBorder, "themeBorder"); bind(state.ui.colPrim, "themePrimary");
        [state.ui.sliderH, state.ui.sliderS, state.ui.sliderL].forEach(el => {
            el.oninput = () => {
                state.h = parseFloat(state.ui.sliderH.value);
                state.s = parseFloat(state.ui.sliderS.value);
                state.l = parseFloat(state.ui.sliderL.value);
                syncColor();
            };
        });
        if (state.ui.sliderHNum) state.ui.sliderHNum.oninput = (e) => {
            state.h = Math.min(360, Math.max(0, parseFloat(e.target.value) || 0));
            state.ui.sliderH.value = state.h;
            syncColor();
        };
        if (state.ui.sliderSNum) state.ui.sliderSNum.oninput = (e) => {
            state.s = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
            state.ui.sliderS.value = state.s;
            syncColor();
        };
        if (state.ui.sliderLNum) state.ui.sliderLNum.oninput = (e) => {
            state.l = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
            state.ui.sliderL.value = state.l;
            syncColor();
        };
        const applyRgb = () => {
            const r = Math.min(255, Math.max(0, parseInt(state.ui.inpR.value) || 0));
            const g = Math.min(255, Math.max(0, parseInt(state.ui.inpG.value) || 0));
            const b = Math.min(255, Math.max(0, parseInt(state.ui.inpB.value) || 0));
            const hsl = rgbToHsl(r, g, b);
            state.h = hsl.h; state.s = hsl.s; state.l = hsl.l;
            syncColor();
        };
        if (state.ui.inpR) state.ui.inpR.oninput = applyRgb;
        if (state.ui.inpG) state.ui.inpG.oninput = applyRgb;
        if (state.ui.inpB) state.ui.inpB.oninput = applyRgb;
        state.ui.inpHex.oninput = (e) => {
            if (/^#?[0-9A-F]{6}$/i.test(e.target.value)) {
                const hex = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                const rgb = hexToRgb(hex);
                const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
                state.h = hsl.h; state.s = hsl.s; state.l = hsl.l;
                syncColor();
            }
        };

        // ─── Initialize new features ──
        ThreatDetector.enabled = !!settings.threatDetection;
        OpeningBook.enabled = !!settings.openingBookEnabled;
        if (!settings.showMoveHighlights) { Visuals.removeByType('history'); Visuals.removeByType('analysis'); }
        toggleAutoQueue();
    }
    function drawFenBoard(fen) {
        let rows = fen.split(" ")[0].split("/"), board = [];
        for (let r of rows) {
            let rowArr = [];
            for (let char of r) {
                if (!isNaN(char)) { for (let k = 0; k < parseInt(char); k++) rowArr.push(""); }
                else rowArr.push(char);
            }
            board.push(rowArr);
        }
        let html = '<div class="fen-board">';
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const piece = board[r][c], isDark = (r+c)%2===1;
            const bg = piece ? `style="background-image: url('${PIECE_IMGS[piece]}');"` : "";
            html += `<div class="fen-sq ${isDark ? "dark" : "light"}" ${bg}></div>`;
        }
        return html + "</div>";
    }
    function isElVisible(el) {
        if (!el || typeof el !== "object") return false;
        if (el.offsetParent !== null) return true;
        if (typeof getComputedStyle === "undefined") return true;
        let node = el;
        while (node && node.nodeType === 1) {
            try {
                const cs = getComputedStyle(node);
                if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
            } catch (e) { return false; }
            node = node.parentElement;
        }
        return true;
    }

    function attemptRematch() {
        if (!settings.autoRematch) return;
        if (state._justResetForNewGame) { state._justResetForNewGame = false; return; }
        const resultEl = document.querySelector(".game-result-component, .game-over-modal-content, .daily-game-footer-game-over");
        if (!resultEl || !isElVisible(resultEl)) { state.rematchAttempted = false; if (state.rematchTimeout) { clearTimeout(state.rematchTimeout); state.rematchTimeout = null; } return; }
        if (state.rematchAttempted) return;
        state.rematchAttempted = true;
        const clickAcceptRematch = () => {
            const allBtns = document.querySelectorAll("button");
            for (let b of allBtns) {
                const txt = b.innerText.toLowerCase().trim();
                if (txt.includes("rematch") && txt.includes("accept") && isElVisible(b)) {
                    b.click();
                    return true;
                }
                if (txt === "accept" && isElVisible(b)) {
                    for (let c of b.parentElement.children) {
                        if (c !== b && c.innerText.toLowerCase().includes("rematch")) {
                            b.click();
                            return true;
                        }
                    }
                }
            }
            return false;
        };
        if (!clickAcceptRematch()) {
            state.rematchTimeout = setTimeout(() => {
                state.rematchTimeout = null;
                const stillPresent = document.querySelector(".game-result-component, .game-over-modal-content, .daily-game-footer-game-over");
                if (stillPresent && isElVisible(stillPresent)) clickAcceptRematch();
                else state.rematchAttempted = false;
            }, 500);
        }
    }
    function enforceBounds() {
        if (state.ui.panel) {
            const rect = state.ui.panel.getBoundingClientRect();
            if (rect.right > window.innerWidth) state.ui.panel.style.width = window.innerWidth - rect.left + "px";
            if (rect.bottom > window.innerHeight) state.ui.panel.style.height = window.innerHeight - rect.top + "px";
            if (rect.left < 0) state.ui.panel.style.left = "0px";
            if (rect.top < 0) state.ui.panel.style.top = "0px";
        }
        // Throttled: a rAF every frame forcing layout on the panel rect is pure
        // jank; checking 2x/sec keeps it on-screen with zero cost.
        setTimeout(enforceBounds, 500);
    }
    requestAnimationFrame(enforceBounds);
    function updateUI() {
        if (!state.ui.panel) return;
        document.body.classList.remove("mode-cloud", "mode-local", "mode-sfonline");
        document.body.classList.add(`mode-${settings.engineMode}`);
        if (state.ui.debugArea) state.ui.debugArea.style.display = settings.debugLogs ? "flex" : "none";
        let maxD = 18;
        if (settings.engineMode === "local") maxD = getEngineById(settings.localModelId || "sf18_05").maxDepth;
        else if (settings.engineMode === "sfonline") maxD = 15;
        if (state.ui.lblMaxDepth) state.ui.lblMaxDepth.innerText = maxD;
        if (state.ui.inpDepth) state.ui.inpDepth.max = maxD;
        if (state.ui.inpPVDepth) state.ui.inpPVDepth.max = 45;
        if (state.ui.pvSettings) state.ui.pvSettings.style.display = settings.showPVArrows ? "flex" : "none";
        if (state.ui.pvGradSettings) state.ui.pvGradSettings.style.display = settings.pvCustomGradient ? "flex" : "none";
        if (state.ui.btnAnalyze) state.ui.btnAnalyze.disabled = state.isThinking;
        // Guarded writes: only touch the DOM when the value actually changed
        // (unconditional innerHTML/innerText every 50ms tick forces layout & janks the UI).
        const setHtml = (el, val) => { if (el && el.innerHTML !== val) el.innerHTML = val; };
        setHtml(state.ui.moveResult, state.lastMoveResult);
        setHtml(state.ui.liveOutput, state.lastLiveResult);
        if (state.ui.logSent) state.ui.logSent.innerText = state.lastPayload;
        if (state.ui.logRec) state.ui.logRec.innerText = state.lastResponse;
        if (state.ui.inpDepth && document.activeElement !== state.ui.inpDepth) state.ui.inpDepth.value = settings.depth;
    }
    const START_FEN_PIECES = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

    // Clear any per-position analysis state left over from the previous game so a stale
    // best-move / humanAlternatives / mate can't leak into a brand-new game.
    function resetTransientStateForNewGame() {
        if (state.isThinking) state.pendingAbortEchoes = (state.pendingAbortEchoes || 0) + 1;
        state.isThinking = false;
        if (state.analysisWatchdog) { clearTimeout(state.analysisWatchdog); state.analysisWatchdog = null; }
        state.currentBestMove = null;
        state.currentPV = [];
        state.currentMateNorm = null;
        state.humanAlternatives = [];
        state.multiPVMap = null;
        state.lastMultiPV = null;
        state.localEval = null;
        state.localMate = null;
        state.localPV = null;
        state.localDepth = null;
        state.lastSentFEN = "";
        state.currentSearchFEN = "";
        state.lastMoveResult = "N/A";
        if (state.pendingAnalysis) { clearTimeout(state.pendingAnalysis); state.pendingAnalysis = null; }
        if (state.pendingAutoMoveTimeout) { clearTimeout(state.pendingAutoMoveTimeout); state.pendingAutoMoveTimeout = null; }
        if (state.rematchTimeout) { clearTimeout(state.rematchTimeout); state.rematchTimeout = null; }
        if (state.currentCloudRequest) { try { state.currentCloudRequest.abort(); } catch (_) {} state.currentCloudRequest = null; }
        state.rematchAttempted = false;
        state._justResetForNewGame = true;
        EvalBar.reset();
        updateUI();
    }

    function checkAndAnalyze() {
        state.board = document.querySelector(Platform.getBoardSelectors());
        try { HighlightObserver.ensure(); } catch (e) { console.error(`[SF Engine] HighlightObserver failed:`, e); }
        if (settings.showEvalBar) {
            try {
                EvalBar.create();
                EvalBar.updatePosition();
            } catch (e) { console.error(`[SF Engine] EvalBar create failed:`, e); }
        }

        // Single FEN read shared by new-game detection + the analyze trigger
        const raw = state.board ? getRawBoardFEN() : null;
        const clean = raw ? sanitizeFEN(raw) : "";

        // Detect a brand-new game (board back to the starting position) and clear any
        // transient analysis state left over from the previous game. Gated so it fires
        // once per new game (latches while on the start position, releases on any move).
        if (raw) {
            const pieces = clean.split(" ")[0];
            if (pieces === START_FEN_PIECES) {
                if (!state.inStartPositionReset) { state.inStartPositionReset = true; resetTransientStateForNewGame(); }
            } else {
                state.inStartPositionReset = false;
            }
        }

        if (state.board && settings.autoRun && raw) {
            if (state.lastSeenFEN && clean !== state.lastSeenFEN) {
                state.currentBestMove = null;
                state.currentMateNorm = null;
                state.localEval = null;
                state.localMate = null;
                state.localPV = null;
                state.currentPV = [];
                if (state.pendingAutoMoveTimeout) { clearTimeout(state.pendingAutoMoveTimeout); state.pendingAutoMoveTimeout = null; }
                if (settings.hideAfterMove) {
                try {
                    Visuals.removeByType('history'); Visuals.removeByType('analysis'); PV.clear();
                    // Reset threat highlight and eval bar on new board
                    ThreatDetector.clear();
                    EvalBar._lastPlayingAs = null;
                    EvalBar.reset();
                } catch (e) { console.error(`[SF Engine] overlay cleanup failed:`, e); }
                } else if (settings.showEvalBar) {
                    EvalBar.reset();
                }
            }
            state.lastSeenFEN = clean;
            const tn = Platform.getTurn(state.board);
            const pn = Platform.getPlayingAs(state.board);
            const isTurn = (tn === 1 || tn === "w" || tn === "white") === (pn === 1 || pn === "w" || pn === "white");
            if (isTurn && clean !== state.lastSanitizedBoardFEN) {
                // Lichess needs a deterministic first dispatch; the backup poll
                // must not be the only thing that eventually starts analysis.
                const canPause = !Platform.isLichess() && shouldPauseAnalysis();
                if (!state.pendingAnalysis && !canPause) {
                    // Brief human-glance delay before analyzing (short for cloud-fast)
                    const glanceMs = settings.engineMode === "cloud" ? getRandomInt(150, 600) : getRandomInt(400, 1200);
                    state.pendingAnalysis = setTimeout(() => {
                        state.pendingAnalysis = null;
                        try {
                            analyze(settings.depth);
                        } catch (e) {
                            console.error(`[SF Engine] scheduled analyze failed:`, e);
                            handleError("Analyze failed", e);
                        }
                    }, glanceMs);
                }
            }
        }
        if (!state.ui.panel) createUI();
        if (state.board) {
            try { const pa = Platform.getPlayingAs(state.board); if (pa === 1 || pa === 2) state.playingAs = pa; } catch (e) {}
        }
        updateUI();
    }

    function scheduleBackupPoll() {
        const delay = getRandomInt(CONFIG.BACKUP_POLL_MIN_MS, CONFIG.BACKUP_POLL_MAX_MS);
        setTimeout(() => {
            try { checkAndAnalyze(); }
            catch (e) { console.error(`[SF Engine] backup poll failed:`, e); }
            scheduleBackupPoll();
        }, delay);
    }

    function startGameOverPoll() {
        if (state.gameOverPollTimeout) clearTimeout(state.gameOverPollTimeout);
        state.gameOverPollTimeout = setTimeout(() => {
            try {
                if (settings.autoRematch) attemptRematch();
            } catch (e) { console.error(`[SF Engine] game-over poll failed:`, e); }
            startGameOverPoll();
        }, getRandomInt(2000, 4000));
    }

    // Set up MutationObserver to detect board changes (moves made)
    function setupBoardObserver() {
        const boardEl = document.querySelector(Platform.getBoardSelectors());
        if (!boardEl) {
            setTimeout(setupBoardObserver, 500);
            return;
        }
        state.boardObserver = new MutationObserver((mutations) => {
            // Check if any mutation could indicate a move was made
            for (const m of mutations) {
                if (m.type === 'childList' || m.type === 'attributes') {
                    checkAndAnalyze();
                    break;
                }
            }
        });
        state.boardObserver.observe(boardEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
    // --- GLOBAL KEYBIND LISTENER ---
    document.addEventListener("keydown", (e) => {
        // H key: toggle UI panel visibility (always works)
        if (e.key === "h" || e.key === "H") {
            if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
                e.preventDefault();
                if (state.ui?.panel) {
                    const hidden = state.ui.panel.classList.toggle("bot-hidden");
                    saveSetting("panelHidden", hidden);
                }
                return;
            }
        }
    });
    // --- END GLOBAL KEYBIND LISTENER ---

    // Start event-driven polling instead of fixed 50ms interval
    setupBoardObserver();
    scheduleBackupPoll();
    if (Platform.isLichess()) setInterval(checkAndAnalyze, 500);
    startGameOverPoll();

    // Initial check
    checkAndAnalyze();

    // ALWAYS preload local engine in background for instant deployment when switching modes
    setTimeout(loadLocalEngine, 2000);
})();