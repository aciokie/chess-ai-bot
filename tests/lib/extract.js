'use strict';
// Shared helpers for the standalone engine-reliability test suite.
// Zero npm dependencies — plain Node built-ins only.
//
// The userscript is a single IIFE with everything scoped inside, so tests pull
// the specific functions/data they need out of the source text and evaluate
// them in a vm sandbox with mocks.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const USERSCRIPT = path.join(__dirname, '..', '..', 'chess-ai-bot.user.js');

function readUserscript() {
    return fs.readFileSync(USERSCRIPT, 'utf8');
}

// Advance past a quoted string starting at text[i] (i points at the quote).
function skipString(text, i) {
    const quote = text[i];
    i++;
    while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) return i + 1;
        i++;
    }
    return i;
}

// Extract the balanced region starting at text[openIndex] ('[' / '{' / '(').
// Skips strings, template literals and comments so brackets inside them do not
// confuse the depth counter.
function extractBalanced(text, openIndex) {
    const closers = { '[': ']', '{': '}', '(': ')' };
    const stack = [closers[text[openIndex]]];
    if (!stack[0]) throw new Error('not an opening bracket at ' + openIndex);
    let i = openIndex + 1;
    while (i < text.length && stack.length) {
        const c = text[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
        if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl + 1; continue; }
        if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i); i = end === -1 ? text.length : end + 2; continue; }
        if (closers[c]) { stack.push(closers[c]); i++; continue; }
        if (c === stack[stack.length - 1]) { stack.pop(); i++; continue; }
        i++;
    }
    if (stack.length) throw new Error('unbalanced brackets starting at ' + openIndex);
    return text.slice(openIndex, i);
}

// Extract the full source of a `function name(...) { ... }` declaration.
// Locates the body brace AFTER the parameter list's closing paren, so default
// values like `opts = {}` cannot be mistaken for the function body.
function extractFunction(src, name) {
    const m = src.match(new RegExp('(^|[^\\w$])function\\s+' + name + '\\s*\\('));
    if (!m) throw new Error('function ' + name + ' not found in userscript');
    const start = m.index + m[1].length;
    const paren = src.indexOf('(', start);
    let depth = 0, i = paren;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(src, i) - 1; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
    }
    const brace = src.indexOf('{', i);
    if (brace === -1) throw new Error('no body for ' + name);
    return src.slice(start, brace) + extractBalanced(src, brace);
}

// Extract the literal text of `const NAME = [ ... ];`.
function extractConstArray(src, name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*'));
    if (!m) throw new Error('const ' + name + ' not found');
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '[') throw new Error(name + ' is not an array literal');
    return extractBalanced(src, i);
}

// Parse LOCAL_ENGINES out of a script. The extension build's registry contains
// extURL(...) calls, so a sandbox with an extURL stub can be supplied.
function parseRegistry(src, sandbox) {
    const text = extractConstArray(src || readUserscript(), 'LOCAL_ENGINES');
    const context = Object.assign({ extURL: (p) => 'EXT:' + p }, sandbox || {});
    return vm.runInNewContext('(' + text + ')', context);
}

module.exports = { USERSCRIPT, readUserscript, extractBalanced, extractFunction, extractConstArray, parseRegistry };
