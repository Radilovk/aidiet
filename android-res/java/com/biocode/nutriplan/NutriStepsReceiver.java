package com.biocode.nutriplan;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * NutriPlan: показанията на крачкомера и докато приложението е затворено.
 *
 * Без това дневникът има показания само докато приложението е живо и разликата
 * за дните, в които не е отваряно, се дописва по кривата — тоест е прогноза.
 * Тук будилник (без точен час, setAndAllowWhileIdle — при Doze системата го
 * отлага, но го пуска, и дава на приложението кратко разрешение за работа)
 * на около 30 минути записва едно показание на брояча в същия дневник,
 * който чете NutriStepsPlugin. Отделно:
 *  - при изключване на телефона — последно показание (иначе крачките от
 *    последното показание до изключването се губят: броячът се нулира);
 *  - при включване и след обновяване — будилникът се пуска отново.
 * Без разрешение „Физическа активност“ не прави нищо.
 * Ако производителят спира фоновата работа, просто няма показание —
 * празнината се разпределя както преди и дните се отбелязват като непълни.
 */
public class NutriStepsReceiver extends BroadcastReceiver {

    static final String ACTION_TICK = "com.biocode.nutriplan.STEPS_TICK";
    static final String PREFS = "nutriplan_steps";
    static final String LOG_KEY = "log";
    private static final long TICK_MS = 30 * 60 * 1000L;
    // Близко показание (от приложението или предишен будилник) — ново не е нужно.
    private static final long MIN_GAP_MS = 10 * 60 * 1000L;
    private static final long KEEP_MS = 10L * 24 * 60 * 60 * 1000;
    private static final int MAX_LOG = 1000;
    private static final long WAIT_MS = 8000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        String action = intent != null ? intent.getAction() : null;
        if (!hasPermission(app)) return;
        boolean shutdown = Intent.ACTION_SHUTDOWN.equals(action) || "android.intent.action.QUICKBOOT_POWEROFF".equals(action);
        if (!shutdown) schedule(app);
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)) return;
        if (!shutdown && System.currentTimeMillis() - lastLogTime(app) < MIN_GAP_MS) return;
        readOnce(app, goAsync(), shutdown ? 3000L : WAIT_MS);
    }

    static boolean hasPermission(Context ctx) {
        return Build.VERSION.SDK_INT < 29
            || ctx.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Пуска (или подновява) будилника. Безопасно за многократно извикване. */
    static void schedule(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(ctx, NutriStepsReceiver.class).setAction(ACTION_TICK);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7301, i, flags);
            long at = SystemClock.elapsedRealtime() + TICK_MS;
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
            else am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
        } catch (Exception ignored) {
            // без будилник — показания само докато приложението е отворено
        }
    }

    /** Едно показание на брояча → дневника; край при първото събитие или след `waitMs`. */
    private static void readOnce(final Context ctx, final PendingResult pending, long waitMs) {
        final SensorManager sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        final Sensor counter = sm != null ? sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) : null;
        if (counter == null) { pending.finish(); return; }
        final HandlerThread thread = new HandlerThread("nutri-steps");
        thread.start();
        final Handler handler = new Handler(thread.getLooper());
        final boolean[] done = { false };
        final SensorEventListener[] holder = new SensorEventListener[1];
        final Runnable finish = new Runnable() {
            @Override
            public void run() {
                if (done[0]) return;
                done[0] = true;
                try { sm.unregisterListener(holder[0]); } catch (Exception ignored) { }
                thread.quitSafely();
                pending.finish();
            }
        };
        holder[0] = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (done[0] || event == null || event.values == null || event.values.length == 0) return;
                long ageMs = (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1000000L;
                long at = System.currentTimeMillis() - Math.max(0L, ageMs);
                appendLog(ctx, at, event.values[0]);
                finish.run();
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) { }
        };
        boolean ok = sm.registerListener(holder[0], counter, SensorManager.SENSOR_DELAY_NORMAL, 0, handler);
        if (!ok) { finish.run(); return; }
        // Групираните в хардуера събития излизат веднага; някои устройства пращат текущата стойност само така.
        if (Build.VERSION.SDK_INT >= 19) {
            try { sm.flush(holder[0]); } catch (Exception ignored) { }
        }
        handler.postDelayed(finish, waitMs);
    }

    static long bootTime() {
        return System.currentTimeMillis() - SystemClock.elapsedRealtime();
    }

    static JSONArray readLog(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return new JSONArray(prefs.getString(LOG_KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static long lastLogTime(Context ctx) {
        JSONArray log = readLog(ctx);
        if (log.length() == 0) return 0L;
        JSONObject last = log.optJSONObject(log.length() - 1);
        return last != null ? last.optLong("t", 0L) : 0L;
    }

    /** Общ запис за приложението и будилника (по време, без по-стари от последния). */
    static synchronized void appendLog(Context ctx, long at, float value) {
        try {
            JSONArray log = readLog(ctx);
            JSONObject lastItem = log.length() > 0 ? log.optJSONObject(log.length() - 1) : null;
            if (lastItem != null && lastItem.optLong("t", 0L) >= at) return;
            JSONObject item = new JSONObject();
            item.put("t", at);
            item.put("c", (double) value);
            item.put("boot", bootTime());
            log.put(item);
            long cutoff = System.currentTimeMillis() - KEEP_MS;
            JSONArray kept = new JSONArray();
            int start = Math.max(0, log.length() - MAX_LOG);
            for (int i = start; i < log.length(); i++) {
                JSONObject x = log.optJSONObject(i);
                if (x != null && x.optLong("t", 0L) >= cutoff) kept.put(x);
            }
            // commit: при изключване на телефона записът трябва да е на диска преди края.
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LOG_KEY, kept.toString()).commit();
        } catch (Exception ignored) {
            // без запис — следващото показание ще покрие интервала
        }
    }
}
