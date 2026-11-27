#!/usr/bin/env python3
"""iOS проектът на Nutriin: малкото, което шаблонът на Capacitor не прави за App Store.

Пуска се от корена след `npx cap add ios` (build-ios.yml). Идемпотентно.
  - Info.plist: без криптиране извън HTTPS, arm64, само вертикално, името под иконата,
    обясненията за камерата и снимките (Apple отказва качване без тях, щом има плъгин за камера)
  - иконата и стартовият екран от ios-res/ (scripts/build-ios-assets.mjs)
"""
import plistlib
import shutil
import sys
from pathlib import Path

APP = Path("ios/App/App")
RES = Path("ios-res")
plist_path = APP / "Info.plist"
if not plist_path.exists():
    sys.exit("ios/App/App/Info.plist not found — run `npx cap add ios` first")

with plist_path.open("rb") as f:
    info = plistlib.load(f)

info["ITSAppUsesNonExemptEncryption"] = False
info["UIRequiredDeviceCapabilities"] = ["arm64"]
info["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
info.pop("UISupportedInterfaceOrientations~ipad", None)
info["CFBundleDisplayName"] = "Nutriin"
# Езиците на приложението (i18n.js) — системните диалози и App Store показват, че ги има
info["CFBundleLocalizations"] = ["bg", "en", "de", "es", "ru"]
info["NSCameraUsageDescription"] = (
    "Nutriin uses the camera only when you choose to take a photo of your plate, a restaurant menu "
    "or a lab result, so it can estimate the meal or read the document for your plan.")
info["NSPhotoLibraryUsageDescription"] = (
    "Nutriin opens your photos only when you choose a picture of a meal, a menu or a document to add to your plan.")
info["NSPhotoLibraryAddUsageDescription"] = (
    "Nutriin saves to your photos only when you choose to save an image of your plan.")

with plist_path.open("wb") as f:
    plistlib.dump(info, f)
print("Info.plist: encryption flag, arm64, portrait, name, languages, camera/photos purpose strings")

# иконата (1024, без алфа канал) и стартовият екран
icon_dir = APP / "Assets.xcassets" / "AppIcon.appiconset"
icons = sorted(icon_dir.glob("*.png"))
if not icons:
    sys.exit(f"{icon_dir}: no icon file in the template")
for p in icons:
    shutil.copyfile(RES / "AppIcon-1024.png", p)
splashes = sorted((APP / "Assets.xcassets" / "Splash.imageset").glob("*.png"))
for p in splashes:
    shutil.copyfile(RES / "splash-2732.png", p)
print(f"icon → {', '.join(p.name for p in icons)}; splash → {len(splashes)} files")
