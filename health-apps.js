/**
 * Здравните и спортни приложения, които APK-то разпознава на телефона.
 *
 * Източник на истина и за манифеста: patch-health-connect.py чете пакетите
 * оттук (редовете с pkg: '…') и ги слага в <queries> — без тях Android 11+
 * не казва дали приложението е инсталирано.
 *
 * hc — пише в Health Connect (данните идват с едно свързване);
 * hcSetup — пътят в самото приложение за еднократното включване;
 * cloud — може да се свърже и профилът в облака (device-links.js);
 * bridge — приложение-мост, което прехвърля данните му в Health Connect.
 */
(function (global) {
    'use strict';

    var APPS = [
        { id: 'samsung', name: 'Samsung Health', pkg: 'com.sec.android.app.shealth', hc: true,
          hcSetup: 'Настройки → Health Connect → разрешете споделянето.' },
        { id: 'googlefit', name: 'Google Fit', pkg: 'com.google.android.apps.fitness', hc: true },
        { id: 'fitbit', name: 'Fitbit', pkg: 'com.fitbit.FitbitMobile', hc: true, cloud: 'fitbit' },
        { id: 'garmin', name: 'Garmin Connect', pkg: 'com.garmin.android.apps.connectmobile', hc: true,
          hcSetup: 'Още → Настройки → Health Connect → включете.' },
        { id: 'mifitness', name: 'Mi Fitness', pkg: 'com.xiaomi.wearable', hc: true },
        { id: 'zepplife', name: 'Zepp Life', pkg: 'com.xiaomi.hm.health', hc: true },
        { id: 'zepp', name: 'Zepp (Amazfit)', pkg: 'com.huami.watch.hmwatchmanager', hc: true },
        { id: 'oura', name: 'Oura', pkg: 'com.ouraring.oura', hc: true, cloud: 'oura' },
        { id: 'withings', name: 'Withings', pkg: 'com.withings.wiscale2', hc: true, cloud: 'withings' },
        { id: 'polar', name: 'Polar Flow', pkg: 'fi.polar.polarflow', hc: true },
        { id: 'suunto', name: 'Suunto', pkg: 'com.stt.android.suunto', hc: true },
        { id: 'whoop', name: 'WHOOP', pkg: 'com.whoop.android', hc: true },
        { id: 'strava', name: 'Strava', pkg: 'com.strava', hc: true, cloud: 'strava' },
        { id: 'mfp', name: 'MyFitnessPal', pkg: 'com.myfitnesspal.android', hc: true },
        // Мост: прехвърля данните на Huawei/Honor (и др.) в Health Connect.
        { id: 'healthsync', name: 'Health Sync', pkg: 'nl.appyhapps.healthsync', hc: true,
          hcSetup: 'изберете Huawei Health като източник и Health Connect като цел.' },
        // Не пишат в Health Connect сами — през Health Sync, иначе файл/снимка.
        { id: 'huawei', name: 'Huawei Health', pkg: 'com.huawei.health', hc: false, bridge: 'healthsync' },
        { id: 'honor', name: 'Honor Health', pkg: 'com.hihonor.health', hc: false, bridge: 'healthsync' }
    ];

    /** Health Connect като отделно приложение (Android 9–13; от 14 е част от системата). */
    var HEALTH_CONNECT_PKG = 'com.google.android.apps.healthdata';

    global.NutriPlanHealthApps = {
        APPS: APPS,
        HEALTH_CONNECT_PKG: HEALTH_CONNECT_PKG,
        byPkg: function (pkg) { return APPS.filter(function (a) { return a.pkg === pkg; })[0] || null; },
        byId: function (id) { return APPS.filter(function (a) { return a.id === id; })[0] || null; }
    };
}(typeof window !== 'undefined' ? window : globalThis));
