#!/usr/bin/env python3
"""Android project of the studio app (run in studio-app/ after `npx cap add android`; idempotent).

  - a small white calendar glyph for the notification (ic_stat_studio — Android masks the icon to one color)
  - no SCHEDULE_EXACT_ALARM: the local-notifications plugin brings it, but Google Play treats it as a restricted
    permission; without it the reminder is "about on time" (a minute or two), which is fine for a 4-hour reminder
  - version from the CI run: STUDIO_V_CODE / STUDIO_V_NAME
  - the soft studio chime (res/raw/studio.wav) for the reminders' notification channel (the same sound as on iOS)
  - reminders full screen (like an alarm): MainActivity + FullScreenPlugin from android-extra/, the
    USE_FULL_SCREEN_INTENT permission, and a full-screen intent in the local-notifications plugin for a reminder
    marked extra.fullScreen (the app opens over the lock screen showing only "Твоята тренировка")
  - the launch screen: the template puts the splash as android:background of every view, so Android stretched it
    into a title bar on top ("XB-Studio" + a flattened logo); now it is the window background only, with no title bar
"""
import os
import re
import shutil
import sys
from pathlib import Path

res = Path("android/app/src/main/res")
manifest = Path("android/app/src/main/AndroidManifest.xml")
gradle = Path("android/app/build.gradle")
if not manifest.exists():
    sys.exit("android/ not found — run `npx cap add android` first")

(res / "drawable").mkdir(parents=True, exist_ok=True)
(res / "drawable" / "ic_stat_studio.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M19,4h-1V2h-2v2H8V2H6v2H5C3.9,4 3,4.9 3,6v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V6C21,4.9 20.1,4 19,4zM19,20H5V10h14V20zM10.5,18.5l-3,-3 1.4,-1.4 1.6,1.6 4.1,-4.1 1.4,1.4z"/>
</vector>
""", encoding="utf-8")

(res / "raw").mkdir(parents=True, exist_ok=True)
shutil.copyfile("ios-extra/studio.wav", res / "raw" / "studio.wav")

styles = res / "values" / "styles.xml"
st = styles.read_text(encoding="utf-8")
st = re.sub(r'<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">.*?</style>',
    """<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowBackground">@drawable/splash</item>
        <item name="android:background">@null</item>
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowActionBar">false</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>""", st, count=1, flags=re.S)
styles.write_text(st, encoding="utf-8")

# full-screen reminders: our MainActivity (over the lock screen only for a full-screen reminder) and the plugin
java_dir = Path("android/app/src/main/java/com/biocode/studios")
java_dir.mkdir(parents=True, exist_ok=True)
for f in ("MainActivity.java", "FullScreenPlugin.java"):
    shutil.copyfile(Path("android-extra") / f, java_dir / f)
lnm = Path("node_modules/@capacitor/local-notifications/android/src/main/kotlin/com/capacitorjs/plugins/localnotifications/LocalNotificationManager.kt")
code = lnm.read_text(encoding="utf-8")
if "xbFullScreen" not in code:
    anchor = "        mBuilder.setContentIntent(pendingIntent)\n"
    if anchor not in code:
        sys.exit("local-notifications: setContentIntent not found — the plugin changed, review the full-screen patch")
    code = code.replace(anchor, anchor + """
        // XB-Studio: a reminder marked extra.fullScreen opens the app over the lock screen (like an alarm)
        val xbExtra = localNotification.extra
        if (xbExtra is org.json.JSONObject && xbExtra.optBoolean("fullScreen", false)) {
            val fsIntent = buildIntent(localNotification, DEFAULT_PRESS_ACTION)
            fsIntent.putExtra("xbFullScreen", true)
            mBuilder.setFullScreenIntent(PendingIntent.getActivity(context, id + 7777, fsIntent, flags), true)
            mBuilder.setCategory(NotificationCompat.CATEGORY_REMINDER)
        }
""", 1)
    lnm.write_text(code, encoding="utf-8")

text = manifest.read_text(encoding="utf-8")
if 'xmlns:tools=' not in text:
    text = text.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
                        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"', 1)
remove = '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />'
fsi = '<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />'
if 'USE_FULL_SCREEN_INTENT' not in text:
    text = text.replace('</manifest>', f'    {fsi}\n</manifest>', 1)
if 'SCHEDULE_EXACT_ALARM' not in text:
    text = text.replace('</manifest>', f'    {remove}\n</manifest>', 1)
manifest.write_text(text, encoding="utf-8")

g = gradle.read_text(encoding="utf-8")
code = os.environ.get("STUDIO_V_CODE")
name = os.environ.get("STUDIO_V_NAME")
if code:
    g = re.sub(r"versionCode\s+\d+", f"versionCode {int(code)}", g, count=1)
if name:
    g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', g, count=1)
gradle.write_text(g, encoding="utf-8")
print("android: full-screen reminders, launch screen without a title bar, notification icon, studio sound, no exact-alarm permission, version", code or "-", name or "-")
