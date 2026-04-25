# ADB Installation Status

**ADB IS ALREADY INSTALLED** on this system.

## Location:
```
/usr/bin/adb
```

## Version:
```
Android Debug Bridge version 1.0.41
Version 34.0.5-debian
```

## Manual Verification:
```bash
adb version
adb devices
```

## For Device Owner Setup:

Since ADB is already installed, you can manually set Device Owner mode:

### Steps:

1. **Connect Android device via USB**

2. **Enable USB Debugging on device:**
   - Settings → About Phone → Tap "Build Number" 7 times
   - Settings → Developer Options → Enable "USB Debugging"
   - Accept the "Allow USB debugging?" prompt on device

3. **Verify connection:**
   ```bash
   adb devices
   ```
   Should show your device serial number

4. **Install the phone rental app** (if not already installed):
   ```bash
   adb install /opt/ajc-pisowifi/android/phone-rental-app/AJC-Phone-Rental-v2.1.0-SmartUpdater.apk
   ```

5. **Set Device Owner:**
   ```bash
   adb shell dpm set-device-owner com.ajcpisowifi.phonerental/.admin.KioskDeviceAdmin
   ```

6. **Verify:**
   - App should now be in kiosk mode
   - Device will auto-launch the app on boot
   - Cannot be uninstalled or force-closed

### To Remove Device Owner:
```bash
adb shell dpm remove-active-admin com.ajcpisowifi.phonerental/.admin.KioskDeviceAdmin
```

### Troubleshooting:

**"device unauthorized":**
- Accept the USB debugging prompt on the device
- Or run: `adb kill-server && adb start-server`

**"device has a device owner":**
- Factory reset the device first
- Or remove existing owner: `adb shell dpm remove-active-admin <component>`

**"not provisioned":**
- Must be done immediately after factory reset
- Before adding Google account

---

**Note:** The web UI for Device Owner setup is having authentication issues. Use the manual commands above instead.
