#!/usr/bin/env python3
"""NutriPlan patch for @capacitor/app exitApp — remove task from recents."""
from __future__ import annotations

import sys
from pathlib import Path

OLD_EXIT = """    @PluginMethod
    public void exitApp(PluginCall call) {
        unsetAppListeners();
        call.resolve();
        getBridge().getActivity().finish();
    }"""

NEW_EXIT = """    @PluginMethod
    public void exitApp(PluginCall call) {
        unsetAppListeners();
        call.resolve();
        android.app.Activity activity = getBridge().getActivity();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            activity.finishAndRemoveTask();
        } else {
            activity.finish();
        }
    }"""


def find_app_plugin() -> Path | None:
    root = Path("node_modules/@capacitor/app/android/src/main/java")
    if not root.is_dir():
        return None
    matches = list(root.rglob("AppPlugin.java"))
    return matches[0] if matches else None


def main() -> int:
    path = find_app_plugin()
    if not path:
        print("WARN: AppPlugin.java not found — skip patch", file=sys.stderr)
        return 0

    text = path.read_text(encoding="utf-8")
    if "finishAndRemoveTask" in text:
        print(f"No app exit changes needed: {path}", file=sys.stderr)
        return 0

    if OLD_EXIT not in text:
        print("WARN: AppPlugin exitApp pattern not found — Capacitor version may have changed", file=sys.stderr)
        return 0

    path.write_text(text.replace(OLD_EXIT, NEW_EXIT, 1), encoding="utf-8")
    print(f"Patched exitApp → finishAndRemoveTask in {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
