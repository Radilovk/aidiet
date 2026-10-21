package com.biocode.nutriplan;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.Window;

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
}
