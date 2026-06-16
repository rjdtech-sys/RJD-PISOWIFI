package com.rjdpisowifi.phonerental.ui

import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.rjdpisowifi.phonerental.R
import com.rjdpisowifi.phonerental.network.RentalApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Setup Activity for configuring the server connection
 * This is accessed from the main screen when the device is not registered
 */
class SetupActivity : AppCompatActivity() {

    private lateinit var apiClient: RentalApiClient
    private val scope = CoroutineScope(Dispatchers.Main)

    private lateinit var serverUrlInput: EditText
    private lateinit var registerButton: Button
    private lateinit var backButton: Button
    private lateinit var statusText: TextView
    private lateinit var deviceInfoText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        apiClient = RentalApiClient(this)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        registerButton = findViewById(R.id.registerButton)
        backButton = findViewById(R.id.backButton)
        statusText = findViewById(R.id.statusText)
        deviceInfoText = findViewById(R.id.deviceInfoText)

        // Pre-fill with saved URL
        serverUrlInput.setText(apiClient.serverUrl)

        // Show current registration status
        updateDeviceInfo()

        registerButton.setOnClickListener {
            val url = serverUrlInput.text.toString().trimEnd('/')
            if (url.isEmpty()) {
                statusText.text = "Please enter server URL"
                return@setOnClickListener
            }

            apiClient.serverUrl = url
            registerDevice()
        }

        backButton.setOnClickListener {
            finish()
        }
    }

    private fun registerDevice() {
        registerButton.isEnabled = false
        statusText.text = "Registering device..."

        scope.launch {
            val result = apiClient.registerDevice()

            if (result.isSuccess) {
                val response = result.getOrNull()!!
                if (response.success) {
                    statusText.text = "Device registered successfully!\n" +
                        "Name: ${response.device?.device_name}\n" +
                        "Status: ${response.device?.status}"
                    updateDeviceInfo()
                } else {
                    statusText.text = "Registration failed: ${response.error ?: "Unknown error"}"
                }
            } else {
                statusText.text = "Error: ${result.exceptionOrNull()?.message}"
            }

            registerButton.isEnabled = true
        }
    }

    private fun updateDeviceInfo() {
        val info = buildString {
            append("Registered: ${if (apiClient.isRegistered) "Yes" else "No"}\n")
            if (apiClient.isRegistered) {
                append("Device ID: ${apiClient.deviceId}\n")
                append("MAC: ${apiClient.deviceMac}\n")
            }
            append("Server: ${apiClient.serverUrl}")
        }
        deviceInfoText.text = info
    }
}
