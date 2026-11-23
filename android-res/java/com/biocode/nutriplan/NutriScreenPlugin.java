package com.biocode.nutriplan;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Nutriin: кога телефонът е бил в употреба (екранът включен) — за оценката на съня.
 *
 * Системата вече пази събитията „екранът се включи / изгасна“ (UsageStatsManager,
 * няколко дни назад) — не е нужна услуга на заден план и не се чете какво е
 * правено в приложенията. Нужен е специалният достъп „Достъп до данни за
 * използване“ (PACKAGE_USAGE_STATS), който човекът дава в системните настройки.
 * JS (sleep-signal.js) сам сглобява сесиите в нощна почивка.
 */
@CapacitorPlugin(name = "NutriScreen")
public class NutriScreenPlugin extends Plugin {

    // UsageEvents.Event.SCREEN_INTERACTIVE / SCREEN_NON_INTERACTIVE (API 28)
    private static final int SCREEN_ON = 15;
    private static final int SCREEN_OFF = 16;

    private boolean hasAccess() {
        try {
            AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return false;
            int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    /** { available, granted } — от Android 9 и с дадения достъп. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", Build.VERSION.SDK_INT >= 28);
        out.put("granted", Build.VERSION.SDK_INT >= 28 && hasAccess());
        call.resolve(out);
    }

    /** Отваря „Достъп до данни за използване“ — човекът включва Nutriin. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Настройките не се отвориха.");
        }
    }

    /** Сесиите с включен екран в [from, to] (мс): { granted, sessions: [[начало, край], …] }. */
    @PluginMethod
    public void sessions(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < 28 || !hasAccess()) {
            out.put("granted", Boolean.FALSE);
            out.put("sessions", new JSArray());
            call.resolve(out);
            return;
        }
        long to = call.getLong("to", System.currentTimeMillis());
        long from = call.getLong("from", to - 24L * 3600000L);
        JSArray list = new JSArray();
        try {
            UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            UsageEvents events = usm.queryEvents(from, to);
            UsageEvents.Event e = new UsageEvents.Event();
            long openedAt = -1L;
            boolean first = true;
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
                int type = e.getEventType();
                if (type != SCREEN_ON && type != SCREEN_OFF) continue;
                long t = e.getTimeStamp();
                if (type == SCREEN_ON) {
                    if (openedAt < 0) openedAt = t;
                } else {
                    // Първото събитие „изгасна“ без начало — екранът е светел от началото на прозореца.
                    long start = openedAt >= 0 ? openedAt : (first ? from : -1L);
                    if (start >= 0) {
                        JSArray s = new JSArray();
                        s.put(start);
                        s.put(t);
                        list.put(s);
                    }
                    openedAt = -1L;
                }
                first = false;
            }
            if (openedAt >= 0) {
                JSArray s = new JSArray();
                s.put(openedAt);
                s.put(to);
                list.put(s);
            }
            out.put("granted", Boolean.TRUE);
            out.put("sessions", list);
            call.resolve(out);
        } catch (Exception ex) {
            call.reject("Данните за използване не се прочетоха.");
        }
    }
}
