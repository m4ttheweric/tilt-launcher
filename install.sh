#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/tilt-launcher"
CONFIG_PATH="$CONFIG_DIR/config.json"

echo ""
echo "  ▲ Tilt Launcher Installer"
echo "  ─────────────────────────"
echo ""

# ── Check prerequisites ──────────────────────────────────────────────
check_cmd() {
    if command -v "$1" &>/dev/null; then
        echo "  ✅ $1 found: $(command -v "$1")"
        return 0
    else
        echo "  ❌ $1 not found"
        return 1
    fi
}

echo "Checking prerequisites..."
MISSING=0
check_cmd node || MISSING=1
check_cmd tilt || MISSING=1
check_cmd swiftc || MISSING=1

# bun is preferred but not required
if command -v bun &>/dev/null; then
    echo "  ✅ bun found: $(command -v bun)"
    PKG_MGR="bun"
else
    echo "  ⚠️  bun not found, using npm"
    PKG_MGR="npm"
fi

echo ""

if [ "$MISSING" -eq 1 ]; then
    echo "Missing prerequisites. Please install them and re-run."
    echo ""
    echo "  brew install node"
    echo "  brew install tilt-dev/tap/tilt"
    echo "  # Optional: brew install oven-sh/bun/bun"
    echo ""
    exit 1
fi

# ── Install dependencies ─────────────────────────────────────────────
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
if [ "$PKG_MGR" = "bun" ]; then
    bun install
else
    npm install
fi
echo ""

# ── Build frontend ───────────────────────────────────────────────────
echo "Building dashboard..."
if [ "$PKG_MGR" = "bun" ]; then
    bun run build
else
    npx vite build
fi
echo ""

# ── Build Swift app ──────────────────────────────────────────────────
echo "Building menu bar app..."
bash "$SCRIPT_DIR/build.sh"
echo ""

# ── Install to /Applications ─────────────────────────────────────────
echo "Installing to /Applications..."
cp -r "$SCRIPT_DIR/TiltLauncher.app" /Applications/
xattr -cr /Applications/TiltLauncher.app 2>/dev/null || true
echo "  ✅ Installed to /Applications/TiltLauncher.app"
echo ""

# ── Create config if not exists ──────────────────────────────────────
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_PATH" ]; then
    cp "$SCRIPT_DIR/config.example.json" "$CONFIG_PATH"
    echo "  📋 Created config at $CONFIG_PATH"
    echo "     Edit this file to add your Tilt environments."
else
    echo "  📋 Config already exists at $CONFIG_PATH"
fi
echo ""

# ── Optional: HTTPS setup ────────────────────────────────────────────
echo "─────────────────────────────────────────"
echo ""
echo "Optional: Set up HTTPS with a custom domain?"
echo "This requires mkcert and sudo access."
echo ""
read -p "Set up HTTPS? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Domain name (e.g. local.dev, tilt.test): " DOMAIN
    DOMAIN=${DOMAIN:-localhost}

    # Check mkcert
    if ! command -v mkcert &>/dev/null; then
        echo "  Installing mkcert..."
        brew install mkcert
    fi

    echo "  Installing local CA (may require password)..."
    mkcert -install

    echo "  Generating certificate for $DOMAIN..."
    mkdir -p "$SCRIPT_DIR/.certs"
    cd "$SCRIPT_DIR/.certs"
    mkcert "$DOMAIN"
    cd "$SCRIPT_DIR"

    # Hosts entry
    if ! grep -q "$DOMAIN" /etc/hosts 2>/dev/null; then
        echo "  Adding $DOMAIN to /etc/hosts (requires sudo)..."
        echo "127.0.0.1	$DOMAIN" | sudo tee -a /etc/hosts >/dev/null
    fi

    # Port forwarding
    echo "  Setting up port forwarding 443 → $( grep -o '"port": [0-9]*' "$CONFIG_PATH" | head -1 | grep -o '[0-9]*' || echo 10400 )..."
    PORT=$( grep -o '"port": [0-9]*' "$CONFIG_PATH" | head -1 | grep -o '[0-9]*' || echo 10400 )
    echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port $PORT" | sudo pfctl -ef - 2>/dev/null || true

    # Update config dashboardUrl
    if command -v python3 &>/dev/null; then
        python3 -c "
import json
with open('$CONFIG_PATH') as f: c = json.load(f)
c['dashboardUrl'] = 'https://$DOMAIN'
with open('$CONFIG_PATH', 'w') as f: json.dump(c, f, indent=2)
"
        echo "  ✅ Updated dashboardUrl to https://$DOMAIN"
    else
        echo "  ⚠️  Update dashboardUrl in $CONFIG_PATH to https://$DOMAIN"
    fi

    echo ""
fi

# ── Done ─────────────────────────────────────────────────────────────
echo "─────────────────────────────────────────"
echo ""
echo "  ✅ Tilt Launcher installed!"
echo ""
echo "  Config:    $CONFIG_PATH"
echo "  Logs:      $CONFIG_DIR/server.log"
echo "  Dashboard: $(grep -o '"dashboardUrl": "[^"]*"' "$CONFIG_PATH" | cut -d'"' -f4 || echo "http://localhost:10400")"
echo ""
echo "  To launch: open /Applications/TiltLauncher.app"
echo "  To auto-start: System Settings → General → Login Items"
echo ""
echo "  Edit your config to add Tilt environments:"
echo "  $CONFIG_PATH"
echo ""
