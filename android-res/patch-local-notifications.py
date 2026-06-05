#!/usr/bin/env python3
"""Patch @capacitor/local-notifications for NutriPlan heads-up action buttons."""
from __future__ import annotations

import sys
from pathlib import Path

MARKER = "NutriPlan: show all actions in heads-up compact view"
ICON_MARKER = "NutriPlan: visible action icon"


def find_manager() -> Path | None:
    root = Path("node_modules/@capacitor/local-notifications")
    if not root.is_dir():
        return None
    matches = list(root.rglob("LocalNotificationManager.java"))
    return matches[0] if matches else None


def patch(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if MARKER not in text:
        needle = "                mBuilder.addAction(actionBuilder.build());\n            }\n        }"
        insert = (
            "                mBuilder.addAction(actionBuilder.build());\n"
            "            }\n"
            "            // NutriPlan: show all actions in heads-up compact view\n"
            "            if (actionGroup.length > 1) {\n"
            "                int[] compact = new int[Math.min(actionGroup.length, 3)];\n"
            "                for (int i = 0; i < compact.length; i++) compact[i] = i;\n"
            "                mBuilder.setShowActionsInCompactView(compact);\n"
            "            }\n"
            "        }"
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
