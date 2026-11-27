import UIKit
import Capacitor

/// Главният екран на Nutriin (Main.storyboard го ползва вместо CAPBridgeViewController — ios-res/patch-ios.py):
/// регистрира собствените плъгини на приложението.
class NutriViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NutriPrintPlugin())
    }
}
