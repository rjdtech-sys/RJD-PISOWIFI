package com.rjdpisowifi.phonerental.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.rjdpisowifi.phonerental.R
import kotlinx.coroutines.*
import java.text.SimpleDateFormat
import java.util.*

/**
 * Foreground service that keeps the rental timer running and screen awake
 */
class TimerService : Service() {

    companion object {
        const val CHANNEL_ID = "phone_rental_timer"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.rjdpisowifi.phonerental.TIMER_START"
        const val ACTION_STOP = "com.rjdpisowifi.phonerental.TIMER_STOP"
        const val EXTRA_END_TIME = "end_time"

        var isRunning = false
            private set
        var remainingSeconds: Long = 0
            private set
        var onTick: ((Long) -> Unit)? = null
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var endTimeMs: Long = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private var tickJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val endTimeStr = intent.getStringExtra(EXTRA_END_TIME)
                if (endTimeStr != null) {
                    endTimeMs = parseEndTime(endTimeStr)
                    startTimer()
                }
            }
            ACTION_STOP -> {
                stopTimer()
            }
        }

        // Acquire wake lock to keep screen on during rental
        acquireWakeLock()

        // Start as foreground service
        val notification = buildNotification("Phone Rental Active")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires foregroundServiceType
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        stopTimer()
        releaseWakeLock()
        isRunning = false
        scope.cancel()
    }

    private fun startTimer() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isActive) {
                val now = System.currentTimeMillis()
                val diff = endTimeMs - now

                if (diff <= 0) {
                    remainingSeconds = 0
                    onTick?.invoke(0)
                    // Session expired - notify activity
                    sendBroadcast(Intent("com.rjdpisowifi.phonerental.SESSION_EXPIRED"))
                    stopSelf()
                    break
                }

                remainingSeconds = diff / 1000
                onTick?.invoke(remainingSeconds)

                // Update notification every minute
                val minutes = remainingSeconds / 60
                val hours = minutes / 60
                val mins = minutes % 60
                updateNotification(String.format("Remaining: %dh %dm", hours, mins))

                delay(1000)
            }
        }
    }

    private fun stopTimer() {
        tickJob?.cancel()
        tickJob = null
        remainingSeconds = 0
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "PhoneRental::TimerWakeLock"
            )
            wakeLock?.acquire(8 * 60 * 60 * 1000L) // Max 8 hours
        } catch (e: Exception) {
            // Wake lock not available
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let {
                if (it.isHeld) it.release()
            }
            wakeLock = null
        } catch (e: Exception) { /* ignore */ }
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
            } catch (e2: Exception) {
                0L
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Phone Rental Timer",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows remaining rental time"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RJD Phone Rental")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_timer)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, buildNotification(text))
        } catch (e: Exception) { /* ignore */ }
    }
}
