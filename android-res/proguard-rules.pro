# NutriPlan ProGuard / R8 rules

# ── Capacitor core ────────────────────────────────────────────────────────────
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin { *; }

# ── Google Sign-In (capacitor-google-auth / Play Services Auth) ────────────────
-keep class com.codetrixstudio.** { *; }
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep class com.google.android.gms.signin.** { *; }
-dontwarn com.google.android.gms.**

# ── Google API client (Drive REST) ────────────────────────────────────────────
-keep class com.google.api.** { *; }
-dontwarn com.google.api.**

# ── Capacitor plugins bundled in this APK ────────────────────────────────────
-keep class com.capacitorjs.plugins.** { *; }
-keep class ee.forgr.capacitor.** { *; }

# ── NutriPlan notification action receiver (patched into local-notifications plugin) ─
-keep class com.capacitorjs.plugins.localnotifications.GameNotificationActionReceiver { *; }

# ── General Android / Kotlin reflection safety ────────────────────────────────
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses,EnclosingMethod
