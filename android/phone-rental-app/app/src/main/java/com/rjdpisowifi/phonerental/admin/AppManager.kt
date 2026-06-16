package com.rjdpisowifi.phonerental.admin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.rjdpisowifi.phonerental.network.RentalApiClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Manages which apps are allowed during rental sessions.
 * Uses DevicePolicyManager (device owner) to enable/disable apps.
 * When a rental session starts, only allowed apps are enabled.
 * When a rental session ends, all apps are re-enabled and accounts are logged out.
 */
class AppManager(private val context: Context) {

    companion object {
        private const val TAG = "AppManager"
        private const val PREFS_NAME = "rental_app_config"
        private const val KEY_ALLOWED_APPS = "allowed_apps"
        private const val KEY_ADMIN_PASSWORD = "admin_password"

        // System apps that should NEVER be disabled/suspended
        val PROTECTED_PACKAGES = setOf(
            "android",
            "com.android.systemui",
            "com.android.settings",
            "com.android.phone",
            "com.android.launcher3",
            "com.android.inputmethod.latin",
            "com.android.packageinstaller",
            // "com.android.vending", // Play Store - allow user to whitelist it
            "com.google.android.gms", // GMS - needed for push
            "com.google.android.gsf",
            "com.google.android.backuptransport",
            "com.google.android.providers.settings",
            "com.google.android.ext.services",
            "com.google.android.ext.shared",
            "com.google.android.webview",
            "com.google.android.permissioncontroller",
            // Our app - NEVER disable
            "com.rjdpisowifi.phonerental"
        )

        // Apps to force-stop and clear data on session end (social/game accounts)
        val ACCOUNT_LOGOUT_PACKAGES = setOf(
            "com.facebook.katana",       // Facebook
            "com.facebook.lite",         // Facebook Lite
            "com.facebook.orca",         // Messenger
            "com.facebook.mlite",        // Messenger Lite
            "com.mobile.legends",        // Mobile Legends
            "com.riotgames.league.wildrift", // Wild Rift
            "com.garena.game.kgth",      // Free Fire
            "com.tencent.ig",            // PUBG Mobile
            "com.vng.pubgmobile",        // PUBG Mobile (VN)
            "com.roblox.client",         // Roblox
            "com.supercell.clashofclans", // Clash of Clans
            "com.supercell.clashroyale",  // Clash Royale
            "com.nianticlabs.pokemongo",  // Pokemon GO
            "com.zhiliaoapp.musically",   // TikTok
            "com.ss.android.ugc.trill",   // TikTok (alt)
            "com.instagram.android",       // Instagram
            "com.twitter.android",         // Twitter/X
            "com.snapchat.android",        // Snapchat
            "com.viber.voip",              // Viber
            "com.whatsapp",                // WhatsApp
            "org.telegram.messenger",      // Telegram
            "com.google.android.gm",       // Gmail
            "com.google.android.youtube",  // YouTube
            "com.google.android.apps.docs", // Google Docs
            "com.android.vending"          // Play Store
        )
    }

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val dpm by lazy {
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    }

    private val adminComponent by lazy {
        ComponentName(context, KioskDeviceAdmin::class.java)
    }

    var adminPassword: String
        get() = prefs.getString(KEY_ADMIN_PASSWORD, "1234") ?: "1234"
        set(value) = prefs.edit().putString(KEY_ADMIN_PASSWORD, value).apply()

    fun isAdmin(): Boolean = dpm.isAdminActive(adminComponent)
    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    private fun showToast(message: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }

    /**
     * Get ALL installed apps - NO restrictions on detection.
     * Uses getInstalledApplications() as PRIMARY method to see EVERY package.
     * Shows all non-critical apps so admin can choose which to allow.
     */
    fun getInstalledApps(): List<AppInfo> {
        val pm = context.packageManager
        val apps = mutableListOf<AppInfo>()
        val allowedPackages = getAllowedAppPackages()
        val seenPackages = mutableSetOf<String>()

        // PRIMARY: getInstalledApplications - sees ALL packages with QUERY_ALL_PACKAGES
        try {
            val installedApps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getInstalledApplications(0)
            }

            for (appInfo in installedApps) {
                val packageName = appInfo.packageName
                if (packageName in seenPackages) continue
                seenPackages.add(packageName)
                if (packageName in PROTECTED_PACKAGES) continue
                if (packageName == context.packageName) continue

                val label = appInfo.loadLabel(pm)?.toString() ?: ""
                val isSystemApp = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0

                // Include ALL user-installed apps and any system app that has an icon
                // This is the key: do NOT filter by getLaunchIntentForPackage()
                // because it's unreliable on OEM ROMs like TECNO HiOS
                val isUserApp = !isSystemApp
                val hasIcon = try { appInfo.loadIcon(pm) != null } catch (e: Exception) { false }
                val hasLabel = label.isNotEmpty() && label != packageName

                // Show: user apps, or system apps with icon+label (user-visible)
                if (isUserApp || (hasIcon && hasLabel)) {
                    apps.add(AppInfo(
                        packageName = packageName,
                        label = if (label.isNotEmpty()) label else packageName,
                        isAllowed = allowedPackages.contains(packageName),
                        isSystemApp = isSystemApp,
                        isEnabled = appInfo.enabled
                    ))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "getInstalledApplications failed: ${e.message}")
        }

        // SUPPLEMENT: queryIntentActivities (may find apps missed above)
        try {
            val launcherIntent = Intent(Intent.ACTION_MAIN)
            launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER)
            val launcherApps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(launcherIntent, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(launcherIntent, 0)
            }

            for (resolveInfo in launcherApps) {
                val packageName = resolveInfo.activityInfo.packageName
                if (packageName in seenPackages) continue
                seenPackages.add(packageName)
                if (packageName in PROTECTED_PACKAGES) continue
                if (packageName == context.packageName) continue

                try {
                    val appInfo = pm.getApplicationInfo(packageName, 0)
                    val label = resolveInfo.loadLabel(pm)?.toString()
                        ?: appInfo.loadLabel(pm)?.toString()
                        ?: packageName
                    val isSystemApp = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                    apps.add(AppInfo(
                        packageName = packageName,
                        label = label,
                        isAllowed = allowedPackages.contains(packageName),
                        isSystemApp = isSystemApp,
                        isEnabled = appInfo.enabled
                    ))
                } catch (e: Exception) {
                    // Skip
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "queryIntentActivities failed: ${e.message}")
        }

        // FALLBACK: Known packages brute-force check
        val knownPackages = listOf(
            "com.facebook.katana", "com.facebook.lite", "com.facebook.orca", "com.facebook.mlite",
            "com.mobile.legends", "com.riotgames.league.wildrift", "com.garena.game.kgth",
            "com.tencent.ig", "com.vng.pubgmobile", "com.roblox.client",
            "com.supercell.clashofclans", "com.supercell.clashroyale", "com.supercell.brawlstars",
            "com.nianticlabs.pokemongo", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
            "com.tiktok.lite", "com.instagram.android", "com.twitter.android", "com.snapchat.android",
            "com.viber.voip", "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
            "com.google.android.gm", "com.google.android.youtube", "com.google.android.apps.docs",
            "com.android.chrome", "com.google.android.apps.maps", "com.android.vending",
            "com.spotify.music", "com.netflix.mediaclient", "com.amazon.mShop.android.shopping",
            "com.shopee.ph", "com.lazada.android", "com.discord", "com.reddit.frontpage",
            "com.google.android.apps.photos", "com.google.android.calendar", "com.google.android.keep",
            "com.google.android.apps.translate", "com.google.android.apps.messaging",
            "com.google.android.deskclock", "com.google.android.contacts", "com.google.android.dialer",
            "com.microsoft.office.outlook", "com.microsoft.teams", "com.skype.raider",
            "com.mojang.minecraftpe", "com.ea.game.pvz2_row", "com.king.candycrushsaga",
            "com.brave.browser", "com.duckduckgo.mobile.android", "com.opera.browser", "com.opera.mini.native",
            "ph.com.globe.globeone", "com.gcash.android", "com.paymaya", "com.mynt.maya",
            "com.pinterest", "com.strava", "com.amazon.kindle", "com.audible.application"
        )

        for (pkg in knownPackages) {
            if (pkg in seenPackages) continue
            seenPackages.add(pkg)
            try {
                val appInfo = pm.getApplicationInfo(pkg, 0)
                val label = appInfo.loadLabel(pm)?.toString() ?: pkg
                val isSystemApp = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                apps.add(AppInfo(
                    packageName = pkg,
                    label = if (label.isNotEmpty()) label else pkg,
                    isAllowed = allowedPackages.contains(pkg),
                    isSystemApp = isSystemApp,
                    isEnabled = appInfo.enabled
                ))
            } catch (e: Exception) {
                // Not installed, skip
            }
        }

        return apps.sortedWith(compareBy({ !it.isAllowed }, { it.label.lowercase() }))
    }

    /**
     * Get the list of allowed app packages for rental
     */
    fun getAllowedAppPackages(): Set<String> {
        val json = prefs.getString(KEY_ALLOWED_APPS, null) ?: return emptySet()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { arr.getString(it) }.toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }

    /**
     * Save the list of allowed app packages
     */
    fun saveAllowedAppPackages(packages: Set<String>) {
        val arr = JSONArray()
        packages.sorted().forEach { arr.put(it) }
        prefs.edit().putString(KEY_ALLOWED_APPS, arr.toString()).apply()
    }

    /**
     * Sync allowed apps from server and merge with local config.
     * Called on startup and when Admin Panel opens.
     */
    suspend fun syncAllowedAppsFromServer() {
        try {
            val apiClient = RentalApiClient(context)
            val result = apiClient.getAllowedApps()
            if (result.isSuccess) {
                val serverApps = result.getOrNull() ?: emptyList()
                if (serverApps.isNotEmpty()) {
                    val localApps = getAllowedAppPackages()
                    val merged = (localApps + serverApps.toSet())
                    saveAllowedAppPackages(merged)
                    Log.i(TAG, "Synced allowed apps from server: ${serverApps.size} server, ${localApps.size} local, ${merged.size} merged")
                } else {
                    Log.d(TAG, "No allowed apps configured on server")
                }
            } else {
                Log.w(TAG, "Failed to sync allowed apps: ${result.exceptionOrNull()?.message}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error syncing allowed apps: ${e.message}")
        }
    }

    /**
     * Toggle an app as allowed/not allowed for rental
     */
    fun toggleAllowedApp(packageName: String): Boolean {
        val current = getAllowedAppPackages().toMutableSet()
        if (current.contains(packageName)) {
            current.remove(packageName)
        } else {
            current.add(packageName)
        }
        saveAllowedAppPackages(current)
        return current.contains(packageName)
    }

    /**
     * Enable only allowed apps when rental starts. Disable all others.
     * Uses DevicePolicyManager setPackagesSuspended (device owner only).
     * Without device owner, this does nothing silently.
     */
    suspend fun applyRentalAppRestrictions() {
        if (!isDeviceOwner()) {
            Log.w(TAG, "Not device owner - skipping app restrictions (optional feature)")
            return
        }

        // Try to sync allowed apps from server
        try {
            val apiClient = RentalApiClient(context)
            val result = apiClient.getAllowedApps()
            if (result.isSuccess) {
                val serverApps = result.getOrNull() ?: emptyList()
                if (serverApps.isNotEmpty()) {
                    saveAllowedAppPackages(serverApps.toSet())
                    Log.i(TAG, "Synced ${serverApps.size} allowed apps from server")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not sync apps from server: ${e.message}")
        }

        val allowedApps = getAllowedAppPackages()
        val allApps = getInstalledApps()

        for (app in allApps) {
            if (app.packageName in PROTECTED_PACKAGES) continue

            try {
                if (app.packageName in allowedApps) {
                    // Enable allowed app
                    dpm.enableSystemApp(adminComponent, app.packageName)
                    Log.d(TAG, "Enabled: ${app.packageName}")
                } else {
                    // Disable non-allowed app
                    dpm.setPackagesSuspended(adminComponent, arrayOf(app.packageName), true)
                    Log.d(TAG, "Suspended: ${app.packageName}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set app state for ${app.packageName}: ${e.message}")
            }
        }

        showToast("Restrictions applied: ${allowedApps.size} apps allowed")
        Log.i(TAG, "Rental app restrictions applied: ${allowedApps.size} apps allowed")
    }

    /**
     * Remove all app restrictions when rental ends.
     * Re-enable all apps and log out accounts.
     * Without device owner, this does nothing silently.
     */
    suspend fun removeRentalAppRestrictions() {
        if (!isDeviceOwner()) {
            Log.w(TAG, "Not device owner - skipping restriction removal (optional feature)")
            return
        }

        val allApps = getInstalledApps()

        // Un-suspend all apps
        for (app in allApps) {
            try {
                dpm.setPackagesSuspended(adminComponent, arrayOf(app.packageName), false)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unsuspend ${app.packageName}: ${e.message}")
            }
        }

        // Log out accounts from social/game apps
        logoutAllAccounts()

        showToast("All restrictions removed")
        Log.i(TAG, "Rental app restrictions removed - all apps re-enabled")
    }

    /**
     * Log out accounts from known apps by clearing app data.
     * This effectively signs out Facebook, Google, game accounts, etc.
     * Without device owner, this does nothing silently.
     */
    fun logoutAllAccounts() {
        if (!isDeviceOwner()) {
            Log.w(TAG, "Not device owner - skipping account logout (optional feature)")
            return
        }

        var clearedCount = 0
        for (pkg in ACCOUNT_LOGOUT_PACKAGES) {
            try {
                // Check if app is installed
                context.packageManager.getPackageInfo(pkg, 0)

                // Clear app data (logs out accounts)
                dpm.clearApplicationUserData(adminComponent, pkg, Executors.newSingleThreadExecutor(), object : DevicePolicyManager.OnClearApplicationUserDataListener {
                    override fun onApplicationUserDataCleared(packageName: String, succeeded: Boolean) {
                        if (succeeded) {
                            Log.i(TAG, "Cleared data for $pkg - account logged out")
                        } else {
                            Log.w(TAG, "Failed to clear data for $pkg")
                        }
                    }
                })
                clearedCount++
            } catch (e: Exception) {
                // App not installed, skip
            }
        }

        // Also remove Google accounts programmatically
        removeGoogleAccounts()

        showToast("Cleared data for $clearedCount apps")
    }

    /**
     * Remove all Google accounts from the device
     */
    private fun removeGoogleAccounts() {
        try {
            val accountManager = android.accounts.AccountManager.get(context)
            val accounts = accountManager.accounts
            for (account in accounts) {
                if (account.type == "com.google" || account.type == "com.google.android.gsf") {
                    try {
                        // On device owner, we can use setAccountManagementDisabled
                        Log.d(TAG, "Google account found: ${account.name} - disabling management")
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not remove account: ${e.message}")
                    }
                }
            }

            // Disable Google account addition
            dpm.setAccountManagementDisabled(adminComponent, "com.google", true)

            // Re-enable after a short delay (to allow re-login if needed for next rental)
            Handler(Looper.getMainLooper()).postDelayed({
                try {
                    dpm.setAccountManagementDisabled(adminComponent, "com.google", false)
                } catch (e: Exception) { }
            }, 5000)

        } catch (e: Exception) {
            Log.e(TAG, "Error managing accounts: ${e.message}")
        }
    }

    /**
     * Get the list of commonly used apps for quick selection
     */
    fun getCommonApps(): List<AppInfo> {
        val commonPackages = mapOf(
            "com.facebook.katana" to "Facebook",
            "com.facebook.orca" to "Messenger",
            "com.mobile.legends" to "Mobile Legends",
            "com.roblox.client" to "Roblox",
            "com.zhiliaoapp.musically" to "TikTok",
            "com.ss.android.ugc.trill" to "TikTok",
            "com.instagram.android" to "Instagram",
            "com.google.android.youtube" to "YouTube",
            "com.twitter.android" to "X (Twitter)",
            "com.snapchat.android" to "Snapchat",
            "com.whatsapp" to "WhatsApp",
            "com.viber.voip" to "Viber",
            "org.telegram.messenger" to "Telegram",
            "com.garena.game.kgth" to "Free Fire",
            "com.tencent.ig" to "PUBG Mobile",
            "com.riotgames.league.wildrift" to "Wild Rift",
            "com.supercell.clashofclans" to "Clash of Clans",
            "com.supercell.clashroyale" to "Clash Royale",
            "com.nianticlabs.pokemongo" to "Pokemon GO",
            "com.google.android.gm" to "Gmail",
            "com.android.chrome" to "Chrome",
            "com.google.android.apps.maps" to "Google Maps",
            "com.android.vending" to "Play Store",
            "com.spotify.music" to "Spotify",
            "com.netflix.mediaclient" to "Netflix"
        )

        val allowed = getAllowedAppPackages()

        return commonPackages.mapNotNull { (pkg, label) ->
            try {
                context.packageManager.getPackageInfo(pkg, 0)
                AppInfo(pkg, label, allowed.contains(pkg), false, true)
            } catch (e: Exception) {
                null // Not installed
            }
        }
    }
}

data class AppInfo(
    val packageName: String,
    val label: String,
    val isAllowed: Boolean,
    val isSystemApp: Boolean,
    val isEnabled: Boolean
)
