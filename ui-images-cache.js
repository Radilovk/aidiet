(function () {
    const CACHE_KEY = 'uiImages:globalCache:v1';
    const LEGACY_KEY = 'uiImages:cache';
    const CACHE_TTL = 30 * 60 * 1000;
    let pendingRequest = null;

    function readStorage(storage, key) {
        try {
            const raw = storage && storage.getItem(key);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (cached && cached.data && Date.now() < cached.expiry) return cached.data;
        } catch (_) {}
        return null;
    }

    function writeStorage(storage, key, data) {
        try {
            if (storage) {
                storage.setItem(key, JSON.stringify({ data, expiry: Date.now() + CACHE_TTL }));
            }
        } catch (_) {}
    }

    function readCached() {
        return readStorage(window.localStorage, CACHE_KEY)
            || readStorage(window.sessionStorage, CACHE_KEY)
            || readStorage(window.sessionStorage, LEGACY_KEY);
    }

    window.getCachedUIImages = function getCachedUIImages(workerUrl) {
        const cached = readCached();
        if (cached) return Promise.resolve(cached);

        if (pendingRequest) return pendingRequest;

        pendingRequest = fetch(workerUrl + '/api/ui-images')
            .then(function (response) {
                if (!response.ok) throw new Error('UI images request failed: ' + response.status);
                return response.json();
            })
            .then(function (data) {
                writeStorage(window.localStorage, CACHE_KEY, data);
                writeStorage(window.sessionStorage, CACHE_KEY, data);
                return data;
            })
            .catch(function (error) {
                const stale = readStorage(window.localStorage, CACHE_KEY) || readStorage(window.sessionStorage, CACHE_KEY);
                if (stale) return stale;
                throw error;
            })
            .finally(function () {
                pendingRequest = null;
            });

        return pendingRequest;
    };
})();
