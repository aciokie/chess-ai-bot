'use strict';
// Unit tests for lichessUciToFEN() — the pure UCI → FEN engine used by the
// Lichess adapter. The function is extracted verbatim from the userscript and
// evaluated here, so these tests guard the shipped implementation itself.
//
//   node tests/lichess-uci-fen.test.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'chess-ai-bot.user.js'), 'utf8');
const m = src.match(/function lichessUciToFEN\(initialFen, uciMoves\) \{[\s\S]*?\n    \}/);
if (!m) {
    console.error('FAIL  could not extract lichessUciToFEN from chess-ai-bot.user.js');
    process.exit(1);
}
const lichessUciToFEN = eval('(' + m[0] + ')');

let failures = 0;
function check(name, got, want) {
    if (got === want) console.log('  PASS  ' + name);
    else { failures++; console.error('  FAIL  ' + name + '\n        got:  ' + got + '\n        want: ' + want); }
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

check('start position', lichessUciToFEN(null, []),
    START + ' w KQkq - 0 1');
check('1. e4 (double push sets en passant + moves halfmove)', lichessUciToFEN(null, ['e2e4']),
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
check('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O (castling + rook + rights)',
    lichessUciToFEN(null, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1']),
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4');
check('en passant capture removes the passer', lichessUciToFEN(null, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']),
    'rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
check('promotion with a custom initial FEN', lichessUciToFEN('8/P7/8/8/8/8/7p/8 w - - 0 1', ['a7a8q']),
    'Q7/8/8/8/8/8/7p/8 b - - 0 1');
check('rook moves drop their castling rights', lichessUciToFEN(null, ['h2h4', 'h7h5', 'h1h3', 'h8h6']),
    'rnbqkbn1/ppppppp1/7r/7p/7P/7R/PPPPPPP1/RNBQKBN1 w Qq - 2 3');
check('black side to move handled (e4 e5, black to move)', lichessUciToFEN(null, ['e2e4', 'e7e5']),
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2');

console.log('\n' + (failures ? failures + ' lichess UCI→FEN check(s) FAILED' : 'All lichess UCI→FEN checks passed'));
process.exit(failures ? 1 : 0);
