package com.capacitorjs.plugins.localnotifications;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * NutriPlan: handles gamification notification action taps without launching the WebView.
 * Queues answers in Capacitor Preferences; GameNotifier drains them on next app open.
 */
public class GameNotificationActionReceiver extends BroadcastReceiver {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String PENDING_KEY = "gameNotifierPendingActions";
    private static final int MAX_PENDING = 50;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;

        int notificationId = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Integer.MIN_VALUE);
        String actionId = intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY);
        String notificationJson = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY);

        if (notificationId == Integer.MIN_VALUE || actionId == null || actionId.isEmpty()) return;
        if ("tap".equals(actionId) || "dismiss".equals(actionId)) return;

        String type = "";
        String recordKey = "";
        try {
            JSONObject root = new JSONObject(notificationJson != null ? notificationJson : "{}");
            JSONObject extra = root.optJSONObject("extra");
            if (extra != null) {
                type = extra.optString("type", "");
                recordKey = extra.optString("recordKey", "");
            }
        } catch (Exception ignored) {}

        if ("evening_check".equals(type)) {
            type = "evening_water";
        }

        queuePendingAction(context, type, actionId, recordKey);
        dismissNotification(context, intent, notificationId);
        vibrateAck(context, actionId);
    }

    private void queuePendingAction(Context context, String type, String action, String recordKey) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
            String existing = prefs.getString(PENDING_KEY, null);
            JSONArray arr = existing != null ? new JSONArray(existing) : new JSONArray();

            JSONObject item = new JSONObject();
            item.put("notificationType", type);
            item.put("action", action);
            item.put("recordKey", recordKey);
            item.put("ts", System.currentTimeMillis());
            arr.put(item);

            JSONArray trimmed = new JSONArray();
            int start = Math.max(0, arr.length() - MAX_PENDING);
            for (int i = start; i < arr.length(); i++) {
                trimmed.put(arr.getJSONObject(i));
            }

            prefs.edit().putString(PENDING_KEY, trimmed.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void dismissNotification(Context context, Intent intent, int notificationId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(notificationId);
        }

        boolean isRemovable = intent.getBooleanExtra(LocalNotificationManager.NOTIFICATION_IS_REMOVABLE_KEY, true);
        if (isRemovable) {
            NotificationStorage storage = new NotificationStorage(context);
            storage.deleteNotification(Integer.toString(notificationId));
        }
    }

    private void vibrateAck(Context context, String actionId) {
        try {
            Vibrator vibrator = getVibrator(context);
            if (vibrator == null || !vibrator.hasVibrator()) return;

            long[] pattern = patternForAction(actionId);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {}
    }

    private Vibrator getVibrator(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm != null ? vm.getDefaultVibrator() : null;
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private long[] patternForAction(String actionId) {
        switch (actionId) {
            case "sleep_yes":
                return new long[] { 0, 35, 25, 35 };
            case "sleep_no":
                return new long[] { 0, 45, 25 };
            case "activity_1":
                return new long[] { 0, 20, 15, 20 };
            case "activity_2":
                return new long[] { 0, 25, 20, 25 };
            case "activity_3":
                return new long[] { 0, 30, 25, 30, 25, 30 };
            case "balance_1":
                return new long[] { 0, 20 };
            case "balance_2":
                return new long[] { 0, 25, 20, 25 };
            case "balance_3":
                return new long[] { 0, 30, 25, 30 };
            case "water_yes":
                return new long[] { 0, 30, 20, 30 };
            case "water_no":
                return new long[] { 0, 40, 25 };
            case "skip":
                return new long[] { 0, 15 };
            default:
                return new long[] { 0, 25 };
        }
    }
}
