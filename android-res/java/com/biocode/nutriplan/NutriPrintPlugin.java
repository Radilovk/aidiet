package com.biocode.nutriplan;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NutriPlan: системният диалог за печат на Android за текущата страница.
 * В него е и „Запази като PDF“. WebView-то рендира страницата със стиловете
 * @media print, така че книгата с плана излиза както в браузъра.
 */
@CapacitorPlugin(name = "NutriPrint")
public class NutriPrintPlugin extends Plugin {

    @PluginMethod
    public void print(final PluginCall call) {
        final String jobName = call.getString("name", "NutriPlan");
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    WebView webView = getBridge().getWebView();
                    if (printManager == null || webView == null) {
                        call.reject("Print is not available");
                        return;
                    }
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                    PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .build();
                    printManager.print(jobName, adapter, attributes);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Print failed: " + e.getMessage());
                }
            }
        });
    }
}
