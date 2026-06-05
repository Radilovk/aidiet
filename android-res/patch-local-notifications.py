#!/usr/bin/env python3
"""Patch @capacitor/local-notifications for NutriPlan heads-up action buttons."""
from __future__ import annotations

import sys
from pathlib import Path

MARKER = "NutriPlan: show all actions in heads-up compact view"
ICON_MARKER = "NutriPlan: visible action icon"
# Legacy broken patch passed int[] — remove if present from a failed CI run.
BROKEN_MARKER = "mBuilder.setShowActionsInCompactView(compact)"


def find_manager() -> Path | None:
    root = Path("node_modules/@capacitor/local-notifications")
    if not root.is_dir():
        return None
    matches = list(root.rglob("LocalNotificationManager.java"))
    return matches[0] if matches else None


def remove_broken_patch(text: str) -> tuple[str, bool]:
    """Strip a previously applied patch that used int[] (does not compile)."""
    if BROKEN_MARKER not in text:
        return text, False
    start = text.find("            // NutriPlan: show all actions in heads-up compact view\n")
    if start == -1:
        return text, False
    end = text.find("            }\n", start)
    if end == -1:
        return text, False
    end = text.find("\n", end + 1) + 1
    return text[:start] + text[end:], True


def patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    text, reverted = remove_broken_patch(text)
    if reverted:
        changed = True
        print(f"Removed broken compact-view patch from {path}", file=sys.stderr)

    if MARKER not in text:
        needle = (
            "                mBuilder.addAction(actionBuilder.build());\n"
            "            }\n"
            "        }\n"
            "\n"
            "        // Dismiss intent"
        )
        insert = (
            "                mBuilder.addAction(actionBuilder.build());\n"
            "            }\n"
            "            // NutriPlan: show all actions in heads-up compact view\n"
            "            if (actionGroup.length > 1) {\n"
            "                int compactCount = Math.min(actionGroup.length, 3);\n"
            "                if (compactCount >= 3) {\n"
            "                    mBuilder.setShowActionsInCompactView(0, 1, 2);\n"
            "                } else if (compactCount == 2) {\n"
            "                    mBuilder.setShowActionsInCompactView(0, 1);\n"
            "                }\n"
            "            }\n"
            "        }\n"
            "\n"
            "        // Dismiss intent"
        )
        if needle not in text:
            print(f"ERROR: action loop anchor not found in {path}", file=sys.stderr)
            return False
        text = text.replace(needle, insert, 1)
        changed = True

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
    target = find_manager()
    if not target:
        print("WARN: LocalNotificationManager.java not found — skip patch", file=sys.stderr)
        return 0
    if patch(target):
        print(f"Patched {target}")
    else:
        print(f"Already patched: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
