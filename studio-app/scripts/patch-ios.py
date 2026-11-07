#!/usr/bin/env python3
"""iOS project of the studio app: the few things the Capacitor template does not do for the App Store.

Run in studio-app/ after `npx cap add ios`. Only changes what is needed (idempotent):
  - ITSAppUsesNonExemptEncryption = false  (the app only uses HTTPS: no export-compliance questions on every upload)
  - UIRequiredDeviceCapabilities armv7 → arm64  (the template still says armv7; App Store Connect wants 64-bit)
  - iPhone only, portrait  (no iPad screenshots / layouts to maintain)
  - the name under the icon: "XB-Studio" (short enough not to be cut)
  - AppDelegate: hands the APNs device token to Capacitor's push plugin (the two methods its docs ask for)
"""
import plistlib
import sys
from pathlib import Path

plist_path = Path("ios/App/App/Info.plist")
if not plist_path.exists():
    sys.exit("ios/App/App/Info.plist not found — run `npx cap add ios` first")

with plist_path.open("rb") as f:
    info = plistlib.load(f)

info["ITSAppUsesNonExemptEncryption"] = False
info["UIRequiredDeviceCapabilities"] = ["arm64"]
info["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
info.pop("UISupportedInterfaceOrientations~ipad", None)
info["CFBundleDisplayName"] = "XB-Studio"

with plist_path.open("wb") as f:
    plistlib.dump(info, f)
print("Info.plist: encryption flag, arm64, portrait, display name")

# push: the device token (or the failure) goes to @capacitor/push-notifications
delegate = Path("ios/App/App/AppDelegate.swift")
src = delegate.read_text()
if "capacitorDidRegisterForRemoteNotifications" not in src:
    methods = """
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
"""
    end = src.rstrip().rfind("}")
    if end < 0:
        sys.exit("AppDelegate.swift: no class end found")
    src = src[:end] + methods + src[end:]
    delegate.write_text(src)
    print("AppDelegate.swift: push token methods")
