package com.rjdpisowifi.phonerental.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.rjdpisowifi.phonerental.R
import com.rjdpisowifi.phonerental.ui.MainActivity

/**
 * Kiosk Keeper Service - Keeps the rental app in the foreground.
 * 
 * This service runs every 1 second and checks if our app is in the foreground.
 * If not, it brings it back immediately.
 * 
 * This is specifically designed for MIUI/Redmi devices where:
 * - Custom launchers cannot be set
 * - Device Owner mode is not available
 * - Apps get killed when HOME is pressed
 */
class KioskKeeperService : Service() {

    companion object {
        private const val TAG = "KioskKeeper"
        private const val NOTIF_CHANNEL_ID = "kiosk_keeper"
        private const val NOTIF_ID = 9903
        
        private var isServiceRunning = false
        
        fun start(context: Context) {
            if (isServiceRunning) {
                Log.d(TAG, "Service already running")
                return
            }
            
            val intent = Intent(context, KioskKeeperService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
        
        fun stop(context: Context) {
            val intent = Intent(context, KioskKeeperService::class.java)
            context.stopService(intent)
        }
    }

    private var checkHandler: Handler? = null
    private var checkRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isServiceRunning = true
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
        Log.i(TAG, "Kiosk Keeper Service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startMonitoring()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isServiceRunning = false
        stopMonitoring()
        Log.i(TAG, "Kiosk Keeper Service stopped")
    }

    private fun startMonitoring() {
        checkHandler = Handler(Looper.getMainLooper())
        checkRunnable = object : Runnable {
            override fun run() {
                try {
                    bringAppToFrontIfNeeded()
                    checkHandler?.postDelayed(this, 1000) // Check every 1 second
                } catch (e: Exception) {
                    Log.e(TAG, "Error in monitoring: ${e.message}", e)
                }
            }
        }
        checkHandler?.post(checkRunnable!!)
    }

    private fun stopMonitoring() {
        checkRunnable?.let { checkHandler?.removeCallbacks(it) }
        checkRunnable = null
        checkHandler = null
    }

    private fun bringAppToFrontIfNeeded() {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val runningTasks = activityManager.getRunningTasks(1)
        
        if (runningTasks.isEmpty()) {
            return
        }
        
        val topTask = runningTasks[0]
        val topPackage = topTask.topActivity?.packageName
        
        // If our app is not in the foreground, bring it back
        if (topPackage != packageName && topPackage != null) {
            Log.d(TAG, "App not in foreground (top: $topPackage) - bringing back")
            
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            startActivity(intent)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID,
                "Kiosk Keeper",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Keeps rental app in foreground"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("Rental Mode Active")
            .setContentText("Device is locked to rental app")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}
