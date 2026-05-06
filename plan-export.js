/**
 * PlanBackup – резервно копие на плана чрез имейл.
 *
 * Употреба:
 *   await PlanBackup.exportToEmail()           – отваря имейл с кода
 *   const ok = await PlanBackup.importFromCode(codeStr) – възстановява от код
 */
const PlanBackup = (function () {
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

    function _encode(data) {
        const payload = JSON.stringify({ version: 1, timestamp: Date.now(), data: data });
        // Use TextEncoder for proper UTF-8 handling of Cyrillic and other non-ASCII chars
        const bytes = new TextEncoder().encode(payload);
        let binary = '';
        bytes.forEach(function (b) { binary += String.fromCharCode(b); });
        return btoa(binary);
    }

    function _decode(code) {
        try {
            const binary = atob(code.trim());
            const bytes = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
            const json = new TextDecoder().decode(bytes);
            return JSON.parse(json);
        } catch (_) {
            return null;
        }
    }

    /**
     * Събира данните от localStorage, кодира ги и отваря mailto: линк,
     * за да може потребителят да изпрати резервното копие на себе си.
     */
    function exportToEmail() {
        const data = _collectData();
        if (!Object.keys(data).length) {
            alert('Няма запазен план за резервно копие.');
            return;
        }
        const code = _encode(data);
        const subject = encodeURIComponent('NutriPlan – резервно копие на плана');
        const body = encodeURIComponent(
            'Запазете това съобщение.\n' +
            'При преинсталиране на NutriPlan отидете в Профил → Резервно копие\n' +
            'и поставете кода по-долу в полето "Възстанови от код".\n\n' +
            '--- НАЧАЛО НА КОДА ---\n' +
            code + '\n' +
            '--- КРАЙ НА КОДА ---'
        );
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
    }

    /**
     * Декодира кода от имейл и записва всички ключове обратно в localStorage.
     * Ако NativeBackup е наличен, синхронизира и Capacitor Preferences.
     *
     * @returns {Promise<boolean>} true при успех
     */
    async function importFromCode(code) {
        if (!code || !code.trim()) {
            alert('Моля, поставете кода от резервното копие.');
            return false;
        }
        const payload = _decode(code);
        if (!payload || !payload.data || typeof payload.data !== 'object') {
            alert('Невалиден код. Уверете се, че сте копирали целия код между маркерите.');
            return false;
        }
        const data = payload.data;
        const keys = Object.keys(data);
        if (!keys.length) {
            alert('Кодът не съдържа данни.');
            return false;
        }
        keys.forEach(function (key) {
            localStorage.setItem(key, data[key]);
        });
        // Sync restored data into Capacitor Preferences (SharedPreferences) when in APK
        if (typeof NativeBackup !== 'undefined') {
            await NativeBackup.init();
        }
        return true;
    }

    return { exportToEmail: exportToEmail, importFromCode: importFromCode };
})();
