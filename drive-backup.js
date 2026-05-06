/**
 * DriveBackup – backs up and restores the NutriPlan diet plan using
 * Google Drive appDataFolder (hidden, app-specific folder visible only
 * to this app). No backend required – all calls are made directly from
 * the WebView using the OAuth access token obtained via GoogleAuth.
 *
 * Prerequisites (one-time Google Cloud Console setup):
 *  1. Create an OAuth 2.0 **Web Application** credential → copy the Client ID.
 *  2. Create an OAuth 2.0 **Android** credential → package name +
 *     SHA-1 fingerprint of your signing keystore.
 *  3. Set the GOOGLE_WEB_CLIENT_ID GitHub Actions secret to the Web Client ID.
 *     The CI build will write it into strings.xml for the Android plugin.
 *
 * Plugin required: @codetrix-studio/capacitor-google-auth
 *   npm install @codetrix-studio/capacitor-google-auth
 *
 * Works only inside a native Capacitor APK (isNativePlatform() === true).
 *
 * Usage:
 *   const result = await DriveBackup.syncPlan();    // { success, error? }
 *   const result = await DriveBackup.restorePlan(); // { success, error? }
 */
const DriveBackup = (function () {
    const BACKUP_FILENAME = 'nutriplan_backup.json';
    const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
    const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

    // Keys mirrored from native-backup.js / plan-export.js
    const PLAN_KEYS = [
        'dietPlan',
        'userId',
        'userData',
        'planHistory',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'afterDinnerMealJustification',
        'planSource',
        'hasSeenPlanJustification',
        'gameNotifierConfig',
    ];
    const ADDED_MEALS_PREFIX = 'addedMeals_';

    function _isNative() {
        return !!(
            typeof window !== 'undefined' &&
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
        );
    }

    function _getPlugin() {
        if (!_isNative()) return null;
        try {
            return (window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) || null;
        } catch (_) { return null; }
    }

    function _collectData() {
        const data = {};
        PLAN_KEYS.forEach(function (key) {
            const val = localStorage.getItem(key);
            if (val !== null) data[key] = val;
        });
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(ADDED_MEALS_PREFIX)) {
                data[key] = localStorage.getItem(key);
            }
        }
        return data;
    }

    function _applyData(data) {
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach(function (key) {
            localStorage.setItem(key, data[key]);
        });
    }

    /**
     * Obtain a Google OAuth access token.
     * Tries a silent refresh first; falls back to the interactive sign-in flow.
     *
     * @returns {Promise<string|null>}
     */
    async function _getAccessToken() {
        const plugin = _getPlugin();
        if (!plugin) return null;

        // Silent refresh – works if the user signed in during a previous session
        if (typeof plugin.refresh === 'function') {
            try {
                const refreshed = await plugin.refresh();
                if (refreshed && refreshed.accessToken) return refreshed.accessToken;
            } catch (_) {}
        }

        // Interactive sign-in flow (may show account-picker UI once)
        try {
            const user = await plugin.signIn();
            return (user && user.authentication && user.authentication.accessToken) || null;
        } catch (err) {
            console.warn('[DriveBackup] Google Sign-In failed:', err);
            return null;
        }
    }

    /**
     * Find the backup file in appDataFolder by name.
     *
     * @param {string} token  OAuth access token
     * @returns {Promise<string|null>}  Drive file ID, or null if not found
     */
    async function _findFile(token) {
        const q = encodeURIComponent("name='" + BACKUP_FILENAME + "'");
        const url = DRIVE_FILES_URL + '?spaces=appDataFolder&fields=files(id)&q=' + q;
        try {
            const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
            if (!resp.ok) return null;
            const json = await resp.json();
            return (json.files && json.files.length > 0) ? json.files[0].id : null;
        } catch (_) { return null; }
    }

    /**
     * Upload plan data to Google Drive appDataFolder using the multipart upload API.
     * Creates a new file when existingId is null; patches the existing file otherwise.
     *
     * @param {string}      token       OAuth access token
     * @param {object}      data        Plan data (key → value string map)
     * @param {string|null} existingId  File ID to update, or null to create
     * @returns {Promise<boolean>}
     */
    async function _uploadFile(token, data, existingId) {
        const content = JSON.stringify({ version: 1, timestamp: Date.now(), data: data });
        const boundary = 'nutriplan_boundary_' + Date.now();

        // Metadata part – omit "parents" when updating an existing file
        const metadataObj = { name: BACKUP_FILENAME, mimeType: 'application/json' };
        if (!existingId) metadataObj.parents = ['appDataFolder'];
        const metadata = JSON.stringify(metadataObj);

        const body = (
            '--' + boundary + '\r\n' +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            metadata + '\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Type: application/json\r\n\r\n' +
            content + '\r\n' +
            '--' + boundary + '--'
        );

        const method = existingId ? 'PATCH' : 'POST';
        const url = existingId
            ? DRIVE_UPLOAD_URL + '/' + existingId + '?uploadType=multipart'
            : DRIVE_UPLOAD_URL + '?uploadType=multipart&spaces=appDataFolder';

        try {
            const resp = await fetch(url, {
                method: method,
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'multipart/related; boundary=' + boundary,
                },
                body: body,
            });
            return resp.ok;
        } catch (_) { return false; }
    }

    /**
     * Download backup file contents from Google Drive.
     *
     * @param {string} token   OAuth access token
     * @param {string} fileId  Drive file ID
     * @returns {Promise<object|null>}
     */
    async function _downloadFile(token, fileId) {
        try {
            const resp = await fetch(
                DRIVE_FILES_URL + '/' + fileId + '?alt=media',
                { headers: { Authorization: 'Bearer ' + token } }
            );
            if (!resp.ok) return null;
            return await resp.json();
        } catch (_) { return null; }
    }

    /**
     * Upload the current localStorage plan to Google Drive appDataFolder.
     * Creates or overwrites the backup file.
     *
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function syncPlan() {
        if (!_isNative()) return { success: false, error: 'not_native' };

        const data = _collectData();
        if (!Object.keys(data).length) return { success: false, error: 'no_data' };

        const token = await _getAccessToken();
        if (!token) return { success: false, error: 'auth_failed' };

        try {
            const existingId = await _findFile(token);
            const ok = await _uploadFile(token, data, existingId);
            return { success: ok, error: ok ? undefined : 'upload_failed' };
        } catch (err) {
            console.error('[DriveBackup] syncPlan error:', err);
            return { success: false, error: String(err) };
        }
    }

    /**
     * Check Google Drive for an existing backup and restore it into localStorage.
     * Also syncs data into Capacitor Preferences via NativeBackup (if available),
     * so the plan survives future reinstalls too.
     *
     * Intended to be called on first launch when no local plan is found.
     *
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function restorePlan() {
        if (!_isNative()) return { success: false, error: 'not_native' };

        const token = await _getAccessToken();
        if (!token) return { success: false, error: 'auth_failed' };

        try {
            const fileId = await _findFile(token);
            if (!fileId) return { success: false, error: 'no_backup' };

            const payload = await _downloadFile(token, fileId);
            if (!payload || !payload.data) return { success: false, error: 'invalid_data' };

            _applyData(payload.data);

            // Mirror restored data into Capacitor Preferences (SharedPreferences)
            if (typeof NativeBackup !== 'undefined') {
                await NativeBackup.init();
            }

            return { success: true };
        } catch (err) {
            console.error('[DriveBackup] restorePlan error:', err);
            return { success: false, error: String(err) };
        }
    }

    return { syncPlan: syncPlan, restorePlan: restorePlan };
})();
