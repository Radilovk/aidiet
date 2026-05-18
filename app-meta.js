(function () {
    const RELEASE_CACHE_KEY = 'aidietLatestReleaseMeta';
    const RELEASE_CACHE_TTL_MS = 15 * 60 * 1000;
    const RELEASE_API_URL = 'https://api.github.com/repos/Radilovk/aidiet/releases/latest';

    let manifestPromise = null;
    let latestReleasePromise = null;

    function parseVersionLabel(source) {
        if (!source) return '';
        const match = String(source).match(/v?\d+(?:\.\d+)+/i);
        return match ? match[0] : '';
    }

    function setTextContent(targetId, text) {
        if (!targetId) return;
        const element = document.getElementById(targetId);
        if (element) element.textContent = text;
    }

    async function fetchJson(url, init) {
        const response = await fetch(url, init);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    function readCachedLatestRelease() {
        try {
            const raw = localStorage.getItem(RELEASE_CACHE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (!cached || !cached.cachedAt || !cached.data) return null;
            if ((Date.now() - cached.cachedAt) > RELEASE_CACHE_TTL_MS) return null;
            return cached.data;
        } catch (_) {
            return null;
        }
    }

    function writeCachedLatestRelease(data) {
        try {
            localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({
                cachedAt: Date.now(),
                data
            }));
        } catch (_) {}
    }

    async function getManifestInfo() {
        if (!manifestPromise) {
            manifestPromise = fetchJson('./twa-manifest.json', { cache: 'no-store' })
                .then((manifest) => ({
                    versionName: manifest.appVersion || manifest.version || '',
                    versionCode: manifest.versionCode || manifest.buildNumber || ''
                }))
                .catch(() => null);
        }
        return await manifestPromise;
    }

    async function getLatestReleaseInfo() {
        if (!latestReleasePromise) {
            latestReleasePromise = (async function () {
                const cached = readCachedLatestRelease();
                if (cached) return cached;

                const release = await fetchJson(RELEASE_API_URL, {
                    headers: {
                        'Accept': 'application/vnd.github+json'
                    },
                    cache: 'no-store'
                });
                const apkAsset = Array.isArray(release.assets)
                    ? release.assets.find((asset) => /\.apk$/i.test(asset.name || ''))
                    : null;

                const info = {
                    assetName: apkAsset?.name || 'NutriPlan.apk',
                    downloadUrl: apkAsset?.browser_download_url || release.html_url || 'https://github.com/Radilovk/aidiet/releases/latest',
                    versionLabel: parseVersionLabel(apkAsset?.name) || parseVersionLabel(release.name) || parseVersionLabel(release.tag_name),
                    publishedAt: release.published_at || release.created_at || ''
                };
                writeCachedLatestRelease(info);
                return info;
            })().catch(() => null);
        }
        return await latestReleasePromise;
    }

    function applyCurrentBuildVersion(manifestInfo) {
        if (!manifestInfo || !manifestInfo.versionName) return;
        const text = `Версия ${manifestInfo.versionName}${manifestInfo.versionCode ? ` • build ${manifestInfo.versionCode}` : ''}`;
        document.querySelectorAll('[data-app-version]').forEach((element) => {
            element.textContent = text;
        });
    }

    function applyLatestApkInfo(latestRelease) {
        if (!latestRelease || !latestRelease.downloadUrl) return;
        document.querySelectorAll('[data-apk-download]').forEach((button) => {
            button.href = latestRelease.downloadUrl;
            button.setAttribute('download', latestRelease.assetName);

            const label = button.querySelector('[data-apk-button-label]');
            if (label && latestRelease.versionLabel) {
                label.textContent = `Свали APK (${latestRelease.versionLabel})`;
            }

            const versionTargetId = button.getAttribute('data-apk-version-target');
            if (versionTargetId) {
                const latestText = latestRelease.versionLabel
                    ? `Последен APK: ${latestRelease.versionLabel}`
                    : `Последен APK: ${latestRelease.assetName}`;
                setTextContent(versionTargetId, latestText);
            }
        });
    }

    async function initAppMeta() {
        const [manifestInfo, latestRelease] = await Promise.all([
            getManifestInfo(),
            getLatestReleaseInfo()
        ]);
        applyCurrentBuildVersion(manifestInfo);
        applyLatestApkInfo(latestRelease);
    }

    window.AidietAppMeta = {
        getManifestInfo,
        getLatestReleaseInfo,
        initAppMeta
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAppMeta, { once: true });
    } else {
        initAppMeta();
    }
})();
