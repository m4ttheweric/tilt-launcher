#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="TiltLauncher"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"

echo "Building $APP_NAME..."

# Clean previous build
rm -rf "$APP_BUNDLE"

# Create .app bundle structure
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    TARGET="arm64-apple-macosx14.0"
else
    TARGET="x86_64-apple-macosx14.0"
fi

# Compile Swift source
swiftc \
    -O \
    -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME" \
    "$SCRIPT_DIR/TiltLauncher.swift" \
    -framework Cocoa \
    -target "$TARGET"

# Bundle server + dashboard + config into Resources
cp "$SCRIPT_DIR/tilt-launcher.mjs" "$APP_BUNDLE/Contents/Resources/"
cp "$SCRIPT_DIR/config.example.json" "$APP_BUNDLE/Contents/Resources/"

if [ -d "$SCRIPT_DIR/dist" ]; then
    cp -r "$SCRIPT_DIR/dist" "$APP_BUNDLE/Contents/Resources/dist"
else
    echo "⚠️  dist/ not found — run 'bun run build' first for the dashboard"
fi

# Copy app icon
if [ -f "$SCRIPT_DIR/AppIcon.icns" ]; then
    cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi

# Copy certs if they exist (for dev builds)
if [ -d "$SCRIPT_DIR/.certs" ]; then
    cp -r "$SCRIPT_DIR/.certs" "$APP_BUNDLE/Contents/Resources/.certs"
fi

# Create Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Tilt Launcher</string>
    <key>CFBundleDisplayName</key>
    <string>Tilt Launcher</string>
    <key>CFBundleIdentifier</key>
    <string>dev.tilt-launcher</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSDocumentsFolderUsageDescription</key>
    <string>Tilt Launcher needs access to your project directories to run Tilt commands.</string>
    <key>NSDesktopFolderUsageDescription</key>
    <string>Tilt Launcher needs access to your project directories to run Tilt commands.</string>
    <key>NSDownloadsFolderUsageDescription</key>
    <string>Tilt Launcher needs access to your project directories to run Tilt commands.</string>
</dict>
</plist>
PLIST

echo ""
echo "✅ Built: $APP_BUNDLE"
echo ""
echo "To install:    cp -r $APP_BUNDLE /Applications/"
echo "To run:        open /Applications/$APP_NAME.app"
echo "To auto-start: add to System Settings → General → Login Items"
