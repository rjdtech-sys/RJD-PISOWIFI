package com.ajcpisowifi.phonerental.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.ajcpisowifi.phonerental.R

/**
 * A foreground service that draws a transparent overlay over the status bar area.
 * This prevents the user from pulling down the notification shade / settings slider
 * even when an allowed app (Facebook, YouTube, etc.) is in the foreground.
 *
 * The overlay uses TYPE_APPLICATION_OVERLAY which draws on top of all other apps.
 * It only blocks the top ~80px (status bar height) to intercept swipe-down gestures.
 */
class StatusBarBlockerService : Service() {

    companion object {
        private const val TAG = "StatusBarBlocker"
        const val ACTION_START = "START_BLOCKER"
        const val ACTION_STOP = "STOP_BLOCKER"
        private const val NOTIF_CHANNEL_ID = "status_bar_blocker"
        private const val NOTIF_ID = 9902

        fun start(context: Context) {
            val intent = Intent(context, StatusBarBlockerService::class.java).apply {
                action = ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, StatusBarBlockerService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        fun canDrawOverlays(context: Context): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(context)
            } else {
                true
            }
        }
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var navBarOverlayView: View? = null  // New: bottom navigation bar blocker

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> addOverlay()
            ACTION_STOP -> {
                removeOverlay()
                stopSelf()
            }
        }
        return START_STICKY // Restart service if killed
    }

    override fun onDestroy() {
        removeOverlay()
        super.onDestroy()
    }

    private fun addOverlay() {
        if (overlayView != null) return // Already added

        if (!canDrawOverlays(this)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW permission not granted — overlay not added")
            return
        }

        try {
            // Get screen dimensions
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager?.defaultDisplay?.getMetrics(metrics)
            val screenWidth = metrics.widthPixels
            val screenHeight = metrics.heightPixels

            // Status bar height (typically 24-32dp)
            val statusBarHeight = getStatusBarHeight()
            
            // Navigation bar height (typically 48dp)
            val navBarHeight = getNavigationBarHeight()

            val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            // TOP overlay: Block status bar
            val topParams = WindowManager.LayoutParams(
                screenWidth,
                statusBarHeight + 8,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 0
                y = 0
            }

            val topBlocker = View(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
                setOnTouchListener { _, _ -> true } // Consume all touches
            }

            windowManager?.addView(topBlocker, topParams)
            overlayView = topBlocker
            Log.i(TAG, "Status bar blocker overlay added (height: ${statusBarHeight + 8}px)")
            
            // BOTTOM overlay: Block navigation bar (HOME, Recent, Back buttons)
            val bottomParams = WindowManager.LayoutParams(
                screenWidth,
                navBarHeight + 8,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.START
                x = 0
                y = 0
            }

            val bottomBlocker = View(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
                setOnTouchListener { _, _ -> true } // Consume all touches
            }

            windowManager?.addView(bottomBlocker, bottomParams)
            navBarOverlayView = bottomBlocker
            Log.i(TAG, "Navigation bar blocker overlay added (height: ${navBarHeight + 8}px)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add overlay: ${e.message}", e)
        }
    }

    private fun removeOverlay() {
        // Remove top overlay (status bar)
        overlayView?.let {
            try {
                windowManager?.removeView(it)
                Log.i(TAG, "Status bar blocker overlay removed")
            } catch (e: Exception) {
                Log.w(TAG, "Error removing status bar overlay: ${e.message}")
            }
            overlayView = null
        }
        
        // Remove bottom overlay (navigation bar)
        navBarOverlayView?.let {
            try {
                windowManager?.removeView(it)
                Log.i(TAG, "Navigation bar blocker overlay removed")
            } catch (e: Exception) {
                Log.w(TAG, "Error removing navigation bar overlay: ${e.message}")
            }
            navBarOverlayView = null
        }
    }

    private fun getStatusBarHeight(): Int {
        return try {
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            if (resId > 0) resources.getDimensionPixelSize(resId) else 80
        } catch (e: Exception) {
            80 // fallback ~25dp
        }
    }

    private fun getNavigationBarHeight(): Int {
        return try {
            val resId = resources.getIdentifier("navigation_bar_height", "dimen", "android")
            if (resId > 0) resources.getDimensionPixelSize(resId) else 120
        } catch (e: Exception) {
            120 // fallback ~48dp
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID,
                "Kiosk Mode",
                NotificationManager.IMPORTANCE_MIN // Silent, no sound
            ).apply {
                description = "Phone rental kiosk protection active"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("Rental Mode Active")
            .setContentText("Device is in rental kiosk mode")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}
