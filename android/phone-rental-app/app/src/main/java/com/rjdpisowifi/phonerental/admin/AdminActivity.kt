package com.rjdpisowifi.phonerental.admin

import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.rjdpisowifi.phonerental.BuildConfig
import com.rjdpisowifi.phonerental.R
import com.rjdpisowifi.phonerental.network.RentalApiClient
import com.rjdpisowifi.phonerental.ui.SetupActivity
import com.rjdpisowifi.phonerental.util.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody

/**
 * Admin Activity - accessible via long-press on the main screen
 * Allows the admin to:
 * 1. Select which apps are allowed during rental
 * 2. Configure admin password
 * 3. Configure server URL
 * 4. View device info
 * 5. Test rental restrictions
 */
class AdminActivity : AppCompatActivity() {

    private lateinit var appManager: AppManager
    private lateinit var apiClient: RentalApiClient
    private val scope = CoroutineScope(Dispatchers.Main)

    private lateinit var tabCommon: Button
    private lateinit var tabAll: Button
    private lateinit var tabSettings: Button
    private lateinit var appRecyclerView: RecyclerView
    private lateinit var settingsContainer: LinearLayout
    private lateinit var passwordInput: EditText
    private lateinit var serverUrlInput: EditText
    private lateinit var savePasswordBtn: Button
    private lateinit var saveServerBtn: Button
    private lateinit var testRestrictionsBtn: Button
    private lateinit var removeRestrictionsBtn: Button
    private lateinit var logoutAccountsBtn: Button
    private lateinit var logoutKioskBtn: Button
    private lateinit var setupBtn: Button
    private lateinit var backBtn: Button
    private lateinit var deviceOwnerStatus: TextView
    private lateinit var allowedCountLabel: TextView
    // Update UI
    private lateinit var checkUpdateBtn: Button
    private lateinit var appVersionLabel: TextView
    private lateinit var updateStatusLabel: TextView
    private lateinit var setWallpaperBtn: Button
    private lateinit var refreshWallpaperBtn: Button

    private var currentTab = "common"
    private var isAuthenticated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_admin)

        appManager = AppManager(this)
        apiClient = RentalApiClient(this)

        // Ask for admin password first
        if (!isAuthenticated) {
            showPasswordDialog()
            return
        }

        initViews()
    }

    private fun showPasswordDialog() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Enter Admin PIN"
            setPadding(40, 20, 40, 20)
        }

        AlertDialog.Builder(this)
            .setTitle("Admin Access")
            .setView(input)
            .setPositiveButton("Enter") { _, _ ->
                val entered = input.text.toString()
                if (entered == appManager.adminPassword) {
                    isAuthenticated = true
                    initViews()
                } else {
                    Toast.makeText(this, "Wrong PIN", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
            .setNegativeButton("Cancel") { _, _ -> finish() }
            .setCancelable(false)
            .show()
    }

    private fun initViews() {
        setContentView(R.layout.activity_admin)

        tabCommon = findViewById(R.id.tabCommon)
        tabAll = findViewById(R.id.tabAll)
        tabSettings = findViewById(R.id.tabSettings)
        appRecyclerView = findViewById(R.id.appRecyclerView)
        settingsContainer = findViewById(R.id.settingsContainer)
        passwordInput = findViewById(R.id.passwordInput)
        serverUrlInput = findViewById(R.id.serverUrlInput)
        savePasswordBtn = findViewById(R.id.savePasswordBtn)
        saveServerBtn = findViewById(R.id.saveServerBtn)
        testRestrictionsBtn = findViewById(R.id.testRestrictionsBtn)
        removeRestrictionsBtn = findViewById(R.id.removeRestrictionsBtn)
        logoutAccountsBtn = findViewById(R.id.logoutAccountsBtn)
        logoutKioskBtn = findViewById(R.id.logoutKioskBtn)
        setupBtn = findViewById(R.id.setupBtn)
        backBtn = findViewById(R.id.backBtn)
        deviceOwnerStatus = findViewById(R.id.deviceOwnerStatus)
        allowedCountLabel = findViewById(R.id.allowedCountLabel)
        // Update UI
        checkUpdateBtn = findViewById(R.id.checkUpdateBtn)
        appVersionLabel = findViewById(R.id.appVersionLabel)
        updateStatusLabel = findViewById(R.id.updateStatusLabel)
        setWallpaperBtn = findViewById(R.id.setWallpaperBtn)
        refreshWallpaperBtn = findViewById(R.id.refreshWallpaperBtn)

        // Setup
        serverUrlInput.setText(apiClient.serverUrl)
        passwordInput.setText(appManager.adminPassword)
        deviceOwnerStatus.text = if (appManager.isDeviceOwner()) "Device Owner: YES (advanced kiosk)" else "Device Owner: NO (standard mode - OK)"
        updateAllowedCount()

        // Show current app version
        appVersionLabel.text = "Current version: v${BuildConfig.VERSION_NAME} (code ${BuildConfig.VERSION_CODE})"

        // Tabs
        tabCommon.setOnClickListener { switchTab("common") }
        tabAll.setOnClickListener { switchTab("all") }
        tabSettings.setOnClickListener { switchTab("settings") }

        // Settings
        savePasswordBtn.setOnClickListener {
            val newPin = passwordInput.text.toString()
            if (newPin.length >= 4) {
                appManager.adminPassword = newPin
                Toast.makeText(this, "PIN updated", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "PIN must be at least 4 digits", Toast.LENGTH_SHORT).show()
            }
        }

        saveServerBtn.setOnClickListener {
            apiClient.serverUrl = serverUrlInput.text.toString().trimEnd('/')
            Toast.makeText(this, "Server URL saved", Toast.LENGTH_SHORT).show()
        }

        testRestrictionsBtn.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Apply Restrictions?")
                .setMessage("This will suspend all non-allowed apps. Only continue if testing.")
                .setPositiveButton("Apply") { _, _ ->
                    CoroutineScope(Dispatchers.IO).launch {
                        appManager.applyRentalAppRestrictions()
                    }
                    Toast.makeText(this@AdminActivity, "Restrictions applied!", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        removeRestrictionsBtn.setOnClickListener {
            CoroutineScope(Dispatchers.IO).launch {
                appManager.removeRentalAppRestrictions()
            }
            Toast.makeText(this, "All restrictions removed", Toast.LENGTH_LONG).show()
        }

        logoutAccountsBtn.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Log Out All Accounts?")
                .setMessage("This will clear data for Facebook, Messenger, games, etc. All accounts will be signed out.")
                .setPositiveButton("Log Out All") { _, _ ->
                    appManager.logoutAllAccounts()
                    Toast.makeText(this@AdminActivity, "All accounts logged out", Toast.LENGTH_LONG).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        logoutKioskBtn.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Logout Kiosk Mode?")
                .setMessage("This will stop kiosk mode and return you to the normal phone home screen. The rental timer will keep running in the background. You can reopen the app from the app drawer.")
                .setPositiveButton("Logout") { _, _ ->
                    // Exit kiosk mode properly
                    try {
                        // Method 1: Stop lock task mode (for lock task pinned apps)
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                            val componentName = android.content.ComponentName(this, KioskDeviceAdmin::class.java)
                            
                            if (dpm.isDeviceOwnerApp(packageName)) {
                                // Device Owner mode: Remove from lock task packages
                                dpm.setLockTaskPackages(componentName, emptyArray())
                                Log.d("AdminActivity", "Removed lock task packages via Device Owner")
                            }
                        }
                        
                        // Method 2: Stop lock task (standard method)
                        try {
                            stopLockTask()
                            Log.d("AdminActivity", "Stopped lock task mode")
                        } catch (e: Exception) {
                            Log.w("AdminActivity", "stopLockTask failed: ${e.message}")
                        }
                    } catch (e: Exception) {
                        Log.e("AdminActivity", "Error exiting kiosk mode: ${e.message}", e)
                    }

                    // Stop timer service foreground (keep running in background)
                    val stopIntent = Intent(this, com.rjdpisowifi.phonerental.service.TimerService::class.java).apply {
                        action = com.rjdpisowifi.phonerental.service.TimerService.ACTION_STOP
                    }
                    startService(stopIntent)

                    // Go to home screen
                    val homeIntent = Intent(Intent.ACTION_MAIN)
                    homeIntent.addCategory(Intent.CATEGORY_HOME)
                    homeIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    startActivity(homeIntent)
                    
                    Toast.makeText(this, "Kiosk mode exited. Timer still running.", Toast.LENGTH_LONG).show()
                    
                    // Finish admin activity
                    finish()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        setupBtn.setOnClickListener {
            startActivity(Intent(this, SetupActivity::class.java))
        }

        // Set Wallpaper button - opens image picker and uploads to server
        setWallpaperBtn.setOnClickListener {
            openImagePickerForWallpaper()
        }

        // Refresh Wallpaper button - returns to MainActivity to trigger wallpaper reload
        refreshWallpaperBtn.setOnClickListener {
            Toast.makeText(this, "Refreshing wallpaper...", Toast.LENGTH_SHORT).show()
            finish()
        }

        // Check for app updates (optional/interactive)
        checkUpdateBtn.setOnClickListener {
            checkUpdateBtn.isEnabled = false
            updateStatusLabel.text = "Checking for updates…"
            updateStatusLabel.setTextColor(0xFF808080.toInt())
            val updater = AppUpdater(this, apiClient.serverUrl)
            scope.launch {
                updater.checkAndPrompt(
                    activity = this@AdminActivity,
                    onStatusMessage = { msg ->
                        updateStatusLabel.text = msg
                        val color = when {
                            msg.startsWith("✅") -> 0xFF4CAF50.toInt()
                            msg.startsWith("❌") -> 0xFFf44336.toInt()
                            else -> 0xFF808080.toInt()
                        }
                        updateStatusLabel.setTextColor(color)
                    }
                )
                checkUpdateBtn.isEnabled = true
            }
        }

        backBtn.setOnClickListener { finish() }

        // Show common apps by default
        switchTab("common")
    }

    private fun switchTab(tab: String) {
        currentTab = tab

        tabCommon.setBackgroundColor(if (tab == "common") 0xFF0f3460.toInt() else 0xFF333333.toInt())
        tabAll.setBackgroundColor(if (tab == "all") 0xFF0f3460.toInt() else 0xFF333333.toInt())
        tabSettings.setBackgroundColor(if (tab == "settings") 0xFF0f3460.toInt() else 0xFF333333.toInt())

        if (tab == "settings") {
            appRecyclerView.visibility = View.GONE
            settingsContainer.visibility = View.VISIBLE
        } else {
            appRecyclerView.visibility = View.VISIBLE
            settingsContainer.visibility = View.GONE
            loadApps(tab)
        }
    }

    private fun loadApps(tab: String) {
        scope.launch {
            // Always sync from server first when loading apps
            withContext(Dispatchers.IO) {
                appManager.syncAllowedAppsFromServer()
            }
            updateAllowedCount()

            val apps = withContext(Dispatchers.IO) {
                if (tab == "common") appManager.getCommonApps()
                else appManager.getInstalledApps()
            }

            val adapter = AppListAdapter(apps) { packageName ->
                val isNowAllowed = appManager.toggleAllowedApp(packageName)
                updateAllowedCount()
                // Refresh the list
                loadApps(tab)
            }

            appRecyclerView.layoutManager = LinearLayoutManager(this@AdminActivity)
            appRecyclerView.adapter = adapter
        }
    }

    private fun updateAllowedCount() {
        val count = appManager.getAllowedAppPackages().size
        allowedCountLabel.text = "$count apps allowed for rental"
    }

    /**
     * Open image picker to select wallpaper from gallery
     */
    private fun openImagePickerForWallpaper() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        startActivityForResult(Intent.createChooser(intent, "Select Wallpaper"), PICK_WALLPAPER_REQUEST)
    }

    /**
     * Handle wallpaper image selection and upload to server
     */
    private fun uploadWallpaperToServer(imageUri: android.net.Uri) {
        scope.launch {
            try {
                withContext(Dispatchers.Main) {
                    setWallpaperBtn.isEnabled = false
                    setWallpaperBtn.text = "⏳ Uploading..."
                }

                val deviceId = apiClient.deviceId
                Log.d("AdminActivity", "Upload wallpaper - deviceId: $deviceId")
                
                if (deviceId <= 0) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@AdminActivity, "Device not registered yet", Toast.LENGTH_LONG).show()
                        setWallpaperBtn.isEnabled = true
                        setWallpaperBtn.text = "🖼️ Set Wallpaper"
                    }
                    return@launch
                }

                // Read file from URI
                Log.d("AdminActivity", "Opening input stream for URI: $imageUri")
                val inputStream = contentResolver.openInputStream(imageUri)
                if (inputStream == null) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@AdminActivity, "Cannot read selected image", Toast.LENGTH_LONG).show()
                        setWallpaperBtn.isEnabled = true
                        setWallpaperBtn.text = "🖼️ Set Wallpaper"
                    }
                    return@launch
                }
                
                // Get actual MIME type and original filename
                var mimeType = contentResolver.getType(imageUri) ?: "image/jpeg"
                var originalName = "wallpaper.jpg"
                
                // Try to get original filename from URI
                contentResolver.query(imageUri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (nameIndex >= 0) {
                            originalName = cursor.getString(nameIndex) ?: originalName
                        }
                    }
                }
                
                Log.d("AdminActivity", "Original file: $originalName, MIME type: $mimeType")
                
                // Validate MIME type against server allowed types
                val allowedTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff")
                if (!allowedTypes.contains(mimeType)) {
                    // Try to infer from extension
                    val ext = originalName.substringAfterLast('.', "").lowercase()
                    mimeType = when (ext) {
                        "jpg", "jpeg" -> "image/jpeg"
                        "png" -> "image/png"
                        "webp" -> "image/webp"
                        "gif" -> "image/gif"
                        "bmp" -> "image/bmp"
                        "tiff", "tif" -> "image/tiff"
                        else -> mimeType
                    }
                    Log.d("AdminActivity", "Inferred MIME type from extension: $mimeType")
                }
                
                val tempFile = java.io.File(cacheDir, originalName)
                inputStream.use { input ->
                    java.io.FileOutputStream(tempFile).use { output ->
                        input.copyTo(output)
                    }
                }
                Log.d("AdminActivity", "Temp file created: ${tempFile.absolutePath}, size: ${tempFile.length()} bytes, MIME: $mimeType")

                // Upload using OkHttp
                val serverUrl = apiClient.serverUrl
                val uploadUrl = "$serverUrl/api/phone-rental/devices/$deviceId/wallpaper"
                Log.d("AdminActivity", "Uploading to: $uploadUrl")
                
                val mediaType = mimeType.toMediaTypeOrNull()
                val requestBody = okhttp3.MultipartBody.Builder()
                    .setType(okhttp3.MultipartBody.FORM)
                    .addFormDataPart(
                        "wallpaper",
                        originalName,
                        tempFile.asRequestBody(mediaType)
                    )
                    .build()

                val request = okhttp3.Request.Builder()
                    .url(uploadUrl)
                    .post(requestBody)
                    .build()

                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .writeTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .build()

                val response = withContext(Dispatchers.IO) {
                    client.newCall(request).execute()
                }
                val body = response.body?.string()
                Log.d("AdminActivity", "Response code: ${response.code}, body: $body")

                withContext(Dispatchers.Main) {
                    setWallpaperBtn.isEnabled = true
                    setWallpaperBtn.text = "🖼️ Set Wallpaper"

                    if (response.isSuccessful && body != null) {
                        val json = org.json.JSONObject(body)
                        if (json.optBoolean("success", false)) {
                            Toast.makeText(this@AdminActivity, "✅ Wallpaper uploaded! Returning to apply...", Toast.LENGTH_SHORT).show()
                            // Return to MainActivity which will refresh wallpaper in onResume
                            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                                finish()
                            }, 1500)
                        } else {
                            Toast.makeText(this@AdminActivity, "Upload failed: ${json.optString("error", "Unknown error")}", Toast.LENGTH_LONG).show()
                        }
                    } else {
                        Toast.makeText(this@AdminActivity, "Upload failed: HTTP ${response.code}", Toast.LENGTH_LONG).show()
                    }
                }

                // Clean up temp file
                tempFile.delete()
            } catch (e: Exception) {
                val errorMsg = e.message ?: e.javaClass.simpleName
                Log.e("AdminActivity", "Wallpaper upload error: $errorMsg", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AdminActivity, "Error: $errorMsg", Toast.LENGTH_LONG).show()
                    setWallpaperBtn.isEnabled = true
                    setWallpaperBtn.text = "🖼️ Set Wallpaper"
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_WALLPAPER_REQUEST && resultCode == RESULT_OK && data != null) {
            val imageUri = data.data
            if (imageUri != null) {
                uploadWallpaperToServer(imageUri)
            } else {
                Toast.makeText(this, "No image selected", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * RecyclerView Adapter for app list
     */
    inner class AppListAdapter(
        private val apps: List<AppInfo>,
        private val onToggle: (String) -> Unit
    ) : RecyclerView.Adapter<AppListAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val appIcon: TextView = view.findViewById(R.id.appIcon)
            val appLabel: TextView = view.findViewById(R.id.appLabel)
            val appPackage: TextView = view.findViewById(R.id.appPackage)
            val toggleSwitch: Switch = view.findViewById(R.id.appSwitch)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_app, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val app = apps[position]
            holder.appLabel.text = app.label
            holder.appPackage.text = app.packageName
            holder.appIcon.text = app.label.take(2).uppercase()
            holder.toggleSwitch.setOnCheckedChangeListener(null)
            holder.toggleSwitch.isChecked = app.isAllowed
            holder.toggleSwitch.setOnCheckedChangeListener { _, _ ->
                onToggle(app.packageName)
            }
        }

        override fun getItemCount() = apps.size
    }

    companion object {
        private const val PICK_WALLPAPER_REQUEST = 1001
    }
}
