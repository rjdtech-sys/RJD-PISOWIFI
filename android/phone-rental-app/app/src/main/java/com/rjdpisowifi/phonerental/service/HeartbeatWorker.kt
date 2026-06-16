package com.rjdpisowifi.phonerental.service

import android.content.Context
import androidx.work.*
import com.rjdpisowifi.phonerental.network.RentalApiClient
import com.rjdpisowifi.phonerental.util.AppUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/**
 * Periodic heartbeat worker that checks device status with the server
 * Runs every 60 seconds to keep the server informed of device status
 * and detect session expiration
 */
class HeartbeatWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val apiClient = RentalApiClient(applicationContext)

        if (!apiClient.isRegistered) {
            // Try to register
            val regResult = apiClient.registerDevice()
            if (regResult.isFailure) {
                return Result.retry()
            }
        }

        // Get current status
        val statusResult = apiClient.getStatus()
        if (statusResult.isFailure) {
            return Result.retry()
        }

        val status = statusResult.getOrNull() ?: return Result.retry()

        // If session expired, notify the app
        if (status.session_expired) {
            // Send broadcast to main activity
            android.content.Intent("com.rjdpisowifi.phonerental.SESSION_EXPIRED").also {
                it.setPackage(applicationContext.packageName)
                applicationContext.sendBroadcast(it)
            }
        }

        // OTA update check disabled to prevent update loops
        // Updates should be done manually from admin panel
        // AppUpdater(applicationContext, apiClient.serverUrl).checkAndUpdate()

        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "phone_rental_heartbeat"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(
                60, TimeUnit.SECONDS
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context)
                .cancelUniqueWork(WORK_NAME)
        }
    }
}
