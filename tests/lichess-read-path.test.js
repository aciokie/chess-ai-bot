'use strict';
// Lichess read-path regression tests (v11.9.2) — guard the bugs that made
// LIVE games (12-char GameFullId URLs) impossible to drive while vs-computer
// games (8-char URLs) worked fine:
//
//   1. lichess routes a player's game page through the 12-char FullId, but
//      /game/export/ only matches \w{8} — the export request must ALWAYS
//      carry the first 8 chars of the page id.
//   2. player round sockets live at /play/{gameId}{playerId}/v6 — there is
//      no "/socket" suffix (the old matcher only ever hit the fallback).
//   3. a failed export must bootstrap from the board DOM instead of leaving
//      the adapter (status/fen/color) empty forever.
//
//   node tests/lichess-read-path.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractBalanced } = require('./lib/extract');

const src = fs.readFileSync(path.join(__dirname, '..', 'chess-ai-bot.user.js'), 'utf8');

let failures = 0;
function check(name, got, want) {
    if (got === want) console.log('  PASS  ' + name);
    else { failures++; console.error('  FAIL  ' + name + '\n        got:  ' + JSON.stringify(got) + '\n        want: ' + JSON.stringify(want)); }
}

// ── Evaluate the real Lichess object literal in a sandbox ─────────────────
const anchor = src.indexOf('const Lichess = {');
if (anchor === -1) { console.error('FAIL  could not find the Lichess object'); process.exit(1); }
const brace = src.indexOf('{', anchor);
const sandbox = {
    location: { pathname: '/' },
    document: { querySelector: () => null },
    console: console,
    checkAndAnalyze: () => { sandbox.__analyzed = true; },
};
let Lichess;
try {
    Lichess = vm.runInNewContext('(' + extractBalanced(src, brace) + ')', sandbox);
} catch (e) {
    console.error('FAIL  could not evaluate the Lichess object:', e.message);
    process.exit(1);
}

// ── gameIdFromUrl(): every page-URL form, 8- and 12-char ids ──────────────
const urlCases = [
    ['/game/r97K4Zr3I6i0', 'r97K4Zr3I6i0', 'live game page (12-char FullId)'],
    ['/game/r97K4Zr3I6i0/white', 'r97K4Zr3I6i0', 'live game page with color segment'],
    ['/game/r97K4Zr3I6i0/black', 'r97K4Zr3I6i0', 'live game page, black orientation'],
    ['/game/kH1p9xPN', 'kH1p9xPN', 'legacy 8-char game page'],
    ['/game/kH1p9xPN/white', 'kH1p9xPN', 'legacy 8-char (vs-computer) with color segment'],
    ['/W7RWWLKAYslD', 'W7RWWLKAYslD', '12-char root URL'],
    ['/kH1p9xPN', 'kH1p9xPN', '8-char root URL'],
    ['/game/r97K4Zr3I6i0/analysis', null, 'analysis sub-page is not a game'],
    ['/analysis', null, 'lichess analysis page (8-char route word, manipulable board)'],
    ['/training', null, 'puzzle page (8-char route word, manipulable board)'],
    ['/practice', null, 'practice page (8-char route word, manipulable board)'],
    ['/tournament', null, 'tournament listing (10-char route word)'],
];
for (const [pathname, want, label] of urlCases) {
    sandbox.location.pathname = pathname;
    check('gameIdFromUrl: ' + label, Lichess.gameIdFromUrl(), want);
}

// ── export must use the 8-char id, never the raw page id ──────────────────
check('export request truncates to the 8-char game id',
    /const exportId = id\.slice\(0, 8\);/.test(src) &&
    /PAGE\.fetch\(`\/game\/export\/\$\{exportId\}\?moves=true`/.test(src), true);
check('export request never sends the raw page id',
    /PAGE\.fetch\(`\/game\/export\/\$\{id\}/.test(src), false);

// ── failed export must bootstrap from the DOM, never wedge ────────────────
check('async poll failure bootstraps from the DOM',
    /this\._bootstrapFromDOM\(\);\s*\n\s*finish\(3000\);/.test(src), true);
check('synchronous fetch throw also bootstraps',
    src.includes('} catch (e) { this._bootstrapFromDOM(); finish(3000); }'), true);

// ── _bootstrapFromDOM(): behavioural test on a mocked chessground board ───
// Board state: after 1.e4 (white pawn e2→e4, last-move squares e2 + e4).
const SQ = 10; // 80px board / 8
const BACK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
function mkPiece(cls, file, rank) {
    return {
        className: cls,
        getAttribute: (name) => (name === 'style' ? 'transform: translate(' + (file * SQ) + 'px, ' + ((8 - rank) * SQ) + 'px);' : null),
    };
}
const pieces = [];
for (let f = 0; f < 8; f++) {
    pieces.push(mkPiece('white ' + BACK[f], f, 1));
    if (f !== 4) pieces.push(mkPiece('white pawn', f, 2));
    pieces.push(mkPiece('black ' + BACK[f], f, 8));
    pieces.push(mkPiece('black pawn', f, 7));
}
pieces.push(mkPiece('white pawn', 4, 4));
const lastMoves = [mkPiece('square last-move', 4, 2), mkPiece('square last-move', 4, 4)];
function mockDoc(manipulable) {
    const board = {
        querySelectorAll: (sel) => (sel === 'piece' ? pieces : (sel === 'square.last-move' ? lastMoves : [])),
        getBoundingClientRect: () => ({ width: 8 * SQ }),
    };
    const wrap = { className: 'cg-wrap orientation-white' + (manipulable ? ' manipulable' : '') };
    return {
        querySelector: (sel) => {
            if (sel === '.cg-wrap.manipulable') return manipulable ? wrap : null;
            if (sel === '.cg-wrap') return wrap;
            if (sel === 'cg-board') return board;
            return null;
        },
    };
}

sandbox.document = mockDoc(true);
sandbox.__analyzed = false;
const built = Lichess._bootstrapFromDOM();
check('bootstrap builds the FEN from the DOM', Lichess._fen,
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
check('bootstrap marks the game started', Lichess._status, 'started');
check('bootstrap resolves our color from board orientation', Lichess._myColor, 'white');
check('bootstrap kicks analysis', sandbox.__analyzed, true);
check('bootstrap reports success', built, true);

// Spectators (no manipulable board) must never be driven.
Lichess._fen = null; Lichess._status = 'loading'; Lichess._myColor = null;
sandbox.__analyzed = false;
sandbox.document = mockDoc(false);
check('spectator bootstrap is a no-op', Lichess._bootstrapFromDOM(), false);
check('spectator keeps status untouched', Lichess._status, 'loading');
check('spectator keeps FEN empty', Lichess._fen, null);
check('spectator never kicks analysis', sandbox.__analyzed, false);

// ── sendMove(): match /play/{gameId}{playerId}/v6 by id, 8- or 12-char ───
function mkSock(url) { return { url, readyState: 1, sent: null, send(d) { this.sent = d; } }; }
function resetSend(id, socks) {
    Lichess._gameId = id; Lichess._socks = socks;
    Lichess._sentUci = ''; Lichess._sentAt = 0; Lichess._ack = 90000;
}

const s12 = mkSock('wss://socket.lichess.org/play/r97K4Zr3I6i0/v6');
resetSend('r97K4Zr3I6i0', [s12]);
check('sendMove finds the live-game socket (full 12-char id)', Lichess.sendMove('e2e4'), true);
check('sendMove payload is the exact site frame', s12.sent, JSON.stringify({ t: 'move', d: { u: 'e2e4', a: 90001 } }));

const s8 = mkSock('wss://socket.lichess.org/play/kH1p9xPNab12/v6');
resetSend('kH1p9xPN', [s8]);
check('sendMove matches an 8-char page id (vs-computer games)', Lichess.sendMove('d2d4'), true);

resetSend('r97K4Zr3I6i0', []);
check('sendMove reports failure when no socket is captured', Lichess.sendMove('e2e4'), false);
check('no legacy "/socket" suffix matcher remains', /\+ "\/socket"/.test(src), false);

console.log('\n' + (failures ? failures + ' lichess read-path check(s) FAILED' : 'All lichess read-path checks passed'));
process.exit(failures ? 1 : 0);
