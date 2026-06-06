#!/usr/bin/env python3
"""NutriPlan maintenance patch for @capacitor/local-notifications.

- Reverts mistaken ic_menu_send action icons (heads-up showed arrows, not labels).
- Removes legacy MediaStyle compact-view patch if present.
- Routes action buttons through GameNotificationActionReceiver (no Activity launch).
- Uses unique PendingIntent request codes so all action buttons stay enabled.
- Raises notification builder priority for reliable heads-up display.
"""
from __future__ import annotations

import sys
from pathlib import Path

COMPACT_MARKER = "NutriPlan: show all actions in heads-up compact view"
GRADLE_MEDIA_LINE = 'implementation "androidx.media:media:1.7.0" // NutriPlan: androidx.media for compact actions'
SEND_ICON = "android.R.drawable.ic_menu_send /* NutriPlan: visible action icon */"
TRANSPARENT_ICON = "R.drawable.ic_transparent"
BROADCAST_MARKER = "NutriPlan: background broadcast"

ACTION_LOOP_OLD = """            for (NotificationAction notificationAction : actionGroup) {
                // TODO Add custom icons to actions
                Intent actionIntent = buildIntent(localNotification, notificationAction.getId());
                PendingIntent actionPendingIntent = PendingIntent.getActivity(
                    context,
                    localNotification.getId() + notificationAction.getId().hashCode(),
                    actionIntent,
                    flags
                );
                NotificationCompat.Action.Builder actionBuilder = new NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.getTitle(),
                    actionPendingIntent
                );"""

ACTION_LOOP_NEW = """            for (int actionIdx = 0; actionIdx < actionGroup.length; actionIdx++) {
                NotificationAction notificationAction = actionGroup[actionIdx];
                // NutriPlan: background broadcast — no Activity launch on action tap
                Intent actionIntent = new Intent();
                actionIntent.setClassName(context.getPackageName(), "com.biocode.nutriplan.GameNotificationActionReceiver");
                actionIntent.putExtra(NOTIFICATION_INTENT_KEY, localNotification.getId());
                actionIntent.putExtra(ACTION_INTENT_KEY, notificationAction.getId());
                actionIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.getSource());
                LocalNotificationSchedule actionSchedule = localNotification.getSchedule();
                actionIntent.putExtra(NOTIFICATION_IS_REMOVABLE_KEY, actionSchedule == null || actionSchedule.isRemovable());
                int actionRequestCode = localNotification.getId() * 31 + actionIdx + 1;
                int actionFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (android.os.Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    actionFlags = actionFlags | PendingIntent.FLAG_MUTABLE;
                }
                PendingIntent actionPendingIntent = PendingIntent.getBroadcast(
                    context,
                    actionRequestCode,
                    actionIntent,
                    actionFlags
                );
                NotificationCompat.Action.Builder actionBuilder = new NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.getTitle(),
                    actionPendingIntent
                );"""

BROKEN_CLASS_REF = 'Intent actionIntent = new Intent(context, com.biocode.nutriplan.GameNotificationActionReceiver.class);'
FIXED_CLASS_REF = (
    'Intent actionIntent = new Intent();\n'
    '                actionIntent.setClassName(context.getPackageName(), "com.biocode.nutriplan.GameNotificationActionReceiver");'
)

PRIORITY_OLD = ".setPriority(NotificationCompat.PRIORITY_DEFAULT)"
PRIORITY_NEW = ".setPriority(NotificationCompat.PRIORITY_HIGH) // NutriPlan: heads-up eligibility"


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

    if ACTION_LOOP_OLD in text:
        text = text.replace(ACTION_LOOP_OLD, ACTION_LOOP_NEW)
        changed = True
        print(f"Patched action intents to BroadcastReceiver in {path}", file=sys.stderr)
    elif BROKEN_CLASS_REF in text:
        text = text.replace(BROKEN_CLASS_REF, FIXED_CLASS_REF)
        changed = True
        print(f"Fixed BroadcastReceiver class reference in {path}", file=sys.stderr)
    elif BROADCAST_MARKER not in text:
        print("WARN: action loop pattern not found — Capacitor version may have changed", file=sys.stderr)

    if PRIORITY_OLD in text and PRIORITY_NEW not in text:
        text = text.replace(PRIORITY_OLD, PRIORITY_NEW, 1)
        changed = True
        print(f"Raised notification priority in {path}", file=sys.stderr)

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
