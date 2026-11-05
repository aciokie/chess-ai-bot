// Runs in the ISOLATED world at document_start.
//
// The bot itself runs in the MAIN world (that is the only world where
// chess.com's `wc-chess-board.game` object is visible — custom-element state
// is not shared with isolated content-script worlds). chrome.runtime is NOT
// available in the MAIN world, so this tiny companion publishes the extension
// base URL as a DOM attribute; DOM attributes ARE shared across worlds, which
// lets the bot's extURL() resolve engines/<...> synchronously.
(function () {
    'use strict';
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            document.documentElement.setAttribute('data-sf-ext-base', chrome.runtime.getURL(''));
        }
    } catch (e) { }
})();
