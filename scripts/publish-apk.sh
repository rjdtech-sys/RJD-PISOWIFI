#!/usr/bin/env bash
# publish-apk.sh — Build new rental app APK and publish it to the server for OTA updates
# Usage: bash scripts/publish-apk.sh <version_name> [release_notes]
# Example: bash scripts/publish-apk.sh 1.6.0 "Fixed kiosk timer sync bug"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_ROOT/android/phone-rental-app"
GRADLE_BUILD="$ANDROID_DIR/app/build.gradle"
OUTPUT_DIR="$ANDROID_DIR/app/build/outputs/apk/debug"
RELEASE_DIR="$ANDROID_DIR"
META_FILE="$RELEASE_DIR/latest-release.json"

# --- Arguments ---
VERSION_NAME="${1:-}"
RELEASE_NOTES="${2:-}"

if [ -z "$VERSION_NAME" ]; then
  echo "Usage: bash scripts/publish-apk.sh <version_name> [release_notes]"
  echo "Example: bash scripts/publish-apk.sh 1.6.0 'Fixed timer bug'"
  exit 1
fi

# --- Bump versionCode in build.gradle ---
CURRENT_CODE=$(grep "versionCode" "$GRADLE_BUILD" | grep -oE '[0-9]+' | head -1)
NEW_CODE=$((CURRENT_CODE + 1))
echo "Bumping versionCode: $CURRENT_CODE -> $NEW_CODE"
echo "Setting versionName: $VERSION_NAME"

sed -i "s/versionCode $CURRENT_CODE/versionCode $NEW_CODE/" "$GRADLE_BUILD"
sed -i "s/versionName \".*\"/versionName \"$VERSION_NAME\"/" "$GRADLE_BUILD"

# --- Build ---
echo ""
echo "Building APK (debug)..."
cd "$ANDROID_DIR"
./gradlew assembleDebug

# --- Copy APK ---
APK_SOURCE="$OUTPUT_DIR/app-debug.apk"
APK_DEST_NAME="RJD-Phone-Rental-v${VERSION_NAME}-debug.apk"
APK_DEST="$RELEASE_DIR/$APK_DEST_NAME"

if [ ! -f "$APK_SOURCE" ]; then
  echo "ERROR: Build output not found at $APK_SOURCE"
  exit 1
fi

cp "$APK_SOURCE" "$APK_DEST"
echo "APK copied to: $APK_DEST"

# --- Update latest-release.json ---
PUBLISHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
cat > "$META_FILE" << EOF
{
  "version_code": $NEW_CODE,
  "version_name": "$VERSION_NAME",
  "filename": "$APK_DEST_NAME",
  "release_notes": "$RELEASE_NOTES",
  "published_at": "$PUBLISHED_AT"
}
EOF

echo ""
echo "Published: latest-release.json"
cat "$META_FILE"
echo ""
echo "Done! Restart the server for the changes to take effect."
echo "All rental devices will update on their next startup."
