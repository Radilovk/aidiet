package com.biocode.nutriplan;

import android.Manifest;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Eatologix: крачкомерът на телефона без гривна и часовник.
 *
 * Хардуерният брояч (TYPE_STEP_COUNTER) брои крачките от последния рестарт.
 * Докато приложението е живо, слушателят е регистриран (с групиране на
 * събитията, без да буди процесора) и на всеки 15 минути записва показание
 * (момент, брояч, момент на включване) в дневник. Докато е затворено, в същия
 * дневник пише NutriStepsReceiver (едно показание малко след полунощ + последно
 * показание при изключване на телефона). JS (activity-tracker.js) разпределя разликите по
 * часове и дни и разпознава рестарта.
 *
 * От Android 10 нататък е нужно разрешението „Физическа активност“
 * (ACTIVITY_RECOGNITION); в манифеста го добавя build-apk.yml.
 */
@CapacitorPlugin(
    name = "NutriSteps",
    permissions = {
        @Permission(strings = { Manifest.permission.ACTIVITY_RECOGNITION }, alias = "activity")
    }
)
public class NutriStepsPlugin extends Plugin implements SensorEventListener {

    private static final long LOG_EVERY_MS = 15 * 60 * 1000L;
    private static final int BATCH_LATENCY_US = 5 * 60 * 1000 * 1000;

    private SensorManager sensorManager;
    private Sensor counter;
    private boolean listening = false;
    private float lastValue = -1f;
    private long lastValueAt = 0L;
    private long lastLoggedAt = 0L;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        counter = sensorManager != null ? sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) : null;
        lastLoggedAt = NutriStepsReceiver.lastLogTime(getContext());
        if (hasActivityPermission()) startListening();
    }

    @Override
    protected void handleOnDestroy() {
        stopListening();
        super.handleOnDestroy();
    }

    private boolean hasActivityPermission() {
        // До Android 10 броячът не иска разрешение.
        return Build.VERSION.SDK_INT < 29 || getPermissionState("activity") == PermissionState.GRANTED;
    }

    private void startListening() {
        if (listening || sensorManager == null || counter == null) return;
        listening = sensorManager.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL, BATCH_LATENCY_US);
        // Показания и при затворено приложение (будилникът се подновява сам).
        NutriStepsReceiver.schedule(getContext());
    }

    private void stopListening() {
        if (!listening || sensorManager == null) return;
        sensorManager.unregisterListener(this);
        listening = false;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.values == null || event.values.length == 0) return;
        // Моментът на събитието (може да е групирано по-рано) в часовника на стената.
        long ageMs = (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1000000L;
        long at = System.currentTimeMillis() - Math.max(0L, ageMs);
        lastValue = event.values[0];
        lastValueAt = at;
        if (at - lastLoggedAt >= LOG_EVERY_MS) {
            NutriStepsReceiver.appendLog(getContext(), at, lastValue);
            lastLoggedAt = at;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // не се ползва
    }

    /**
     * Историята по дни от Google Play services (Recording API): { available, since,
     * days: { "YYYY-MM-DD": steps } }. Без Google или без разрешение — available: false.
     */
    @PluginMethod
    public void history(final PluginCall call) {
        if (!hasActivityPermission()) {
            JSObject out = new JSObject();
            out.put("available", Boolean.FALSE);
            out.put("granted", Boolean.FALSE);
            call.resolve(out);
            return;
        }
        Integer days = call.getInt("days", 10);
        NutriStepsRecording.read(getContext(), days != null ? days.intValue() : 10, new NutriStepsRecording.Done() {
            @Override
            public void result(JSONObject res) {
                try {
                    call.resolve(new JSObject(res.toString()));
                } catch (Exception e) {
                    JSObject out = new JSObject();
                    out.put("available", Boolean.FALSE);
                    call.resolve(out);
                }
            }
        });
    }

    /** Нощното показание: { enabled } — изключва се, когато Health Connect дава крачките. */
    @PluginMethod
    public void setBackground(PluginCall call) {
        Boolean on = call.getBoolean("enabled", Boolean.TRUE);
        NutriStepsReceiver.setBackground(getContext(), on == null || on.booleanValue());
        JSObject out = new JSObject();
        out.put("enabled", Boolean.valueOf(NutriStepsReceiver.backgroundOn(getContext())));
        call.resolve(out);
    }

    /** { available, granted } */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", Boolean.valueOf(counter != null));
        out.put("granted", Boolean.valueOf(hasActivityPermission()));
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasActivityPermission()) {
            startListening();
            JSObject out = new JSObject();
            out.put("granted", Boolean.TRUE);
            call.resolve(out);
            return;
        }
        requestPermissionForAlias("activity", call, "activityPermissionCallback");
    }

    @PermissionCallback
    private void activityPermissionCallback(PluginCall call) {
        boolean granted = hasActivityPermission();
        if (granted) startListening();
        JSObject out = new JSObject();
        out.put("granted", Boolean.valueOf(granted));
        call.resolve(out);
    }

    /**
     * Дневникът от показания след `since` и текущият брояч. Преди отговора
     * групираните събития се изпразват (flush), за да е броячът пресен.
     */
    @PluginMethod
    public void read(final PluginCall call) {
        if (counter == null || !hasActivityPermission()) {
            JSObject out = new JSObject();
            out.put("available", Boolean.valueOf(counter != null));
            out.put("granted", Boolean.valueOf(hasActivityPermission()));
            call.resolve(out);
            return;
        }
        startListening();
        if (sensorManager != null && listening) sensorManager.flush(this);
        final Long sinceArg = call.getLong("since", 0L);
        final long since = sinceArg != null ? sinceArg : 0L;
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                JSObject out = new JSObject();
                out.put("available", Boolean.TRUE);
                out.put("granted", Boolean.TRUE);
                out.put("bootTime", Long.valueOf(NutriStepsReceiver.bootTime()));
                out.put("now", Long.valueOf(lastValueAt > 0 ? lastValueAt : System.currentTimeMillis()));
                if (lastValue >= 0) out.put("counter", Double.valueOf(lastValue));
                JSArray items = new JSArray();
                JSONArray log = NutriStepsReceiver.readLog(getContext());
                for (int i = 0; i < log.length(); i++) {
                    JSONObject x = log.optJSONObject(i);
                    if (x != null && x.optLong("t", 0L) > since) items.put(x);
                }
                out.put("log", items);
                call.resolve(out);
            }
        }, 800);
    }
}
