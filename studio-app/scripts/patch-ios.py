#!/usr/bin/env python3
"""iOS project of the studio app: the few things the Capacitor template does not do for the App Store.

Run in studio-app/ after `npx cap add ios`. Only changes what is needed (idempotent):
  - ITSAppUsesNonExemptEncryption = false  (the app only uses HTTPS: no export-compliance questions on every upload)
  - UIRequiredDeviceCapabilities armv7 → arm64  (the template still says armv7; App Store Connect wants 64-bit)
  - iPhone only, portrait  (no iPad screenshots / layouts to maintain)
  - the name under the icon: short, so it is not cut ("Записване"); the store name stays "Студио записване"
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
info["CFBundleDisplayName"] = "Записване"

with plist_path.open("wb") as f:
    plistlib.dump(info, f)
print("Info.plist: encryption flag, arm64, portrait, display name")
