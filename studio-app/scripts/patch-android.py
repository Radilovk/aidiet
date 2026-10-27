#!/usr/bin/env python3
"""Android project of the studio app (run in studio-app/ after `npx cap add android`; idempotent).

  - a small white calendar glyph for the notification (ic_stat_studio — Android masks the icon to one color)
  - no SCHEDULE_EXACT_ALARM: the local-notifications plugin brings it, but Google Play treats it as a restricted
    permission; without it the reminder is "about on time" (a minute or two), which is fine for a 4-hour reminder
  - version from the CI run: STUDIO_V_CODE / STUDIO_V_NAME
"""
import os
import re
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

text = manifest.read_text(encoding="utf-8")
if 'xmlns:tools=' not in text:
    text = text.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
                        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"', 1)
remove = '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />'
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
print("android: notification icon, no exact-alarm permission, version", code or "-", name or "-")
