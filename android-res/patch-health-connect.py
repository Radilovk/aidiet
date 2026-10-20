#!/usr/bin/env python3
"""
Patch the generated Capacitor Android project for Health Connect
(@capgo/capacitor-health).

- The plugin declares read AND write permissions for ~25 data types. Google
  Play rejects health permissions an app does not use, so every one except
  the four NutriPlan reads (steps, weight, sleep, nutrition) is removed from
  the merged manifest with tools:node="remove".
- The plugin (androidx.health.connect) needs minSdk 26 — raised in
  android/variables.gradle when lower.
- The rationale screen Health Connect opens from its settings shows our
  privacy policy (string health_connect_privacy_policy_url).

Run after `npx cap sync android`. Idempotent.
"""

import re
import sys
from pathlib import Path

PLUGIN_MANIFEST = Path("node_modules/@capgo/capacitor-health/android/src/main/AndroidManifest.xml")
APP_MANIFEST = Path("android/app/src/main/AndroidManifest.xml")
VARIABLES = Path("android/variables.gradle")
STRINGS = Path("android/app/src/main/res/values/strings.xml")
SETTINGS = Path("android/capacitor.settings.gradle")

KEEP = {
    "android.permission.health.READ_STEPS",
    "android.permission.health.READ_WEIGHT",
    "android.permission.health.READ_SLEEP",
    "android.permission.health.READ_NUTRITION",
}
MIN_SDK = 26
PRIVACY_URL = "https://biocode.website/privacy-policy.html"


def main() -> int:
    for path in (PLUGIN_MANIFEST, APP_MANIFEST, VARIABLES):
        if not path.exists():
            print(f"ERROR: {path} not found — run `npm ci` and `npx cap sync android` first", file=sys.stderr)
            return 1
    if SETTINGS.exists() and "capgo-capacitor-health" not in SETTINGS.read_text():
        print("ERROR: Health plugin is not in capacitor.settings.gradle — `npx cap sync android` did not pick it up", file=sys.stderr)
        return 1

    declared = sorted(set(re.findall(r'android\.permission\.health\.[A-Z_]+', PLUGIN_MANIFEST.read_text())))
    drop = [p for p in declared if p not in KEEP]
    missing = KEEP - set(declared)
    if missing:
        print(f"ERROR: plugin no longer declares {sorted(missing)} — check the plugin version", file=sys.stderr)
        return 1

    text = APP_MANIFEST.read_text(encoding="utf-8")
    if 'xmlns:tools=' not in text:
        text = re.sub(r'<manifest\b', '<manifest xmlns:tools="http://schemas.android.com/tools"', text, count=1)
    lines = [f'    <uses-permission android:name="{p}" tools:node="remove" />' for p in drop
             if f'android:name="{p}" tools:node="remove"' not in text]
    if lines:
        text = text.replace("<application", "\n".join(lines).lstrip() + "\n\n    <application", 1)
    APP_MANIFEST.write_text(text, encoding="utf-8")
    print(f"Health Connect: kept {sorted(KEEP)}, removed {len(drop)} other permissions.")

    gradle = VARIABLES.read_text()
    m = re.search(r'minSdkVersion\s*=\s*(\d+)', gradle)
    if not m:
        print("ERROR: minSdkVersion not found in variables.gradle", file=sys.stderr)
        return 1
    if int(m.group(1)) < MIN_SDK:
        gradle = gradle[:m.start(1)] + str(MIN_SDK) + gradle[m.end(1):]
        VARIABLES.write_text(gradle)
        print(f"minSdkVersion {m.group(1)} → {MIN_SDK} (Health Connect).")

    entry = f'    <string name="health_connect_privacy_policy_url">{PRIVACY_URL}</string>'
    if STRINGS.exists():
        content = STRINGS.read_text()
        if "health_connect_privacy_policy_url" not in content:
            STRINGS.write_text(content.replace("</resources>", entry + "\n</resources>"))
    else:
        STRINGS.parent.mkdir(parents=True, exist_ok=True)
        STRINGS.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + entry + "\n</resources>\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
