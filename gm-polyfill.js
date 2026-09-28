// GM_* API Polyfill for Chrome / Edge / Brave Extension Context
(function() {
    'use strict';

    if (typeof window.GM_getValue === 'undefined') {
        window.GM_getValue = function(key, defaultValue) {
            try {
                const item = localStorage.getItem('gm_ext_' + key);
                if (item === null) return defaultValue;
                return JSON.parse(item);
            } catch (e) {
                return defaultValue;
            }
        };
    }

    if (typeof window.GM_setValue === 'undefined') {
        window.GM_setValue = function(key, value) {
            try {
                localStorage.setItem('gm_ext_' + key, JSON.stringify(value));
            } catch (e) {
                console.error('[GM Polyfill] Error setting key', key, e);
            }
        };
    }

    if (typeof window.GM_deleteValue === 'undefined') {
        window.GM_deleteValue = function(key) {
            try {
                localStorage.removeItem('gm_ext_' + key);
            } catch (e) {}
        };
    }

    if (typeof window.GM_xmlhttpRequest === 'undefined') {
        window.GM_xmlhttpRequest = function(options) {
            const url = options.url;
            const method = options.method || 'GET';
            const headers = options.headers || {};
            const body = options.data || null;

            const fetchOptions = {
                method: method,
                headers: headers
            };
            if (body && (method === 'POST' || method === 'PUT')) {
                fetchOptions.body = body;
            }

            let aborted = false;
            const controller = new AbortController();
            fetchOptions.signal = controller.signal;

            fetch(url, fetchOptions)
                .then(async (res) => {
                    if (aborted) return;
                    let responseData;
                    if (options.responseType === 'arraybuffer') {
                        responseData = await res.arrayBuffer();
                    } else {
                        responseData = await res.text();
                    }
                    if (options.onload) {
                        options.onload({
                            status: res.status,
                            statusText: res.statusText,
                            response: responseData,
                            responseText: typeof responseData === 'string' ? responseData : ''
                        });
                    }
                })
                .catch((err) => {
                    if (aborted) return;
                    if (options.onerror) options.onerror(err);
                });

            return {
                abort: function() {
                    aborted = true;
                    controller.abort();
                }
            };
        };
    }

    if (typeof window.GM_getResourceText === 'undefined') {
        window.GM_getResourceText = function(name) {
            return '';
        };
    }

    if (typeof window.GM_info === 'undefined') {
        window.GM_info = {
            script: {
                name: 'Chess AI Bot',
                version: '11.7.0',
                author: 'Ech0'
            },
            scriptHandler: 'Browser Extension'
        };
    }

    if (typeof window.GM_openInTab === 'undefined') {
        window.GM_openInTab = function(url) {
            window.open(url, '_blank');
        };
    }
})();
