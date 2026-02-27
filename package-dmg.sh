#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_BUNDLE="${1:-}"
DMG_PATH_ARG="${2:-}"
APP_NAME="TiltLauncher"
if [ -z "$APP_BUNDLE" ]; then
    echo "Usage: ./package-dmg.sh <path-to-app-bundle> [output-dmg-path]"
    exit 1
fi
DMG_PATH="${DMG_PATH_ARG:-$SCRIPT_DIR/$APP_NAME.dmg}"
VOLUME_NAME="Tilt Launcher"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "❌ $APP_BUNDLE not found."
    exit 1
fi

echo "Packaging $(basename "$DMG_PATH")..."

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
