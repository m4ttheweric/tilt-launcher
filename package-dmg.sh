#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="TiltLauncher"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"
DMG_NAME="TiltLauncher"
DMG_PATH="$SCRIPT_DIR/$DMG_NAME.dmg"
VOLUME_NAME="Tilt Launcher"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "❌ $APP_BUNDLE not found. Run ./build.sh first."
    exit 1
fi

echo "Packaging $DMG_NAME.dmg..."

# Clean previous DMG
rm -f "$DMG_PATH"

# Create a temporary directory for the DMG contents
STAGING=$(mktemp -d)
trap "rm -rf '$STAGING'" EXIT

# Copy the app
cp -r "$APP_BUNDLE" "$STAGING/"

# Create a symlink to /Applications for drag-and-drop install
ln -s /Applications "$STAGING/Applications"

# Create the DMG
hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

echo ""
echo "✅ Created: $DMG_PATH"
echo "   Size: $(du -h "$DMG_PATH" | cut -f1)"
