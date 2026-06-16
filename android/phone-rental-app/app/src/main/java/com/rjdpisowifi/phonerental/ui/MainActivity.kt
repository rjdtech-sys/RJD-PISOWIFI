package com.rjdpisowifi.phonerental.ui

import android.app.admin.DevicePolicyManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject
import com.rjdpisowifi.phonerental.R
import com.rjdpisowifi.phonerental.admin.KioskDeviceAdmin
import com.rjdpisowifi.phonerental.admin.AdminActivity
import com.rjdpisowifi.phonerental.admin.AppManager
import com.rjdpisowifi.phonerental.admin.AppInfo
import com.rjdpisowifi.phonerental.network.RentalApiClient
import com.rjdpisowifi.phonerental.network.RentalSessionInfo
import com.rjdpisowifi.phonerental.network.RentalRate
import com.rjdpisowifi.phonerental.network.CoinslotDevice
import com.rjdpisowifi.phonerental.service.HeartbeatWorker
import com.rjdpisowifi.phonerental.service.StatusBarBlockerService
import com.rjdpisowifi.phonerental.service.TimerService
import com.rjdpisowifi.phonerental.util.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

/**
 * Main Activity - The default launcher and kiosk screen
 * Shows the rental timer when a session is active,
 * or an idle screen when the device is available
 */
class MainActivity : AppCompatActivity() {

    private lateinit var apiClient: RentalApiClient
    private lateinit var appManager: AppManager
    private val scope = CoroutineScope(Dispatchers.Main)

    // Views
    private lateinit var timerDisplay: TextView
    private lateinit var statusLabel: TextView
    private lateinit var deviceNameLabel: TextView
    private lateinit var customerNameLabel: TextView
    private lateinit var rateLabel: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var idleContainer: LinearLayout
    private lateinit var activeContainer: LinearLayout
    private lateinit var expiredContainer: LinearLayout
    private lateinit var setupButton: Button
    private lateinit var connectionStatus: TextView
    private lateinit var appLauncherGrid: RecyclerView
    private lateinit var insertCoinButton: Button
    private lateinit var donePayingButton: Button
    private lateinit var coinAccumulatedLabel: TextView
    private lateinit var coinTimeLabel: TextView
    private lateinit var wallpaperImage: ImageView
    private lateinit var adminButton: Button
    private lateinit var refreshStatusBtn: Button
    private lateinit var addTimeButton: Button

    private var wallpaperManager: com.rjdpisowifi.phonerental.util.WallpaperManager? = null

    private var activeSession: RentalSessionInfo? = null
    private var timerHandler: Handler? = null
    private var timerRunnable: Runnable? = null
    private var expiredRefreshHandler: Handler? = null
    private var expiredRefreshRunnable: Runnable? = null

    private var isLaunchingAllowedApp = false
    private var isOpeningAdminPanel = false
    private var immersiveHandler: Handler? = null
    private var immersiveRunnable: Runnable? = null
    private var statusBarBlocker: View? = null
    private var hasCheckedForUpdate = false

    // Coin insertion state
    private var accumulatedPesos: Int = 0
    private var accumulatedMinutes: Int = 0
    private var rentalRates: List<RentalRate> = emptyList()
    private var selectedCoinslot: CoinslotDevice? = null
    private var isListeningForPulse: Boolean = false

    // Add Time modal
    private var addTimeDialog: android.app.AlertDialog? = null
    private var modalCountdownHandler: Handler? = null
    private var modalCountdownRunnable: Runnable? = null
    private var modalCountdownSeconds: Int = 60
    private var modalPesosView: TextView? = null
    private var modalMinutesView: TextView? = null
    private var modalCountdownView: TextView? = null
    private var modalCoinslotView: TextView? = null
    private var modalConnectionDot: View? = null
    private var modalConnectionStatus: TextView? = null
    private var modalDonePayingBtn: Button? = null

    // Insert Coin modal
    private var insertCoinDialog: android.app.AlertDialog? = null
    private var insertCountdownHandler: Handler? = null
    private var insertCountdownRunnable: Runnable? = null
    private var insertCountdownSeconds: Int = 60
    private var insertModalPesosView: TextView? = null
    private var insertModalMinutesView: TextView? = null
    private var insertModalCountdownView: TextView? = null
    private var insertModalCoinslotView: TextView? = null
    private var insertModalDonePayingBtn: Button? = null

    // Session expired receiver
    private val expiredReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.rjdpisowifi.phonerental.SESSION_EXPIRED") {
                runOnUiThread { showExpiredState() }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            // Keep screen on
            window.addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )

            // TEMPORARILY DISABLED: Full immersive mode
            // This will be re-enabled when Device Owner kiosk mode is set up.
            // For now, keep normal status bar and navigation so the app works like a regular app.
            //
            // try {
            //     if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { ... }
            //     else { ... }
            // } catch (e: Exception) { ... }
            // Log.d(TAG, "Running in normal mode with system bars visible")

            setContentView(R.layout.activity_main)

            // Initialize WallpaperManager
            wallpaperManager = com.rjdpisowifi.phonerental.util.WallpaperManager(this)
            wallpaperImage = findViewById(R.id.wallpaperImage)
            
            // Load wallpaper in background
            scope.launch {
                loadAndDisplayWallpaper()
            }

            apiClient = RentalApiClient(this)

            // Bind views
            timerDisplay = findViewById(R.id.timerDisplay)
            statusLabel = findViewById(R.id.statusLabel)
            deviceNameLabel = findViewById(R.id.deviceNameLabel)
            customerNameLabel = findViewById(R.id.customerNameLabel)
            rateLabel = findViewById(R.id.rateLabel)
            progressBar = findViewById(R.id.progressBar)
            idleContainer = findViewById(R.id.idleContainer)
            activeContainer = findViewById(R.id.activeContainer)
            expiredContainer = findViewById(R.id.expiredContainer)
            setupButton = findViewById(R.id.setupButton)
            connectionStatus = findViewById(R.id.connectionStatus)
            appLauncherGrid = findViewById(R.id.appLauncherGrid)
            insertCoinButton = findViewById(R.id.insertCoinButton)
            donePayingButton = findViewById(R.id.donePayingButton)
            coinAccumulatedLabel = findViewById(R.id.coinAccumulatedLabel)
            coinTimeLabel = findViewById(R.id.coinTimeLabel)
            adminButton = findViewById(R.id.adminButton)
            refreshStatusBtn = findViewById(R.id.refreshStatusBtn)
            addTimeButton = findViewById(R.id.addTimeButton)

            // Admin button click (easy access)
            adminButton.setOnClickListener {
                showAdminLoginDialog()
            }

            // Refresh status button (on expired screen)
            refreshStatusBtn.setOnClickListener {
                Toast.makeText(this, "Checking availability...", Toast.LENGTH_SHORT).show()
                checkDeviceStatus()
            }

            // Add Time button (top-up during active session)
            addTimeButton.setOnClickListener {
                showCoinInsertionModalForTopUp()
            }

            setupButton.setOnClickListener {
                startActivity(Intent(this, SetupActivity::class.java))
            }

            // Insert Coin button click
            insertCoinButton.setOnClickListener {
                showCoinInsertionModal()
            }

            // Done Paying button click
            donePayingButton.setOnClickListener {
                if (activeSession != null) {
                    extendRentalSessionWithCoins()
                } else {
                    startRentalSessionWithCoins()
                }
            }

            // Admin access: Long press on status label opens Admin panel
            appManager = AppManager(this)
            statusLabel.setOnLongClickListener {
                isOpeningAdminPanel = true
                startActivity(Intent(this, AdminActivity::class.java))
                Handler(Looper.getMainLooper()).postDelayed({
                    isOpeningAdminPanel = false
                }, 1000)
                true
            }

            // Admin access: Long press on timer display too
            timerDisplay.setOnLongClickListener {
                isOpeningAdminPanel = true
                startActivity(Intent(this, AdminActivity::class.java))
                Handler(Looper.getMainLooper()).postDelayed({
                    isOpeningAdminPanel = false
                }, 1000)
                true
            }

            // Start kiosk mode
            startKioskMode()

            // Request SYSTEM_ALERT_WINDOW permission for status bar blocking overlay
            requestOverlayPermissionIfNeeded()

            // Register for session expired broadcasts
            val filter = IntentFilter("com.rjdpisowifi.phonerental.SESSION_EXPIRED")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(expiredReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(expiredReceiver, filter)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fatal error in onCreate", e)
            // Show error but don't crash
            Toast.makeText(this, "Error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onResume() {
        super.onResume()

        // Check status (safe - handles its own errors)
        try {
            checkDeviceStatus()
        } catch (e: Exception) {
            Log.e(TAG, "Error checking device status", e)
        }
        
        // Refresh wallpaper on resume
        scope.launch {
            try {
                loadAndDisplayWallpaper()
            } catch (e: Exception) {
                Log.e(TAG, "Error loading wallpaper in onResume", e)
            }
        }

        // Start heartbeat
        try {
            HeartbeatWorker.schedule(this)
        } catch (e: Exception) {
            Log.e(TAG, "Error scheduling heartbeat", e)
        }

        // OTA update check disabled - use manual check from admin panel only
        // This prevents update loops
        /*
        if (!hasCheckedForUpdate) {
            hasCheckedForUpdate = true
            scope.launch {
                try {
                    AppUpdater(this@MainActivity, apiClient.serverUrl).checkAndUpdate(
                        onUpdateAvailable = { version ->
                            Toast.makeText(
                                this@MainActivity,
                                "Updating to v$version... Please wait.",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "OTA update check failed (non-fatal): ${e.message}")
                }
            }
        }
        */
    }

    override fun onPause() {
        super.onPause()
        // Don't stop heartbeat - keep checking in background
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(expiredReceiver) } catch (e: Exception) { }
        timerHandler?.removeCallbacks(timerRunnable ?: return)
        stopCountdown()
        stopPersistentImmersiveMode()
        // Stop overlay service when app is destroyed
        StatusBarBlockerService.stop(this)
    }

    override fun onBackPressed() {
        // In active rental session, ignore back button to stay in kiosk mode
        if (activeSession != null) {
            return
        }
        super.onBackPressed()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        
        // Bring back to this app when HOME is pressed:
        // - During active rental session
        // - During idle state (no session)
        // - During expired session
        // BUT NOT when intentionally launching an allowed app or opening admin panel
        if (!isLaunchingAllowedApp && !isOpeningAdminPanel) {
            Log.d(TAG, "HOME button pressed - bringing rental app back to foreground")
            
            // Small delay to let HOME animation complete
            Handler(Looper.getMainLooper()).postDelayed({
                val intent = Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
                startActivity(intent)
            }, 200)
        } else {
            Log.d(TAG, "onUserLeaveHint - user launching allowed app or admin panel, allowing")
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && activeSession != null && activeSession?.status != "paused") {
            try { hideSystemUI() } catch (e: Exception) { }
        }
    }

    private fun hideSystemUI() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.let { controller ->
                    controller.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                }
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                )
            }
        } catch (e: Exception) {
            // Fallback for OEM ROMs with broken WindowInsetsController (e.g. TECNO HiOS)
            try {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                )
            } catch (e2: Exception) {
                Log.w(TAG, "Could not hide system UI", e2)
            }
        }
    }

    /**
     * Start persistent immersive mode - constantly re-hides system UI every 500ms.
     * This prevents user from accessing status bar (notification slider) and navigation bar (recent button).
     */
    private fun startPersistentImmersiveMode() {
        stopPersistentImmersiveMode() // Stop any existing

        immersiveHandler = Handler(Looper.getMainLooper())
        immersiveRunnable = object : Runnable {
            override fun run() {
                if (activeSession != null && activeSession?.status != "paused") {
                    hideSystemUI()
                    immersiveHandler?.postDelayed(this, 500)
                }
            }
        }
        hideSystemUI()
        addStatusBarBlocker()
        immersiveHandler?.postDelayed(immersiveRunnable!!, 500)
        Log.d(TAG, "Persistent immersive mode started")
    }

    /**
     * Stop persistent immersive mode.
     */
    private fun stopPersistentImmersiveMode() {
        immersiveRunnable?.let { immersiveHandler?.removeCallbacks(it) }
        immersiveRunnable = null
        immersiveHandler = null
        removeStatusBarBlocker()
        Log.d(TAG, "Persistent immersive mode stopped")
    }

    /**
     * Add a transparent overlay view at the top of the screen to block status bar swipe.
     * This intercepts touch events before they reach the system status bar.
     */
    private fun addStatusBarBlocker() {
        if (statusBarBlocker != null) return // Already added

        try {
            val blocker = View(this).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                // Consume all touch events to prevent them from reaching the status bar
                setOnTouchListener { _, _ -> true }
            }

            val decorView = window.decorView as android.view.ViewGroup
            val params = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                80 // ~25dp height to cover status bar swipe area
            )
            decorView.addView(blocker, params)
            statusBarBlocker = blocker
            Log.d(TAG, "Status bar blocker added")
        } catch (e: Exception) {
            Log.w(TAG, "Could not add status bar blocker: ${e.message}")
        }
    }

    /**
     * Remove the status bar blocker view.
     */
    private fun removeStatusBarBlocker() {
        statusBarBlocker?.let { blocker ->
            try {
                val decorView = window.decorView as android.view.ViewGroup
                decorView.removeView(blocker)
            } catch (e: Exception) {
                Log.w(TAG, "Could not remove status bar blocker: ${e.message}")
            }
            statusBarBlocker = null
            Log.d(TAG, "Status bar blocker removed")
        }
    }

    private fun startKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val componentName = ComponentName(this, KioskDeviceAdmin::class.java)

        // ALWAYS enable launcher alias - this makes our app respond to HOME button
        val launcherAlias = ComponentName(this, "com.rjdpisowifi.phonerental.ui.MainLauncherAlias")
        try {
            packageManager.setComponentEnabledSetting(
                launcherAlias,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                android.content.pm.PackageManager.DONT_KILL_APP
            )
            Log.d(TAG, "Launcher alias enabled")
        } catch (e: Exception) {
            Log.w(TAG, "Could not enable launcher alias: ${e.message}")
        }

        if (dpm.isDeviceOwnerApp(packageName)) {
            // Device Owner: Use full lock task mode with whitelisted apps
            val allowedPackages = appManager.getAllowedAppPackages().toMutableSet()
            allowedPackages.add(packageName)
            dpm.setLockTaskPackages(componentName, allowedPackages.toTypedArray())

            // Force rental app as the ONLY home launcher - HOME always comes back here
            try {
                val homeFilter = android.content.IntentFilter(android.content.Intent.ACTION_MAIN)
                homeFilter.addCategory(android.content.Intent.CATEGORY_HOME)
                homeFilter.addCategory(android.content.Intent.CATEGORY_DEFAULT)
                dpm.addPersistentPreferredActivity(componentName, homeFilter, launcherAlias)
                Log.d(TAG, "Persistent HOME activity set to rental app")
            } catch (e: Exception) {
                Log.w(TAG, "Could not set persistent HOME: ${e.message}")
            }

            // Disable status bar (notification shade) and keyguard
            try {
                dpm.setStatusBarDisabled(componentName, true)
                Log.d(TAG, "Status bar disabled")
            } catch (e: Exception) {
                Log.w(TAG, "Could not disable status bar: ${e.message}")
            }

            // Disable system settings access
            try {
                dpm.setApplicationHidden(componentName, "com.android.settings", true)
                Log.d(TAG, "Settings app hidden")
            } catch (e: Exception) {
                Log.w(TAG, "Could not hide settings: ${e.message}")
            }

            startLockTask()
            Log.d(TAG, "Kiosk mode: Device Owner with lock task, ${allowedPackages.size} apps")
        } else if (dpm.isAdminActive(componentName)) {
            // Device Admin only: Use overlay mode
            Log.d(TAG, "Kiosk mode: Device Admin with overlay")
            StatusBarBlockerService.start(this)
            
            if (isMIUIDevice()) {
                Toast.makeText(this, "MIUI kiosk mode active", Toast.LENGTH_SHORT).show()
            }
        } else {
            // No Device Admin: Use overlay mode as fallback
            StatusBarBlockerService.start(this)
        }
    }

    private fun isDefaultLauncher(): Boolean {
        val homeIntent = Intent(Intent.ACTION_MAIN)
        homeIntent.addCategory(Intent.CATEGORY_HOME)
        val resolveInfo = packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        return resolveInfo?.activityInfo?.packageName == packageName
    }

    /**
     * Check if device is running MIUI/HyperOS (Xiaomi/Redmi/POCO)
     * These devices block custom launchers, so we use overlay-based kiosk instead.
     */
    private fun isMIUIDevice(): Boolean {
        return try {
            val clazz = Class.forName("android.os.SystemProperties")
            val method = clazz.getMethod("get", String::class.java)
            val miuiVersion = method.invoke(null, "ro.miui.ui.version.name") as String?
            miuiVersion != null && miuiVersion.isNotEmpty()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Request SYSTEM_ALERT_WINDOW permission so we can draw the status bar blocker overlay.
     * On Android 6+, the user must explicitly grant this via Settings.
     */
    private fun requestOverlayPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!android.provider.Settings.canDrawOverlays(this)) {
                Log.i(TAG, "Requesting SYSTEM_ALERT_WINDOW permission")
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:$packageName")
                )
                try {
                    startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST)
                } catch (e: Exception) {
                    Log.w(TAG, "Could not open overlay permission settings: ${e.message}")
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == OVERLAY_PERMISSION_REQUEST) {
            if (StatusBarBlockerService.canDrawOverlays(this)) {
                Log.i(TAG, "Overlay permission granted")
                // If already in active session, start the blocker now
                if (activeSession != null && activeSession?.status != "paused") {
                    StatusBarBlockerService.start(this)
                }
            } else {
                Log.w(TAG, "Overlay permission denied — status bar cannot be fully blocked")
                Toast.makeText(this, "Allow overlay permission for full kiosk protection", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun stopKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val componentName = ComponentName(this, KioskDeviceAdmin::class.java)

        // Stop lock task if active
        try {
            stopLockTask()
        } catch (e: Exception) {
            Log.w(TAG, "Not in lock task mode or could not stop: ${e.message}")
        }

        // Disable the HOME launcher alias for all cases
        val launcherAlias = ComponentName(this, "com.rjdpisowifi.phonerental.ui.MainLauncherAlias")
        try {
            packageManager.setComponentEnabledSetting(
                launcherAlias,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                android.content.pm.PackageManager.DONT_KILL_APP
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not disable launcher alias: ${e.message}")
        }

        if (dpm.isDeviceOwnerApp(packageName)) {
            // Clear lock task packages
            try {
                dpm.setLockTaskPackages(componentName, emptyArray())
            } catch (e: Exception) {
                Log.w(TAG, "Could not clear lock task packages: ${e.message}")
            }

            // Restore system settings access
            try {
                dpm.setApplicationHidden(componentName, "com.android.settings", false)
                Log.d(TAG, "Settings app restored")
            } catch (e: Exception) {
                Log.w(TAG, "Could not restore settings: ${e.message}")
            }

            // Re-enable status bar
            try {
                dpm.setStatusBarDisabled(componentName, false)
                Log.d(TAG, "Status bar re-enabled")
            } catch (e: Exception) {
                Log.w(TAG, "Could not re-enable status bar: ${e.message}")
            }

            // Clear persistent preferred HOME activity
            try {
                dpm.clearPackagePersistentPreferredActivities(componentName, packageName)
                Log.d(TAG, "Persistent HOME activity cleared")
            } catch (e: Exception) {
                Log.w(TAG, "Could not clear persistent HOME: ${e.message}")
            }

            Log.d(TAG, "Kiosk mode stopped - device owner")
        } else {
            Log.d(TAG, "Kiosk mode stopped - launcher alias disabled")
        }
    }

    /**
     * Pause kiosk mode - stops lock task and immersive mode but keeps launcher alias enabled.
     * This preserves the default launcher setting so resume works seamlessly.
     */
    private fun pauseKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val componentName = ComponentName(this, KioskDeviceAdmin::class.java)

        // Stop lock task if active - allow user to access system during pause
        try {
            stopLockTask()
            Log.d(TAG, "Kiosk mode paused - lock task stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Not in lock task mode or could not stop: ${e.message}")
        }

        // Keep launcher alias ENABLED - don't disable it!
        // This preserves the default launcher setting

        if (dpm.isDeviceOwnerApp(packageName)) {
            // Clear lock task packages
            try {
                dpm.setLockTaskPackages(componentName, emptyArray())
            } catch (e: Exception) {
                Log.w(TAG, "Could not clear lock task packages: ${e.message}")
            }

            Log.d(TAG, "Kiosk mode paused - device owner (launcher alias kept)")
        } else {
            Log.d(TAG, "Kiosk mode paused - launcher alias kept enabled")
        }

        // Show system UI so user can access notifications/settings during pause
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.show(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not show system UI: ${e.message}")
        }
    }

    private fun checkDeviceStatus() {
        if (!apiClient.isRegistered) {
            showNotRegisteredState()
            return
        }

        scope.launch {
            try {
                connectionStatus.text = "Connecting..."

                // Check activation status first
                val activationResult = apiClient.checkActivation()
                if (activationResult.isSuccess) {
                    val activation = activationResult.getOrNull()!!
                    if (!activation.canOperate) {
                        showDeactivatedState(activation.activationStatus, activation.message)
                        return@launch
                    }
                }

                val result = apiClient.getStatus()

                if (result.isFailure) {
                    connectionStatus.text = "Server Offline"
                    return@launch
                }

                val status = result.getOrNull()!!
                connectionStatus.text = "Connected"

                when {
                    status.active_session != null && !status.session_expired && status.active_session.status == "paused" -> {
                        activeSession = status.active_session
                        showPausedState(status.active_session)
                    }
                    status.active_session != null && !status.session_expired -> {
                        activeSession = status.active_session
                        showActiveState(status.active_session)
                    }
                    status.session_expired -> {
                        activeSession = status.active_session
                        showExpiredState()
                    }
                    else -> {
                        activeSession = null
                        showIdleState(status.device?.device_name ?: "Phone")
                    }
                }
                
                // Load wallpaper after successful status check
                if (apiClient.deviceId > 0) {
                    scope.launch {
                        loadAndDisplayWallpaper()
                    }
                }
            } catch (e: Exception) {
                connectionStatus.text = "Error: ${e.message}"
            }
        }
    }

    private fun showNotRegisteredState() {
        idleContainer.visibility = View.GONE
        activeContainer.visibility = View.GONE
        expiredContainer.visibility = View.GONE
        statusLabel.text = "NOT REGISTERED"
        statusLabel.setTextColor(getColor(android.R.color.holo_red_dark))
        connectionStatus.text = "Not registered to server"
        setupButton.visibility = View.VISIBLE
    }

    private fun showDeactivatedState(activationStatus: String, message: String) {
        idleContainer.visibility = View.GONE
        activeContainer.visibility = View.GONE
        expiredContainer.visibility = View.GONE
        statusLabel.text = when (activationStatus) {
            "expired" -> "LICENSE EXPIRED"
            "deactivated" -> "DEVICE DEACTIVATED"
            "rejected" -> "DEVICE REJECTED"
            else -> "NOT ACTIVATED"
        }
        statusLabel.setTextColor(getColor(android.R.color.holo_red_dark))
        connectionStatus.text = message
        setupButton.visibility = View.GONE
    }

    private fun showIdleState(deviceName: String) {
        stopExpiredRefresh()
        idleContainer.visibility = View.VISIBLE
        activeContainer.visibility = View.GONE
        expiredContainer.visibility = View.GONE
        deviceNameLabel.text = deviceName
        statusLabel.text = "AVAILABLE"
        statusLabel.setTextColor(getColor(android.R.color.holo_green_dark))
        setupButton.visibility = View.GONE

        // Show Insert Coin button, hide payment UI
        insertCoinButton.visibility = View.VISIBLE
        donePayingButton.visibility = View.GONE
        coinAccumulatedLabel.visibility = View.GONE
        coinTimeLabel.visibility = View.GONE
        addTimeButton.visibility = View.GONE
        
        // Reset accumulated coins
        accumulatedPesos = 0
        accumulatedMinutes = 0

        // Stop countdown
        stopCountdown()

        // Keep immersive mode active even in idle — no settings access
        startPersistentImmersiveMode()

        // Start overlay blocker to block status bar even in idle state
        StatusBarBlockerService.start(this)

        // Load rental rates
        loadRentalRates()

        // In idle state: DO NOT use lock task (it blocks app launching without Device Owner)
        // Only use lock task if Device Owner is set
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(packageName)) {
            val componentName = ComponentName(this, KioskDeviceAdmin::class.java)
            try {
                startLockTask()
                Log.d(TAG, "Idle state: lock task mode active (Device Owner)")
            } catch (e: Exception) {
                Log.w(TAG, "Idle state: lock task failed - ${e.message}")
            }
        } else {
            Log.d(TAG, "Idle state: overlay mode (no lock task)")
        }

        // Stop timer service
        stopService(Intent(this, TimerService::class.java))
    }

    private fun showActiveState(session: RentalSessionInfo) {
        stopExpiredRefresh()
        idleContainer.visibility = View.GONE
        activeContainer.visibility = View.VISIBLE
        expiredContainer.visibility = View.GONE
        statusLabel.text = "RENTED"
        statusLabel.setTextColor(getColor(android.R.color.holo_orange_dark))
        setupButton.visibility = View.GONE

        customerNameLabel.text = session.customer_name ?: "Walk-in Customer"
        rateLabel.text = String.format("₱%.2f / %d min", session.amount_paid, session.duration_minutes)
        addTimeButton.visibility = View.VISIBLE
        insertCoinButton.visibility = View.GONE
        donePayingButton.visibility = View.GONE
        coinAccumulatedLabel.visibility = View.GONE
        coinTimeLabel.visibility = View.GONE

        // Start kiosk mode (lock task / screen pinning)
        startKioskMode()

        // Start persistent immersive mode (blocks status bar and recent button)
        startPersistentImmersiveMode()

        // Start overlay service to block status bar even when allowed apps are in foreground
        StatusBarBlockerService.start(this)

        // Apply app restrictions - works with Device Owner, shows warning without
        CoroutineScope(Dispatchers.IO).launch {
            // Sync allowed apps from server first
            appManager.syncAllowedAppsFromServer()
            appManager.applyRentalAppRestrictions()
        }

        // Load allowed apps into the launcher grid
        loadAllowedApps()

        // Start timer
        val endTime = session.end_time
        if (endTime != null) {
            startCountdown(endTime)
            // Start timer service
            val serviceIntent = Intent(this, TimerService::class.java).apply {
                action = TimerService.ACTION_START
                putExtra(TimerService.EXTRA_END_TIME, endTime)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        }
    }

    private fun showPausedState(session: RentalSessionInfo) {
        stopExpiredRefresh()
        idleContainer.visibility = View.GONE
        activeContainer.visibility = View.VISIBLE
        expiredContainer.visibility = View.GONE
        statusLabel.text = "PAUSED"
        statusLabel.setTextColor(getColor(android.R.color.holo_blue_dark))
        setupButton.visibility = View.GONE

        customerNameLabel.text = session.customer_name ?: "Walk-in Customer"
        rateLabel.text = String.format("₱%.2f / %d min (PAUSED)", session.amount_paid, session.duration_minutes)
        addTimeButton.visibility = View.VISIBLE
        insertCoinButton.visibility = View.GONE
        donePayingButton.visibility = View.GONE
        coinAccumulatedLabel.visibility = View.GONE
        coinTimeLabel.visibility = View.GONE

        // Stop persistent immersive mode to allow status bar and recent button
        stopPersistentImmersiveMode()

        // Stop status bar overlay — allow full access during pause
        StatusBarBlockerService.stop(this)

        // Stop countdown
        stopCountdown()

        // Pause kiosk mode - keep launcher alias enabled for seamless resume
        pauseKioskMode()

        // Stop timer service
        val stopIntent = Intent(this, TimerService::class.java).apply {
            action = TimerService.ACTION_STOP
        }
        startService(stopIntent)

        // Show paused timer
        timerDisplay.text = "PAUSED"
        timerDisplay.setTextColor(getColor(android.R.color.holo_blue_dark))

        // Clear app grid
        appLauncherGrid.adapter = null

        // Show paused message on screen
        Toast.makeText(this, "Rental paused by admin. Waiting to resume...", Toast.LENGTH_LONG).show()

        // Re-check status after 10 seconds
        timerHandler?.postDelayed({ checkDeviceStatus() }, 10000)
    }

    private fun showExpiredState() {
        idleContainer.visibility = View.GONE
        activeContainer.visibility = View.GONE
        expiredContainer.visibility = View.VISIBLE
        statusLabel.text = "SESSION EXPIRED"
        statusLabel.setTextColor(getColor(android.R.color.holo_red_dark))
        setupButton.visibility = View.GONE
        addTimeButton.visibility = View.GONE

        // Stop countdown
        stopCountdown()

        // Keep kiosk mode ACTIVE but restrict lock task to ONLY this app (no allowed apps)
        // This prevents user from opening any apps via recent button
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val componentName = ComponentName(this, KioskDeviceAdmin::class.java)
        if (dpm.isDeviceOwnerApp(packageName)) {
            try {
                // Set lock task packages to ONLY our app - no other apps allowed
                dpm.setLockTaskPackages(componentName, arrayOf(packageName))
                // Ensure lock task is active
                startLockTask()
                Log.d(TAG, "Expired state: lock task restricted to this app only")
            } catch (e: Exception) {
                Log.w(TAG, "Could not restrict lock task: ${e.message}")
            }
        }

        // Start/keep persistent immersive mode to hide status bar and recent button
        startPersistentImmersiveMode()

        // Keep overlay active — user cannot access settings even on expired screen
        StatusBarBlockerService.start(this)

        // Stop timer service
        val stopIntent = Intent(this, TimerService::class.java).apply {
            action = TimerService.ACTION_STOP
        }
        startService(stopIntent)

        // Remove app restrictions (but keep user trapped via launcher alias + lock task)
        CoroutineScope(Dispatchers.IO).launch {
            appManager.removeRentalAppRestrictions()
        }

        // Lock screen with Device Admin (works without Device Owner!)
        if (dpm.isAdminActive(componentName)) {
            try {
                dpm.lockNow()
                Log.d(TAG, "Screen locked via Device Admin")
            } catch (e: Exception) {
                Log.w(TAG, "Could not lock screen: ${e.message}")
            }
        }

        // Re-check status every 10 seconds until no longer expired
        stopExpiredRefresh() // Clear any existing
        expiredRefreshHandler = Handler(Looper.getMainLooper())
        expiredRefreshRunnable = object : Runnable {
            override fun run() {
                Log.d(TAG, "Auto-refreshing from expired state...")
                checkDeviceStatus()
                expiredRefreshHandler?.postDelayed(this, 10000)
            }
        }
        expiredRefreshHandler?.postDelayed(expiredRefreshRunnable!!, 10000)
    }

    private fun startCountdown(endTimeStr: String) {
        // Stop any existing countdown first to prevent duplicate timers
        stopCountdown()

        timerHandler = Handler(Looper.getMainLooper())

        val endTimeMs = parseEndTime(endTimeStr)

        timerRunnable = object : Runnable {
            override fun run() {
                // Prevent old runnables from interfering after stopCountdown + startCountdown
                if (this !== timerRunnable) return

                val now = System.currentTimeMillis()
                val diffMs = endTimeMs - now

                if (diffMs <= 0) {
                    timerDisplay.text = "00:00:00"
                    timerDisplay.setTextColor(getColor(android.R.color.holo_red_dark))
                    showExpiredState()
                    return
                }

                val totalSeconds = diffMs / 1000
                val hours = totalSeconds / 3600
                val minutes = (totalSeconds % 3600) / 60
                val seconds = totalSeconds % 60

                timerDisplay.text = String.format("%02d:%02d:%02d", hours, minutes, seconds)

                // Color based on remaining time
                timerDisplay.setTextColor(
                    when {
                        totalSeconds < 300 -> getColor(android.R.color.holo_red_dark) // < 5min
                        totalSeconds < 900 -> getColor(android.R.color.holo_orange_dark) // < 15min
                        else -> getColor(android.R.color.holo_green_dark)
                    }
                )

                // Progress bar (based on max 8 hours)
                val totalDurationMs = 8 * 60 * 60 * 1000L
                val progress = ((totalDurationMs - diffMs) * 100 / totalDurationMs).toInt().coerceIn(0, 100)
                progressBar.progress = 100 - progress

                timerHandler?.postDelayed(this, 1000)
            }
        }

        timerRunnable?.run()
    }

    private fun stopCountdown() {
        timerRunnable?.let { timerHandler?.removeCallbacks(it) }
        timerRunnable = null
        timerHandler = null
    }

    private fun stopExpiredRefresh() {
        expiredRefreshRunnable?.let { expiredRefreshHandler?.removeCallbacks(it) }
        expiredRefreshRunnable = null
        expiredRefreshHandler = null
    }

    private fun parseEndTime(endTimeStr: String): Long {
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            sdf.parse(endTimeStr)?.time ?: 0L
        } catch (e: Exception) {
            try {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                sdf.parse(endTimeStr)?.time ?: 0L
            } catch (e2: Exception) { 0L }
        }
    }

    /**
     * Load allowed apps into the in-app launcher grid.
     * Uses direct getApplicationInfo() per package instead of getInstalledApps()
     * because getInstalledApps() is unreliable on OEM ROMs like TECNO HiOS.
     */
    private fun loadAllowedApps() {
        scope.launch {
            try {
                val allowedPackages = appManager.getAllowedAppPackages()
                val apps = withContext(Dispatchers.IO) {
                    if (allowedPackages.isEmpty()) {
                        emptyList<AppInfo>()
                    } else {
                        // Use direct getApplicationInfo() per package - much more reliable
                        val pm = packageManager
                        allowedPackages.filter { it != packageName }.mapNotNull { pkg ->
                            try {
                                val appInfo = pm.getApplicationInfo(pkg, 0)
                                val label = appInfo.loadLabel(pm)?.toString() ?: pkg
                                AppInfo(
                                    packageName = pkg,
                                    label = if (label.isNotEmpty()) label else pkg,
                                    isAllowed = true,
                                    isSystemApp = (appInfo.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0,
                                    isEnabled = appInfo.enabled
                                )
                            } catch (e: Exception) {
                                // App not installed, skip
                                Log.w(TAG, "Allowed app not found: $pkg")
                                null
                            }
                        }
                    }
                }

                val adapter = AppLauncherAdapter(apps) { packageName ->
                    try {
                        // Method 1: Standard launch intent
                        var launchIntent = packageManager.getLaunchIntentForPackage(packageName)

                        // Method 2: Try to find MAIN action intent
                        if (launchIntent == null) {
                            val mainIntent = Intent(Intent.ACTION_MAIN)
                            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER)
                            mainIntent.setPackage(packageName)
                            val resolveInfo = packageManager.queryIntentActivities(mainIntent, 0)
                            if (resolveInfo.isNotEmpty()) {
                                launchIntent = Intent(Intent.ACTION_MAIN)
                                launchIntent.addCategory(Intent.CATEGORY_LAUNCHER)
                                launchIntent.setClassName(packageName, resolveInfo[0].activityInfo.name)
                                launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                        }

                        if (launchIntent != null) {
                            isLaunchingAllowedApp = true
                            startActivity(launchIntent)
                            // Reset flag after short delay so onUserLeaveHint works for Home button
                            Handler(Looper.getMainLooper()).postDelayed({
                                isLaunchingAllowedApp = false
                            }, 500)
                        } else {
                            Toast.makeText(this@MainActivity, "Cannot open: no launcher found", Toast.LENGTH_SHORT).show()
                        }
                    } catch (e: Exception) {
                        Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                        Log.e(TAG, "Failed to launch app: $packageName", e)
                    }
                }

                appLauncherGrid.layoutManager = GridLayoutManager(this@MainActivity, 4)
                appLauncherGrid.adapter = adapter
            } catch (e: Exception) {
                Log.e(TAG, "Error loading apps", e)
                Toast.makeText(this@MainActivity, "Error loading apps: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * RecyclerView Adapter for the in-app launcher grid
     */
    inner class AppLauncherAdapter(
        private val apps: List<AppInfo>,
        private val onAppClick: (String) -> Unit
    ) : RecyclerView.Adapter<AppLauncherAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val appIcon: ImageView = view.findViewById(R.id.launcherAppIcon)
            val appName: TextView = view.findViewById(R.id.launcherAppName)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_launcher_app, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val app = apps[position]
            holder.appName.text = app.label

            // Load real app icon from PackageManager
            try {
                val appIcon = packageManager.getApplicationIcon(app.packageName)
                holder.appIcon.setImageDrawable(appIcon)
            } catch (e: Exception) {
                // Fallback: show colored circle with initials
                val initials = app.label.take(2).uppercase()
                val textDrawable = createTextDrawable(initials, getColorForApp(app.packageName))
                holder.appIcon.setImageDrawable(textDrawable)
            }

            holder.itemView.setOnClickListener {
                onAppClick(app.packageName)
            }
        }

        override fun getItemCount() = apps.size

        private fun getColorForApp(packageName: String): Int {
            val colors = intArrayOf(
                Color.parseColor("#E53935"), // Red
                Color.parseColor("#8E24AA"), // Purple
                Color.parseColor("#1E88E5"), // Blue
                Color.parseColor("#43A047"), // Green
                Color.parseColor("#FB8C00"), // Orange
                Color.parseColor("#00ACC1"), // Cyan
                Color.parseColor("#F4511E"), // Deep Orange
                Color.parseColor("#3949AB")  // Indigo
            )
            return colors[Math.abs(packageName.hashCode()) % colors.size]
        }

        private fun createTextDrawable(text: String, color: Int): Drawable {
            val bitmap = android.graphics.Bitmap.createBitmap(96, 96, android.graphics.Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(bitmap)
            val paint = android.graphics.Paint().apply {
                this.color = color
                isAntiAlias = true
                textSize = 40f
                textAlign = android.graphics.Paint.Align.CENTER
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            }
            canvas.drawCircle(48f, 48f, 48f, paint)
            paint.color = Color.WHITE
            canvas.drawText(text, 48f, 60f, paint)
            return android.graphics.drawable.BitmapDrawable(this@MainActivity.resources, bitmap)
        }
    }

    /**
     * Load rental rates from server
     */
    private fun loadRentalRates() {
        scope.launch {
            try {
                val response = apiClient.getRentalRates()
                if (response.isSuccess) {
                    rentalRates = response.getOrNull()!!
                    Log.d(TAG, "Loaded ${rentalRates.size} rental rates")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load rental rates", e)
            }
        }
    }

    /**
     * Show coin insertion modal - Select NodeMCU coinslot device
     */
    private fun showCoinInsertionModal() {
        scope.launch {
            try {
                // Show loading
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Loading coinslots...", Toast.LENGTH_SHORT).show()
                }

                // Fetch available coinslots from server
                val response = apiClient.getAvailableCoinslots()
                
                withContext(Dispatchers.Main) {
                    if (response.isSuccess) {
                        val coinslots = response.getOrNull()!!
                        
                        if (coinslots.isEmpty()) {
                            Toast.makeText(this@MainActivity, "No coinslot devices available", Toast.LENGTH_LONG).show()
                            return@withContext
                        }

                        // Show coinslot selection dialog
                        val builder = android.app.AlertDialog.Builder(this@MainActivity)
                        builder.setTitle("Select Coinslot Machine")

                        val coinslotOptions = coinslots.map { 
                            "${it.name} (${it.macAddress.takeLast(5)})"
                        }.toTypedArray()

                        builder.setItems(coinslotOptions) { _, which ->
                            selectedCoinslot = coinslots[which]
                            startListeningForCoins()
                        }

                        builder.setNegativeButton("Cancel", null)
                        builder.show()
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            "Failed to load coinslots: ${response.exceptionOrNull()?.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /**
     * Start listening for coin pulses from selected NodeMCU - shows modal dialog
     */
    private fun startListeningForCoins() {
        if (selectedCoinslot == null) {
            Toast.makeText(this, "No coinslot selected", Toast.LENGTH_SHORT).show()
            return
        }

        // Reset accumulation
        accumulatedPesos = 0
        accumulatedMinutes = 0
        isListeningForPulse = true
        insertCountdownSeconds = 60

        showInsertCoinModal()

        // Connect to Socket.IO for real-time pulse detection
        val socketResult = apiClient.connectSocketIO { denomination ->
            // This callback runs when a coin pulse is detected
            runOnUiThread {
                onCoinPulseDetected(denomination)
            }
        }

        if (socketResult.isFailure) {
            Toast.makeText(this, "Failed to connect to pulse listener: ${socketResult.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
            dismissInsertCoinModal()
            stopListeningForCoins()
        }
    }

    /**
     * Show the Insert Coin modal dialog with countdown and coin display
     */
    private fun showInsertCoinModal() {
        val dialogView = layoutInflater.inflate(R.layout.insert_coin_modal, null)

        insertModalPesosView = dialogView.findViewById(R.id.insertModalPesos)
        insertModalMinutesView = dialogView.findViewById(R.id.insertModalMinutes)
        insertModalCountdownView = dialogView.findViewById(R.id.insertCountdownTimer)
        insertModalCoinslotView = dialogView.findViewById(R.id.insertModalCoinslotName)
        insertModalDonePayingBtn = dialogView.findViewById(R.id.insertModalDonePaying)
        val cancelBtn = dialogView.findViewById<Button>(R.id.insertModalCancel)

        insertModalCoinslotView?.text = selectedCoinslot?.name ?: ""
        updateInsertModalDisplay()

        val builder = android.app.AlertDialog.Builder(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        builder.setView(dialogView)
        builder.setCancelable(false)

        insertCoinDialog = builder.create()
        insertCoinDialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)
        insertCoinDialog?.show()

        // Start countdown
        startInsertCountdown()

        insertModalDonePayingBtn?.setOnClickListener {
            startRentalSessionWithCoins()
        }

        cancelBtn.setOnClickListener {
            dismissInsertCoinModal()
            stopListeningForCoins()
        }
    }

    /**
     * Start the insert coin modal countdown timer (60s, resets on coin pulse)
     */
    private fun startInsertCountdown() {
        insertCountdownHandler = Handler(Looper.getMainLooper())
        insertCountdownRunnable = object : Runnable {
            override fun run() {
                insertCountdownSeconds--
                insertModalCountdownView?.text = "${insertCountdownSeconds}s"
                if (insertCountdownSeconds <= 0) {
                    dismissInsertCoinModal()
                    stopListeningForCoins()
                    Toast.makeText(this@MainActivity, "Coin insertion timed out", Toast.LENGTH_SHORT).show()
                } else {
                    insertCountdownHandler?.postDelayed(this, 1000)
                }
            }
        }
        insertCountdownHandler?.postDelayed(insertCountdownRunnable!!, 1000)
    }

    /**
     * Reset the insert coin modal countdown on coin pulse
     */
    private fun resetInsertCountdown() {
        insertCountdownSeconds = 60
        insertModalCountdownView?.text = "${insertCountdownSeconds}s"
    }

    /**
     * Update insert coin modal display with current accumulated values
     */
    private fun updateInsertModalDisplay() {
        insertModalPesosView?.text = "₱$accumulatedPesos"
        insertModalMinutesView?.text = "$accumulatedMinutes"
        insertModalDonePayingBtn?.isEnabled = accumulatedPesos > 0
        insertModalDonePayingBtn?.text = if (accumulatedPesos > 0) "DONE PAYING - START SESSION" else "INSERT COINS FIRST"
    }

    /**
     * Dismiss the Insert Coin modal dialog
     */
    private fun dismissInsertCoinModal() {
        insertCountdownRunnable?.let { insertCountdownHandler?.removeCallbacks(it) }
        insertCountdownRunnable = null
        insertCountdownHandler = null
        insertCoinDialog?.dismiss()
        insertCoinDialog = null
    }

    /**
     * Called when a coin pulse is detected from NodeMCU
     */
    private fun onCoinPulseDetected(denomination: Int) {
        if (!isListeningForPulse) return

        // Add peso amount
        accumulatedPesos += denomination
        
        // Calculate minutes based on phone rental rates
        val minutes = calculateMinutesFromPesos(accumulatedPesos)
        accumulatedMinutes = minutes

        // Update UI
        updateCoinDisplay()
        
        // Update modals if showing
        updateModalDisplay()
        resetModalCountdown()
        updateInsertModalDisplay()
        resetInsertCountdown()

        // Play beep sound or show feedback
        Toast.makeText(this, "₱$denomination inserted! Total: ₱$accumulatedPesos", Toast.LENGTH_SHORT).show()

        Log.d(TAG, "Coin pulse: +₱$denomination | Total: ₱$accumulatedPesos | Minutes: $accumulatedMinutes | activeSession=${activeSession?.id}")
    }

    /**
     * Calculate minutes based on accumulated pesos using phone rental rates
     */
    private fun calculateMinutesFromPesos(pesos: Int): Int {
        if (rentalRates.isEmpty()) {
            // Fallback: 1 peso = 5 minutes if no rates configured
            return pesos * 5
        }

        // Find best rate combination
        var remainingPesos = pesos
        var totalMinutes = 0

        // Sort rates by pesos (descending) to use best rates first
        val sortedRates = rentalRates.sortedByDescending { it.pesos }

        for (rate in sortedRates) {
            while (remainingPesos >= rate.pesos) {
                totalMinutes += rate.minutes
                remainingPesos -= rate.pesos
            }
        }

        return totalMinutes
    }

    /**
     * Stop listening for coin pulses
     */
    private fun stopListeningForCoins() {
        isListeningForPulse = false
        apiClient.disconnectSocketIO()
        
        insertCoinButton.isEnabled = true
        insertCoinButton.text = "INSERT COIN"
    }

    /**
     * Update the coin accumulation display
     */
    private fun updateCoinDisplay() {
        if (accumulatedPesos > 0) {
            coinAccumulatedLabel.visibility = View.VISIBLE
            coinTimeLabel.visibility = View.VISIBLE
            donePayingButton.visibility = View.VISIBLE
            
            coinAccumulatedLabel.text = "₱$accumulatedPesos"
            coinTimeLabel.text = "$accumulatedMinutes minutes"
            
            // Show selected coinslot info
            if (selectedCoinslot != null) {
                coinAccumulatedLabel.text = "₱$accumulatedPesos (${selectedCoinslot?.name})"
            }
        } else {
            coinAccumulatedLabel.visibility = View.GONE
            coinTimeLabel.visibility = View.GONE
            donePayingButton.visibility = View.GONE
        }
    }

    /**
     * Start rental session with accumulated coins
     */
    private fun startRentalSessionWithCoins() {
        if (accumulatedPesos <= 0 || accumulatedMinutes <= 0) {
            Toast.makeText(this, "Please insert coins first", Toast.LENGTH_SHORT).show()
            return
        }

        dismissInsertCoinModal()
        stopListeningForCoins()

        scope.launch {
            try {
                withContext(Dispatchers.Main) {
                    insertCoinButton.isEnabled = false
                    insertCoinButton.text = "Starting Session..."
                }

                val result = apiClient.startRentalSessionWithPayment(
                    deviceId = apiClient.deviceId,
                    amountPaid = accumulatedPesos,
                    durationMinutes = accumulatedMinutes,
                    paymentMethod = "coinslot"
                )

                withContext(Dispatchers.Main) {
                    if (result.isSuccess) {
                        Toast.makeText(
                            this@MainActivity,
                            "Session started! ₱$accumulatedPesos for $accumulatedMinutes mins",
                            Toast.LENGTH_LONG
                        ).show()

                        accumulatedPesos = 0
                        accumulatedMinutes = 0
                        selectedCoinslot = null

                        checkDeviceStatus()
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            "Failed to start session: ${result.exceptionOrNull()?.message}",
                            Toast.LENGTH_LONG
                        ).show()
                        
                        insertCoinButton.isEnabled = true
                        insertCoinButton.text = "INSERT COIN"
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@MainActivity,
                        "Error: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                    
                    insertCoinButton.isEnabled = true
                    insertCoinButton.text = "INSERT COIN"
                }
            }
        }
    }

    /**
     * Show coin insertion modal for topping up an active session
     */
    private fun showCoinInsertionModalForTopUp() {
        if (activeSession == null) {
            Toast.makeText(this, "No active session to extend", Toast.LENGTH_SHORT).show()
            return
        }
        
        scope.launch {
            try {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Loading coinslots...", Toast.LENGTH_SHORT).show()
                }

                val response = apiClient.getAvailableCoinslots()
                
                withContext(Dispatchers.Main) {
                    if (response.isSuccess) {
                        val coinslots = response.getOrNull()!!
                        
                        if (coinslots.isEmpty()) {
                            Toast.makeText(this@MainActivity, "No coinslot devices available", Toast.LENGTH_LONG).show()
                            return@withContext
                        }

                        val builder = android.app.AlertDialog.Builder(this@MainActivity)
                        builder.setTitle("➕ Add Time - Select Coinslot")

                        val coinslotOptions = coinslots.map { 
                            "${it.name} (${it.macAddress.takeLast(5)})"
                        }.toTypedArray()

                        builder.setItems(coinslotOptions) { _, which ->
                            selectedCoinslot = coinslots[which]
                            startListeningForCoinsForTopUp()
                        }

                        builder.setNegativeButton("Cancel", null)
                        builder.show()
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            "Failed to load coinslots: ${response.exceptionOrNull()?.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /**
     * Start listening for coins to add time to active session - shows modal dialog
     */
    private fun startListeningForCoinsForTopUp() {
        if (selectedCoinslot == null) {
            Toast.makeText(this, "No coinslot selected", Toast.LENGTH_SHORT).show()
            return
        }

        accumulatedPesos = 0
        accumulatedMinutes = 0
        isListeningForPulse = true
        modalCountdownSeconds = 60

        showAddTimeModal()

        val socketResult = apiClient.connectSocketIO { denomination ->
            runOnUiThread {
                onCoinPulseDetected(denomination)
            }
        }

        if (socketResult.isFailure) {
            Toast.makeText(this, "Failed to connect: ${socketResult.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
            dismissAddTimeModal()
            stopListeningForCoinsForTopUp()
        }
    }

    /**
     * Show the Add Time modal dialog with countdown and coin display
     */
    private fun showAddTimeModal() {
        val dialogView = layoutInflater.inflate(R.layout.add_time_modal, null)

        modalPesosView = dialogView.findViewById(R.id.modalPesos)
        modalMinutesView = dialogView.findViewById(R.id.modalMinutes)
        modalCountdownView = dialogView.findViewById(R.id.countdownTimer)
        modalCoinslotView = dialogView.findViewById(R.id.modalCoinslotName)
        modalConnectionDot = dialogView.findViewById(R.id.connectionDot)
        modalConnectionStatus = dialogView.findViewById(R.id.connectionStatus)
        modalDonePayingBtn = dialogView.findViewById(R.id.modalDonePaying)
        val cancelBtn = dialogView.findViewById<Button>(R.id.modalCancel)

        modalCoinslotView?.text = selectedCoinslot?.name ?: ""
        updateModalDisplay()

        val builder = android.app.AlertDialog.Builder(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        builder.setView(dialogView)
        builder.setCancelable(false)

        addTimeDialog = builder.create()
        addTimeDialog?.window?.setBackgroundDrawableResource(android.R.color.transparent)
        addTimeDialog?.show()

        // Start countdown
        startModalCountdown()

        modalDonePayingBtn?.setOnClickListener {
            extendRentalSessionWithCoins()
        }

        cancelBtn.setOnClickListener {
            dismissAddTimeModal()
            stopListeningForCoinsForTopUp()
        }
    }

    /**
     * Start the modal countdown timer (60s, resets on coin pulse)
     */
    private fun startModalCountdown() {
        modalCountdownHandler = Handler(Looper.getMainLooper())
        modalCountdownRunnable = object : Runnable {
            override fun run() {
                modalCountdownSeconds--
                modalCountdownView?.text = "${modalCountdownSeconds}s"
                if (modalCountdownSeconds <= 0) {
                    dismissAddTimeModal()
                    stopListeningForCoinsForTopUp()
                    Toast.makeText(this@MainActivity, "Coin insertion timed out", Toast.LENGTH_SHORT).show()
                } else {
                    modalCountdownHandler?.postDelayed(this, 1000)
                }
            }
        }
        modalCountdownHandler?.postDelayed(modalCountdownRunnable!!, 1000)
    }

    /**
     * Reset the modal countdown on coin pulse
     */
    private fun resetModalCountdown() {
        modalCountdownSeconds = 60
        modalCountdownView?.text = "${modalCountdownSeconds}s"
    }

    /**
     * Update modal display with current accumulated values
     */
    private fun updateModalDisplay() {
        modalPesosView?.text = "₱$accumulatedPesos"
        modalMinutesView?.text = "$accumulatedMinutes"
        modalDonePayingBtn?.isEnabled = accumulatedPesos > 0
        modalDonePayingBtn?.text = if (accumulatedPesos > 0) "DONE PAYING - ADD TIME" else "INSERT COINS FIRST"
    }

    /**
     * Dismiss the Add Time modal dialog
     */
    private fun dismissAddTimeModal() {
        modalCountdownRunnable?.let { modalCountdownHandler?.removeCallbacks(it) }
        modalCountdownRunnable = null
        modalCountdownHandler = null
        addTimeDialog?.dismiss()
        addTimeDialog = null
    }

    /**
     * Stop listening for top-up coins
     */
    private fun stopListeningForCoinsForTopUp() {
        isListeningForPulse = false
        apiClient.disconnectSocketIO()
        
        addTimeButton.isEnabled = true
        addTimeButton.text = "➕ TIME"
        donePayingButton.visibility = View.GONE
    }

    /**
     * Extend rental session with accumulated coins
     */
    private fun extendRentalSessionWithCoins() {
        if (accumulatedPesos <= 0 || accumulatedMinutes <= 0) {
            Toast.makeText(this, "Please insert coins first", Toast.LENGTH_SHORT).show()
            return
        }

        val session = activeSession
        if (session == null) {
            Toast.makeText(this, "No active session found", Toast.LENGTH_SHORT).show()
            return
        }

        dismissAddTimeModal()
        stopListeningForCoinsForTopUp()

        scope.launch {
            try {
                withContext(Dispatchers.Main) {
                    addTimeButton.isEnabled = false
                    addTimeButton.text = "Adding Time..."
                }

                val result = apiClient.extendRentalSession(
                    sessionId = session.id,
                    additionalMinutes = accumulatedMinutes,
                    amountPaid = accumulatedPesos,
                    paymentMethod = "coinslot"
                )

                withContext(Dispatchers.Main) {
                    if (result.isSuccess) {
                        val updatedSession = result.getOrNull()!!
                        Log.d(TAG, "Extend API success: new end_time=${updatedSession.end_time}, duration=${updatedSession.duration_minutes}")

                        Toast.makeText(
                            this@MainActivity,
                            "✅ Time added! +₱$accumulatedPesos for +$accumulatedMinutes mins",
                            Toast.LENGTH_LONG
                        ).show()

                        accumulatedPesos = 0
                        accumulatedMinutes = 0
                        selectedCoinslot = null

                        // Use returned session directly - do NOT rely on checkDeviceStatus
                        activeSession = updatedSession
                        showActiveState(updatedSession)
                        Log.d(TAG, "UI updated directly with extended session")
                    } else {
                        val errorMsg = result.exceptionOrNull()?.message ?: "Unknown error"
                        Log.e(TAG, "Extend API failed: $errorMsg")
                        Toast.makeText(
                            this@MainActivity,
                            "Failed to add time: $errorMsg",
                            Toast.LENGTH_LONG
                        ).show()
                        
                        addTimeButton.isEnabled = true
                        addTimeButton.text = "➕ TIME"
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                    addTimeButton.isEnabled = true
                    addTimeButton.text = "➕ TIME"
                }
            }
        }
    }

    /**
     * Show admin login dialog with PIN entry
     */
    private fun showAdminLoginDialog() {
        val editText = android.widget.EditText(this)
        editText.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        editText.hint = "Enter PIN"
        editText.setPadding(50, 40, 50, 20)

        android.app.AlertDialog.Builder(this)
            .setTitle("🔐 Admin Access")
            .setMessage("Enter admin PIN to continue:")
            .setView(editText)
            .setPositiveButton("Login") { _, _ ->
                val pin = editText.text.toString()
                val savedPin = getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
                    .getString("admin_pin", "1234") ?: "1234"

                if (pin == savedPin) {
                    // Correct PIN - open admin panel
                    isOpeningAdminPanel = true
                    startActivity(Intent(this, AdminActivity::class.java))
                    Handler(Looper.getMainLooper()).postDelayed({
                        isOpeningAdminPanel = false
                    }, 1000)
                } else {
                    Toast.makeText(this, "❌ Incorrect PIN", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /**
     * Load and display wallpaper from server
     */
    private suspend fun loadAndDisplayWallpaper() {
        try {
            val wm = wallpaperManager ?: return
            
            // Try to load cached wallpaper first
            if (wm.hasWallpaper()) {
                Log.d(TAG, "Loading cached wallpaper")
                withContext(Dispatchers.Main) {
                    wm.displayWallpaper(wallpaperImage)
                }
            }

            // Get device ID from RentalApiClient (uses phone_rental_prefs)
            val deviceId = apiClient.deviceId
            
            if (deviceId <= 0) {
                Log.d(TAG, "No device ID set (value: $deviceId), skipping wallpaper download")
                return
            }

            // Get server URL from RentalApiClient
            val serverUrl = apiClient.serverUrl
            
            // Download wallpaper from server
            Log.d(TAG, "Downloading wallpaper for device: $deviceId from $serverUrl")
            val downloaded = wm.downloadWallpaper(deviceId.toString(), serverUrl)
            
            if (downloaded) {
                Log.d(TAG, "Wallpaper downloaded successfully")
                withContext(Dispatchers.Main) {
                    wm.displayWallpaper(wallpaperImage)
                }
            } else {
                Log.d(TAG, "No wallpaper available on server for device $deviceId")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading wallpaper: ${e.message}", e)
        }
    }

    companion object {
        private const val TAG = "MainActivity"
        private const val OVERLAY_PERMISSION_REQUEST = 9903
    }
}
