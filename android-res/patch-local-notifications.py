#!/usr/bin/env python3
"""Patch @capacitor/local-notifications for NutriPlan heads-up action buttons."""
from __future__ import annotations

import sys
from pathlib import Path

COMPACT_MARKER = "NutriPlan: show all actions in heads-up compact view"
# MediaStyle compact actions hide notification body on many OEM heads-up UIs.
# NutriPlan uses JS `largeBody` (Capacitor BigTextStyle) for the question text instead.
ICON_MARKER = "NutriPlan: visible action icon"
GRADLE_MARKER = "NutriPlan: androidx.media for compact actions"


def find_manager() -> Path | None:
    root = Path("node_modules/@capacitor/local-notifications")
    if not root.is_dir():
        return None
    matches = list(root.rglob("LocalNotificationManager.java"))
    return matches[0] if matches else None


def find_gradle() -> Path | None:
    path = Path("node_modules/@capacitor/local-notifications/android/build.gradle")
    return path if path.is_file() else None


def remove_compact_patch(text: str) -> tuple[str, bool]:
    """Remove any prior NutriPlan compact-view patch (all broken variants)."""
    marker = f"            // {COMPACT_MARKER}\n"
    changed = False
    while marker in text:
        start = text.find(marker)
        anchor = "            }\n        }\n\n        // Dismiss intent"
        end = text.find(anchor, start)
        if end == -1:
            print("ERROR: could not remove old compact patch — anchor missing", file=sys.stderr)
            return text, changed
        text = text[:start] + text[end + len("            }\n") :]
        changed = True
    return text, changed


def patch_gradle(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if GRADLE_MARKER in text:
        return False
    needle = 'implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"'
    insert = (
        needle
        + '\n    implementation "androidx.media:media:1.7.0" // '
        + GRADLE_MARKER
    )
    if needle not in text:
        print(f"ERROR: appcompat dependency anchor not found in {path}", file=sys.stderr)
        return False
    path.write_text(text.replace(needle, insert, 1), encoding="utf-8")
    return True


def patch_manager(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if "mBuilder.setShowActionsInCompactView" in text:
        text, removed = remove_compact_patch(text)
        if removed:
            changed = True
            print(f"Removed legacy compact-view patch from {path}", file=sys.stderr)

    if ICON_MARKER not in text and "R.drawable.ic_transparent" in text:
        text = text.replace(
            "R.drawable.ic_transparent",
            "android.R.drawable.ic_menu_send /* NutriPlan: visible action icon */",
            1,
        )
        changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
    return changed


def main() -> int:
    gradle = find_gradle()
    manager = find_manager()
    if not manager:
        print("WARN: LocalNotificationManager.java not found — skip patch", file=sys.stderr)
        return 0

    ok = True
    if gradle:
        if patch_gradle(gradle):
            print(f"Patched {gradle}")
        else:
            print(f"Gradle already patched: {gradle}")
    else:
        print("WARN: local-notifications build.gradle not found", file=sys.stderr)
        ok = False

    if patch_manager(manager):
        print(f"Patched {manager}")
    elif ok:
        print(f"Already patched: {manager}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
