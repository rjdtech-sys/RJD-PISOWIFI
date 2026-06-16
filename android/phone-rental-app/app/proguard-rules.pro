# Add project specific ProGuard rules here.
# Keep API models
-keep class com.rjdpisowifi.phonerental.network.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Gson
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
