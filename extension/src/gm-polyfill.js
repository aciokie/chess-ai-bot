// GM_* API shims for the Chess AI Bot browser extension (content-script context).
//
// Values persist synchronously in localStorage under "cabe_ext_" keys — the
// userscript calls GM_getValue synchronously, so localStorage is the right fit.
// The network shim is fetch-based; bundled engines never need the network, so
// fetch is only used by the optional CDN fallbacks and the install ping.
(function () {
    'use strict';
    var PREFIX = 'cabe_ext_';

    if (typeof window.GM_getValue === 'undefined') {
        window.GM_getValue = function (key, defaultValue) {
            try {
                var raw = localStorage.getItem(PREFIX + key);
                if (raw === null) return defaultValue;
                return JSON.parse(raw);
            } catch (e) { return defaultValue; }
        };
    }
    if (typeof window.GM_setValue === 'undefined') {
        window.GM_setValue = function (key, value) {
            try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
            catch (e) { console.error('[GM polyfill] setValue failed for', key, e); }
        };
    }
    if (typeof window.GM_deleteValue === 'undefined') {
        window.GM_deleteValue = function (key) {
            try { localStorage.removeItem(PREFIX + key); } catch (e) {}
        };
    }

    if (typeof window.GM_xmlhttpRequest === 'undefined') {
        window.GM_xmlhttpRequest = function (options) {
            var controller = new AbortController();
            var aborted = false;
            var timedOut = false;
            var timer = options.timeout ? setTimeout(function () {
                timedOut = true;
                try { controller.abort(); } catch (e) {}
            }, options.timeout) : null;

            var init = {
                method: options.method || 'GET',
                headers: Object.assign({}, options.headers || {}),
                signal: controller.signal,
            };
            if (options.data !== undefined && options.data !== null && init.method !== 'GET') {
                init.body = options.data;
            }

            fetch(options.url, init)
                .then(function (res) {
                    if (aborted) return Promise.reject(new Error('aborted'));
                    var bodyPromise = (options.responseType === 'arraybuffer') ? res.arrayBuffer() : res.text();
                    return bodyPromise.then(function (body) {
                        if (timer) clearTimeout(timer);
                        var responseHeaders = '';
                        try { res.headers.forEach(function (v, k) { responseHeaders += k + ': ' + v + '\r\n'; }); } catch (e) {}
                        if (options.onload) options.onload({
                            status: res.status,
                            statusText: res.statusText,
                            response: body,
                            responseText: (typeof body === 'string') ? body : '',
                            responseHeaders: responseHeaders,
                            finalUrl: res.url,
                        });
                    });
                })
                .catch(function (err) {
                    if (timer) clearTimeout(timer);
                    if (aborted) return;
                    if (timedOut && options.ontimeout) options.ontimeout();
                    else if (options.onerror) options.onerror(err);
                });

            return {
                abort: function () {
                    aborted = true;
                    try { controller.abort(); } catch (e) {}
                }
            };
        };
    }

    if (typeof window.GM_getResourceText === 'undefined') {
        // The userscript's @resource (Tampermonkey-bundled engine JS) does not
        // exist in an extension; return empty text so the loader uses the
        // bundled engine files (or the CDN chain) instead.
        window.GM_getResourceText = function () { return ''; };
    }

    if (typeof window.GM_info === 'undefined') {
        var version = '11.7.8';
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                version = chrome.runtime.getManifest().version;
            }
        } catch (e) {}
        window.GM_info = {
            script: { name: 'Chess AI Bot', version: version, author: 'Ech0' },
            scriptHandler: 'Browser Extension',
        };
    }

    if (typeof window.GM_openInTab === 'undefined') {
        window.GM_openInTab = function (url) { window.open(url, '_blank'); };
    }
})();
