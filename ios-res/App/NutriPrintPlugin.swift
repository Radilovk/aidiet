import UIKit
import Capacitor

/// Nutriin: системният диалог за печат на iOS за текущата страница — същото като NutriPrintPlugin.java на Android.
/// WKWebView рендира страницата със стиловете @media print (книгата на плана излиза както в браузъра). От диалога:
/// принтер, или „Сподели“ → „Запази във Файлове“ / изпрати като PDF.
@objc(NutriPrintPlugin)
public class NutriPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NutriPrintPlugin"
    public let jsName = "NutriPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        let jobName = call.getString("name") ?? "Nutriin"
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView, UIPrintInteractionController.isPrintingAvailable else {
                call.reject("Print is not available")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = jobName
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, _, error in
                if let error = error {
                    call.reject("Print failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }
}
