package com.rjdpisowifi.phonerental.network

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit

/**
 * API Client for communicating with the PisoWiFi Phone Rental server
 */
class RentalApiClient(private val context: Context) {

    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    // Socket.IO client for real-time pulse detection
    var socketClient: io.socket.client.Socket? = null

    private val prefs by lazy {
        context.getSharedPreferences("phone_rental_prefs", Context.MODE_PRIVATE)
    }

    var serverUrl: String
        get() = prefs.getString("server_url", "http://10.0.0.1") ?: "http://10.0.0.1"
        set(value) = prefs.edit().putString("server_url", value).apply()

    var isRegistered: Boolean
        get() = prefs.getBoolean("is_registered", false)
        set(value) = prefs.edit().putBoolean("is_registered", value).apply()

    var deviceId: Int
        get() = prefs.getInt("device_id", -1)
        set(value) = prefs.edit().putInt("device_id", value).apply()

    var deviceMac: String
        get() = prefs.getString("device_mac", "") ?: ""
        set(value) = prefs.edit().putString("device_mac", value).apply()

    /**
     * Register this device with the server
     */
    suspend fun registerDevice(): Result<RegistrationResponse> = withContext(Dispatchers.IO) {
        try {
            val macAddress = getMacAddress()
            val androidId = getAndroidId()
            val model = "${Build.MANUFACTURER} ${Build.MODEL}"
            val deviceName = "Phone-${macAddress.takeLast(5)}"

            val requestBody = gson.toJson(mapOf(
                "mac_address" to macAddress,
                "android_id" to androidId,
                "model" to model,
                "device_name" to deviceName
            ))

            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/register")
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val result = gson.fromJson(body, RegistrationResponse::class.java)

            if (result.success && result.device != null) {
                isRegistered = true
                deviceId = result.device.id
                deviceMac = result.device.mac_address
            }

            Result.success(result)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get current device status (heartbeat)
     */
    suspend fun getStatus(): Result<StatusResponse> = withContext(Dispatchers.IO) {
        try {
            val mac = deviceMac.ifEmpty { getMacAddress() }
            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/status/$mac")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val result = gson.fromJson(body, StatusResponse::class.java)
            Result.success(result)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get allowed apps for this device from server
     */
    suspend fun getAllowedApps(): Result<List<String>> = withContext(Dispatchers.IO) {
        try {
            val mac = deviceMac.ifEmpty { getMacAddress() }
            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/device/$mac/allowed-apps")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val json = gson.fromJson(body, Map::class.java) as Map<*, *>
            val apps = (json["allowed_apps"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            Result.success(apps)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get the MAC address of the WiFi interface
     */

    /**
     * Check device activation status
     */
    suspend fun checkActivation(): Result<ActivationStatus> = withContext(Dispatchers.IO) {
        try {
            val mac = deviceMac.ifEmpty { getMacAddress() }
            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/device/$mac/activation")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val json = gson.fromJson(body, Map::class.java) as Map<*, *>
            val status = ActivationStatus(
                canOperate = json["can_operate"] as? Boolean ?: true,
                activationStatus = json["activation_status"] as? String ?: "trial",
                isTrial = json["is_trial"] as? Boolean ?: false,
                trialExpiresAt = json["trial_expires_at"] as? String,
                expiresAt = json["expires_at"] as? String,
                daysRemaining = json["days_remaining"]?.let { (it as Number).toInt() },
                message = json["message"] as? String ?: ""
            )
            Result.success(status)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    private fun getMacAddress(): String {
        // Try to get from network interfaces
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val nif = interfaces.nextElement()
                if (nif.name.equals("wlan0", ignoreCase = true)) {
                    val macBytes = nif.hardwareAddress ?: continue
                    return macBytes.joinToString(":") { "%02X".format(it) }
                }
            }
        } catch (e: Exception) { /* fallback */ }

        // Fallback: try WifiManager (deprecated but still works on many devices)
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val connectionInfo = wifiManager?.connectionInfo
            val mac = connectionInfo?.macAddress
            if (!mac.isNullOrEmpty() && mac != "02:00:00:00:00:00") {
                return mac.uppercase()
            }
        } catch (e: Exception) { /* fallback */ }

        return "UNKNOWN"
    }

    /**
     * Get Android ID (stable across factory resets on some devices)
     */
    private fun getAndroidId(): String {
        return try {
            android.provider.Settings.Secure.getString(
                context.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            ) ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    /**
     * Get phone rental coin slot rates
     */
    suspend fun getRentalRates(): Result<List<RentalRate>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/rates")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() 
                ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val json = gson.fromJson(body, Map::class.java) as Map<*, *>
            val ratesList = (json["rates"] as? List<*>) ?: emptyList<Any>()
            
            val rates = ratesList.map { rateMap ->
                val rm = rateMap as Map<*, *>
                RentalRate(
                    id = rm["id"] as? String ?: "",
                    pesos = (rm["pesos"] as? Number)?.toInt() ?: 0,
                    minutes = (rm["minutes"] as? Number)?.toInt() ?: 0,
                    label = rm["label"] as? String
                )
            }
            
            Result.success(rates)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Start rental session with coin payment (kiosk mode)
     */
    suspend fun startRentalSessionWithPayment(
        deviceId: Int,
        amountPaid: Int,
        durationMinutes: Int,
        paymentMethod: String = "coinslot"
    ): Result<RentalSessionInfo> = withContext(Dispatchers.IO) {
        try {
            val requestBody = gson.toJson(mapOf(
                "device_id" to deviceId,
                "amount_paid" to amountPaid,
                "duration_minutes" to durationMinutes,
                "payment_method" to paymentMethod,
                "customer_name" to "Walk-in Customer"
            ))

            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/sessions/start-kiosk")
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() 
                ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val json = gson.fromJson(body, Map::class.java) as Map<*, *>
            val sessionMap = json["session"] as? Map<*, *> ?: return@withContext Result.failure(Exception("No session data"))
            
            // Convert map to RentalSessionInfo
            val session = RentalSessionInfo(
                id = (sessionMap["id"] as? Number)?.toInt() ?: 0,
                device_id = (sessionMap["device_id"] as? Number)?.toInt() ?: 0,
                device_name = sessionMap["device_name"] as? String,
                customer_name = sessionMap["customer_name"] as? String,
                customer_contact = sessionMap["customer_contact"] as? String,
                start_time = sessionMap["start_time"] as? String ?: "",
                end_time = sessionMap["end_time"] as? String,
                duration_minutes = (sessionMap["duration_minutes"] as? Number)?.toInt() ?: 0,
                amount_paid = (sessionMap["amount_paid"] as? Number)?.toDouble() ?: 0.0,
                status = sessionMap["status"] as? String ?: "active",
                notes = sessionMap["notes"] as? String,
                kiosk_logout_at = sessionMap["kiosk_logout_at"] as? String,
                paused_remaining_seconds = (sessionMap["paused_remaining_seconds"] as? Number)?.toInt(),
                kiosk_logout_reason = sessionMap["kiosk_logout_reason"] as? String,
                created_at = sessionMap["created_at"] as? String,
                updated_at = sessionMap["updated_at"] as? String
            )
            
            Result.success(session)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Extend an active rental session (kiosk mode)
     */
    suspend fun extendRentalSession(
        sessionId: Int,
        additionalMinutes: Int,
        amountPaid: Int,
        paymentMethod: String = "coinslot"
    ): Result<RentalSessionInfo> = withContext(Dispatchers.IO) {
        try {
            val requestBody = gson.toJson(mapOf(
                "additional_minutes" to additionalMinutes,
                "amount_paid" to amountPaid,
                "payment_method" to paymentMethod
            ))

            android.util.Log.d("RentalApi", "extendRentalSession: sessionId=$sessionId, additionalMinutes=$additionalMinutes, amountPaid=$amountPaid")
            android.util.Log.d("RentalApi", "extendRentalSession: requestBody=$requestBody")

            val request = Request.Builder()
                .url("$serverUrl/api/phone-rental/sessions/$sessionId/extend-kiosk")
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string()
                ?: return@withContext Result.failure(Exception("Empty response"))

            android.util.Log.d("RentalApi", "extendRentalSession: response code=${response.code}, body=$body")

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}, body=$body"))
            }

            val json = gson.fromJson(body, Map::class.java) as Map<*, *>
            val sessionMap = json["session"] as? Map<*, *> ?: return@withContext Result.failure(Exception("No session data in response. Keys: ${json.keys}"))
            
            android.util.Log.d("RentalApi", "extendRentalSession: sessionMap=$sessionMap")
            
            val session = RentalSessionInfo(
                id = (sessionMap["id"] as? Number)?.toInt() ?: 0,
                device_id = (sessionMap["device_id"] as? Number)?.toInt() ?: 0,
                device_name = sessionMap["device_name"] as? String,
                customer_name = sessionMap["customer_name"] as? String,
                customer_contact = sessionMap["customer_contact"] as? String,
                start_time = sessionMap["start_time"] as? String ?: "",
                end_time = sessionMap["end_time"] as? String,
                duration_minutes = (sessionMap["duration_minutes"] as? Number)?.toInt() ?: 0,
                amount_paid = (sessionMap["amount_paid"] as? Number)?.toDouble() ?: 0.0,
                status = sessionMap["status"] as? String ?: "active",
                notes = sessionMap["notes"] as? String,
                kiosk_logout_at = sessionMap["kiosk_logout_at"] as? String,
                paused_remaining_seconds = (sessionMap["paused_remaining_seconds"] as? Number)?.toInt(),
                kiosk_logout_reason = sessionMap["kiosk_logout_reason"] as? String,
                created_at = sessionMap["created_at"] as? String,
                updated_at = sessionMap["updated_at"] as? String
            )
            
            android.util.Log.d("RentalApi", "extendRentalSession: parsed session end_time=${session.end_time}, duration=${session.duration_minutes}")
            Result.success(session)
        } catch (e: Exception) {
            android.util.Log.e("RentalApi", "extendRentalSession exception: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Get available NodeMCU coinslot devices (public endpoint)
     */
    suspend fun getAvailableCoinslots(): Result<List<CoinslotDevice>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$serverUrl/api/nodemcu/available")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() 
                ?: return@withContext Result.failure(Exception("Empty response"))

            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Server error: ${response.code}"))
            }

            val devicesList = gson.fromJson(body, Array<CoinslotDevice>::class.java).toList()
            Result.success(devicesList)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Connect to Socket.IO server for real-time pulse detection
     */
    fun connectSocketIO(onPulseDetected: (Int) -> Unit): Result<Unit> {
        return try {
            val socketUrl = serverUrl.replace("http://", "").replace("https://", "")
            
            val options = io.socket.client.IO.Options().apply {
                transports = arrayOf("polling")
                timeout = 5000
            }

            socketClient = io.socket.client.IO.socket("http://$socketUrl", options)
            
            socketClient?.on("nodemcu-pulse") { args ->
                if (args.isNotEmpty()) {
                    try {
                        val data = args[0] as org.json.JSONObject
                        val denomination = data.getInt("denomination")
                        onPulseDetected(denomination)
                    } catch (e: Exception) {
                        android.util.Log.e("RentalApiClient", "Error parsing pulse data", e)
                    }
                }
            }

            socketClient?.connect()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Disconnect from Socket.IO server
     */
    fun disconnectSocketIO() {
        try {
            socketClient?.disconnect()
            socketClient?.off("nodemcu-pulse")
            socketClient = null
        } catch (e: Exception) {
            android.util.Log.e("RentalApiClient", "Error disconnecting socket", e)
        }
    }
}
