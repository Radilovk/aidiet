#!/usr/bin/env python3
"""NutriPlan maintenance patch for @capacitor/local-notifications.

- Reverts mistaken ic_menu_send action icons (heads-up showed arrows, not labels).
- Removes legacy MediaStyle compact-view patch if present.
- Removes unused androidx.media dependency if it was added for MediaStyle.
"""
from __future__ import annotations

import sys
from pathlib import Path

COMPACT_MARKER = "NutriPlan: show all actions in heads-up compact view"
GRADLE_MEDIA_LINE = 'implementation "androidx.media:media:1.7.0" // NutriPlan: androidx.media for compact actions'
SEND_ICON = "android.R.drawable.ic_menu_send /* NutriPlan: visible action icon */"
TRANSPARENT_ICON = "R.drawable.ic_transparent"


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


def patch_manager(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if "mBuilder.setShowActionsInCompactView" in text:
        text, removed = remove_compact_patch(text)
        if removed:
            changed = True
            print(f"Removed legacy MediaStyle compact patch from {path}", file=sys.stderr)

    if SEND_ICON in text:
        text = text.replace(SEND_ICON, TRANSPARENT_ICON)
        changed = True
        print(f"Reverted send-arrow action icon in {path}", file=sys.stderr)

    if changed:
        path.write_text(text, encoding="utf-8")
    return changed


def patch_gradle(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if GRADLE_MEDIA_LINE not in text:
        return False
    text = text.replace(GRADLE_MEDIA_LINE + "\n", "")
    text = text.replace(GRADLE_MEDIA_LINE, "")
    path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    manager = find_manager()
    if not manager:
        print("WARN: LocalNotificationManager.java not found — skip patch", file=sys.stderr)
        return 0

    gradle = find_gradle()
    if gradle and patch_gradle(gradle):
        print(f"Removed unused media dependency from {gradle}")

    if patch_manager(manager):
        print(f"Patched {manager}")
    else:
        print(f"No manager changes needed: {manager}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
