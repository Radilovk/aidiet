/**
 * NutriPlan — cross-device notification & PWA compatibility (APK + PWA + Web).
 * Loaded after platform.js; exposes NutriPlanCompat.
 */
(function (global) {
    'use strict';

    var NP = global.NutriPlanPlatform || {};

    function ua() {
        return (global.navigator && global.navigator.userAgent) || '';
    }

    function getAndroidOem() {
        var s = ua().toLowerCase();
        if (/huawei|honor|harmony/i.test(s)) return 'huawei';
        if (/xiaomi|redmi|poco|miui/i.test(s)) return 'xiaomi';
        if (/samsung|sm-/i.test(s)) return 'samsung';
        if (/oppo|realme|coloros/i.test(s)) return 'oppo';
        if (/vivo|iqoo|funtouch/i.test(s)) return 'vivo';
        if (/oneplus|oxygen/i.test(s)) return 'oneplus';
        if (/motorola|moto/i.test(s)) return 'motorola';
        if (/google pixel|pixel/i.test(s)) return 'google';
        if (/nokia/i.test(s)) return 'nokia';
        if (/sony|xperia/i.test(s)) return 'sony';
        if (/lg-|lge/i.test(s)) return 'lg';
        if (/htc/i.test(s)) return 'htc';
        if (/android/i.test(s)) return 'android';
        return '';
    }

    function getBrowserFamily() {
        var s = ua();
        if (/SamsungBrowser/i.test(s)) return 'samsung';
        if (/EdgA|EdgiOS|Edg\//i.test(s)) return 'edge';
        if (/OPR\/|Opera/i.test(s)) return 'opera';
        if (/Brave/i.test(s)) return 'brave';
        if (/Firefox|FxiOS/i.test(s)) return 'firefox';
        if (/CriOS/i.test(s)) return 'chrome-ios';
        if (/Chrome/i.test(s) && !/Edg/i.test(s)) return 'chrome';
        if (/Safari/i.test(s) && !/Chrome/i.test(s)) return 'safari';
        return 'unknown';
    }

    function isInAppBrowser() {
        return /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|Snapchat|TikTok|wv\)/i.test(ua());
    }

    function supportsServiceWorker() {
        return 'serviceWorker' in global.navigator;
    }

    function supportsNotificationApi() {
        return 'Notification' in global;
    }

    function supportsWebPush() {
        return supportsServiceWorker() && supportsNotificationApi() &&
            typeof global.PushManager !== 'undefined';
    }

    function supportsSwGameNotifications() {
        return supportsServiceWorker() && supportsNotificationApi();
    }

    function isInstalledPwa() {
        return typeof NP.isPWA === 'function' ? NP.isPWA() : false;
    }

    function isApk() {
        return typeof NP.isAPK === 'function' ? NP.isAPK() : false;
    }

    function isIOS() {
        return typeof NP.isIOS === 'function' ? NP.isIOS() : /iPhone|iPad|iPod/i.test(ua());
    }

    function isAndroid() {
        return typeof NP.isAndroid === 'function' ? NP.isAndroid() : /Android/i.test(ua());
    }

    function isHuaweiFamily() {
        return typeof NP.isHuawei === 'function' ? NP.isHuawei() : /huawei|harmony|honor/i.test(ua());
    }

    /**
     * How game/check-in notifications are delivered on this device.
     * apk-native — Capacitor LocalNotifications (all Android OEMs in APK, incl. Huawei)
     * pwa-sw     — Service Worker + Notification API
     * calendar   — .ics subscription when web notifications unavailable
     * unsupported
     */
    function getNotificationDeliveryMode() {
        if (isApk()) return 'apk-native';
        if (isIOS()) {
            if (isInstalledPwa() && supportsSwGameNotifications()) return 'pwa-sw';
            return 'calendar';
        }
        if (isAndroid()) {
            if (isInAppBrowser()) return 'calendar';
            if (supportsSwGameNotifications()) return 'pwa-sw';
            return 'calendar';
        }
        if (supportsSwGameNotifications()) return 'pwa-sw';
        return 'calendar';
    }

    function shouldOfferCalendarFallback() {
        var mode = getNotificationDeliveryMode();
        return mode === 'calendar';
    }

    function shouldPromptWebNotifications() {
        var mode = getNotificationDeliveryMode();
        return mode === 'pwa-sw' && supportsNotificationApi();
    }

    function getBatteryOptimizationHints(oem) {
        oem = oem || getAndroidOem();
        var app = 'NutriPlan';
        var common = [
            'Изключете ограничения за батерията за ' + app + ' (Unrestricted / Без ограничения).',
            'Разрешете автостарт и фонова работа, ако системата пита.'
        ];
        var map = {
            huawei: [
                'Настройки → Батерия → Стартиране на приложения → ' + app + ' → Управление ръчно → включете автостарт, вторичен старт и работа на фон.',
                'Настройки → Приложения → ' + app + ' → Батерия → Без ограничения.'
            ],
            xiaomi: [
                'Настройки → Приложения → ' + app + ' → Автостарт → Вкл.',
                'Настройки → Батерия → Без ограничения за ' + app + '.',
                'Заключете приложението в списъка с последни (ако MIUI го спира).'
            ],
            samsung: [
                'Настройки → Приложения → ' + app + ' → Батерия → Без ограничения.',
                'Изключете „Поставяне в сън“ / Sleeping apps за ' + app + '.'
            ],
            oppo: [
                'Настройки → Батерия → Управление на фон → ' + app + ' → Позволи.',
                'Настройки → Приложения → ' + app + ' → Автостарт.'
            ],
            vivo: [
                'Настройки → Батерия → Фонова консумация → ' + app + ' → Без ограничения.',
                'iManager → Управление на приложения → Автостарт за ' + app + '.'
            ],
            oneplus: [
                'Настройки → Батерия → Оптимизация на батерията → ' + app + ' → Не оптимизирай.'
            ],
            google: [
                'Настройки → Приложения → ' + app + ' → Батерия → Без ограничения.'
            ],
            android: common
        };
        return (map[oem] || common).slice();
    }

    function getCompatibilityProfile() {
        var delivery = getNotificationDeliveryMode();
        var oem = getAndroidOem();
        var browser = getBrowserFamily();
        var recommendations = [];

        if (isApk()) {
            recommendations = getBatteryOptimizationHints(oem);
            if (delivery !== 'apk-native') {
                recommendations.unshift('APK: активирайте известията от системния диалог при първо пускане.');
            }
        } else if (delivery === 'pwa-sw') {
            if (isIOS() && !isInstalledPwa()) {
                recommendations.push('iOS: Safari → Сподели → „Добави на началния екран“, после отворете от иконата.');
            }
            if (isAndroid()) {
                recommendations.push('Android: Chrome, Firefox, Edge или Samsung Internet (последна версия).');
                recommendations = recommendations.concat(getBatteryOptimizationHints(oem).slice(0, 2));
            }
            if (isInAppBrowser()) {
                recommendations.unshift('Отворете сайта в Chrome/Safari (не във вграден браузър на Facebook/Instagram).');
            }
        } else if (delivery === 'calendar') {
            recommendations.push('Абонирайте се за календарни напомняния (.ics) — работи на всички Android/iOS версии.');
            if (isIOS() && !isInstalledPwa()) {
                recommendations.push('Или инсталирайте PWA от Safari за известия в приложението.');
            }
        }

        return {
            deliveryMode: delivery,
            platform: isApk() ? 'apk' : (isIOS() ? 'ios' : (isAndroid() ? 'android' : 'desktop')),
            oem: oem,
            browser: browser,
            isInAppBrowser: isInAppBrowser(),
            isInstalledPwa: isInstalledPwa(),
            isHuaweiFamily: isHuaweiFamily(),
            supportsWebPush: supportsWebPush(),
            supportsSwGameNotifications: supportsSwGameNotifications(),
            shouldOfferCalendarFallback: shouldOfferCalendarFallback(),
            shouldPromptWebNotifications: shouldPromptWebNotifications(),
            recommendations: recommendations
        };
    }

    global.NutriPlanCompat = {
        getAndroidOem: getAndroidOem,
        getBrowserFamily: getBrowserFamily,
        isInAppBrowser: isInAppBrowser,
        supportsServiceWorker: supportsServiceWorker,
        supportsNotificationApi: supportsNotificationApi,
        supportsWebPush: supportsWebPush,
        supportsSwGameNotifications: supportsSwGameNotifications,
        getNotificationDeliveryMode: getNotificationDeliveryMode,
        shouldOfferCalendarFallback: shouldOfferCalendarFallback,
        shouldPromptWebNotifications: shouldPromptWebNotifications,
        getBatteryOptimizationHints: getBatteryOptimizationHints,
        getCompatibilityProfile: getCompatibilityProfile
    };
}(typeof window !== 'undefined' ? window : this));
