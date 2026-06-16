package com.rjdpisowifi.phonerental.network

/**
 * API response models for the Phone Rental server communication
 */

// Device registration response
data class RegistrationResponse(
    val success: Boolean,
    val device: RentalDeviceInfo?,
    val active_session: RentalSessionInfo?,
    val server_time: String?,
    val error: String? = null
)

// Device status response (heartbeat)
data class StatusResponse(
    val device: RentalDeviceInfo?,
    val active_session: RentalSessionInfo?,
    val session_expired: Boolean,
    val kiosk_logout: Boolean = false,
    val server_time: String?,
    val error: String? = null
)

// Rental device info
data class RentalDeviceInfo(
    val id: Int,
    val device_name: String,
    val mac_address: String,
    val ip_address: String?,
    val android_id: String?,
    val model: String?,
    val status: String,  // available, rented, maintenance, offline
    val rental_rate_per_hour: Double,
    val max_rental_hours: Int,
    val total_revenue: Double,
    val total_rentals: Int,
    val last_rented_at: String?,
    val last_returned_at: String?,
    val created_at: String?,
    val updated_at: String?
)

// Active rental session
data class RentalSessionInfo(
    val id: Int,
    val device_id: Int,
    val device_name: String?,
    val customer_name: String?,
    val customer_contact: String?,
    val start_time: String,
    val end_time: String?,
    val duration_minutes: Int,
    val amount_paid: Double,
    val status: String,  // active, completed, overdue, cancelled, paused
    val notes: String?,
    val kiosk_logout_at: String? = null,
    val paused_remaining_seconds: Int? = null,
    val kiosk_logout_reason: String? = null,
    val created_at: String?,
    val updated_at: String?
)

// Activation status
data class ActivationStatus(
    val canOperate: Boolean,
    val activationStatus: String,  // pending, trial, active, expired, deactivated, rejected
    val isTrial: Boolean = false,
    val trialExpiresAt: String? = null,
    val expiresAt: String? = null,
    val daysRemaining: Int? = null,
    val message: String = ""
)

// Phone rental rate for coinslot
data class RentalRate(
    val id: String,
    val pesos: Int,
    val minutes: Int,
    val label: String? = null
)

// NodeMCU coinslot device
data class CoinslotDevice(
    val id: String,
    val name: String,
    val macAddress: String,
    val status: String, // "accepted", "pending", "rejected"
    val denomination: Int = 1, // Pulse value in pesos
    val ip: String? = null,
    val lastSeen: String? = null
)
