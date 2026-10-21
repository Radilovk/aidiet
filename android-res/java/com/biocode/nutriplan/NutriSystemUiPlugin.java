package com.biocode.nutriplan;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.Window;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NutriPlan: фонът зад системните ленти следва темата на приложението.
 *
 * WebView-то е отместено с височината на лентите (SystemBars на Capacitor), а
 * под тях се вижда фонът на прозореца. Без това той е фонът по подразбиране на
 * темата на Android (#303030 в тъмна) — сива ивица над и под приложението.
 * Темата в приложението е отделна от тази на телефона, затова цветът идва от JS.
 *
 * Също: кои здравни приложения има на телефона (за предложението да се
 * свържат през Health Connect) и отварянето им / страницата им в Google Play.
 * Пакетите трябва да са и в <queries> на манифеста (patch-health-connect.py).
 */
@CapacitorPlugin(name = "NutriSystemUi")
public class NutriSystemUiPlugin extends Plugin {

    @PluginMethod
    public void setBackground(final PluginCall call) {
        final String value = call.getString("color", "");
        final int color;
        try {
            color = Color.parseColor(value);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + value);
            return;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Window window = getActivity().getWindow();
                window.setBackgroundDrawable(new ColorDrawable(color));
                View decor = window.getDecorView();
                decor.setBackgroundColor(color);
                View parent = (View) getBridge().getWebView().getParent();
                if (parent != null) parent.setBackgroundColor(color);
                call.resolve();
            }
        });
    }

    /** Кои от подадените пакети са инсталирани, плюс марката на телефона. */
    @PluginMethod
    public void installedApps(final PluginCall call) {
        JSArray packages = call.getArray("packages", new JSArray());
        PackageManager pm = getContext().getPackageManager();
        JSArray installed = new JSArray();
        for (int i = 0; i < packages.length(); i++) {
            String pkg = packages.optString(i, "");
            if (pkg.isEmpty()) continue;
            try {
                pm.getPackageInfo(pkg, 0);
                installed.put(pkg);
            } catch (PackageManager.NameNotFoundException ignored) {
                // не е инсталиран
            }
        }
        JSObject out = new JSObject();
        out.put("installed", installed);
        out.put("manufacturer", Build.MANUFACTURER);
        out.put("brand", Build.BRAND);
        out.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(out);
    }

    /** Отваря инсталирано приложение (напр. Samsung Health за включване на Health Connect). */
    @PluginMethod
    public void openApp(final PluginCall call) {
        String pkg = call.getString("package", "");
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (intent == null) {
            call.reject("App not installed: " + pkg);
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Страницата на приложението в Google Play (напр. Health Connect на Android 9–13). */
    @PluginMethod
    public void openStore(final PluginCall call) {
        String pkg = call.getString("package", "");
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (android.content.ActivityNotFoundException e) {
            Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
            web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(web);
        }
        call.resolve();
    }
}
