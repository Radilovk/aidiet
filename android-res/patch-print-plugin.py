#!/usr/bin/env python3
"""
Patch the generated Capacitor Android project for NutriPrintPlugin.

- Copies android-res/java/com/biocode/nutriplan/NutriPrintPlugin.java into the
  app sources (same package as MainActivity).
- Registers the plugin in MainActivity before super.onCreate().
- Copies and registers NutriSystemUiPlugin (the window colour behind the system
  bars follows the app theme) and makes the activity edge-to-edge on every
  Android version, so the system-bar inset is applied once (by Capacitor's
  SystemBars), not twice.

window.print() does nothing in Android WebView; the plan book (plan-book.html)
calls NutriPrint.print() instead, which opens the system print dialog with
"Save as PDF".

Stops the build when MainActivity is not the empty class Capacitor generates —
then it was changed elsewhere and must be merged by hand, not overwritten.
Idempotent: a second run leaves an already patched MainActivity as is.
"""

import re
import shutil
import sys
from pathlib import Path

PACKAGE_DIR = Path("android/app/src/main/java/com/biocode/nutriplan")
PLUGIN_SOURCE = Path("android-res/java/com/biocode/nutriplan/NutriPrintPlugin.java")
PLUGIN_SOURCES = [
    PLUGIN_SOURCE,
    Path("android-res/java/com/biocode/nutriplan/NutriSystemUiPlugin.java"),
]
MAIN_ACTIVITY = PACKAGE_DIR / "MainActivity.java"

PATCHED_ACTIVITY = """package com.biocode.nutriplan;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(NutriPrintPlugin.class);
        registerPlugin(NutriSystemUiPlugin.class);
        super.onCreate(savedInstanceState);
        // От край до край на всички версии: отместването за системните ленти е
        // само едно (SystemBars на Capacitor). Без това под Android 15 системата
        // също мести съдържанието и под лентите оставаше втора, сива ивица.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
"""

EMPTY_ACTIVITY = re.compile(
    r"^\s*package\s+com\.biocode\.nutriplan\s*;\s*"
    r"import\s+com\.getcapacitor\.BridgeActivity\s*;\s*"
    r"public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}\s*$",
    re.S,
)


def main() -> int:
    if not PLUGIN_SOURCE.exists():
        print(f"ERROR: {PLUGIN_SOURCE} not found", file=sys.stderr)
        return 1
    if not MAIN_ACTIVITY.exists():
        print(f"ERROR: {MAIN_ACTIVITY} not found — run `npx cap add android` first", file=sys.stderr)
        return 1

    PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    for source in PLUGIN_SOURCES:
        if not source.exists():
            print(f"ERROR: {source} not found", file=sys.stderr)
            return 1
        dest = PACKAGE_DIR / source.name
        shutil.copy2(source, dest)
        print(f"Copied {source} -> {dest}")

    text = MAIN_ACTIVITY.read_text(encoding="utf-8")
    if "registerPlugin(NutriPrintPlugin.class)" in text:
        print("MainActivity already registers NutriPrintPlugin")
        return 0
    if not EMPTY_ACTIVITY.match(text):
        print(
            "ERROR: MainActivity is not the empty class Capacitor generates; "
            "register NutriPrintPlugin by hand:\n" + text,
            file=sys.stderr,
        )
        return 1

    MAIN_ACTIVITY.write_text(PATCHED_ACTIVITY, encoding="utf-8")
    print(f"Registered NutriPrintPlugin in {MAIN_ACTIVITY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
