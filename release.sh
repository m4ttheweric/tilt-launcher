#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Get current version ──────────────────────────────────────────────
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

echo ""
echo -e "${BOLD}▲ Tilt Launcher Release${RESET}"
echo -e "${DIM}  ────────────────────────────────────${RESET}"
echo -e "  Current version: ${BOLD}v${CURRENT}${RESET}"
echo ""

# ── Prompt for bump type ─────────────────────────────────────────────
echo "  What kind of release?"
echo ""
echo -e "    ${BOLD}1${RESET}) patch  → v${MAJOR}.${MINOR}.$((PATCH + 1))  ${DIM}(bug fixes)${RESET}"
echo -e "    ${BOLD}2${RESET}) minor  → v${MAJOR}.$((MINOR + 1)).0  ${DIM}(new features)${RESET}"
echo -e "    ${BOLD}3${RESET}) major  → v$((MAJOR + 1)).0.0  ${DIM}(breaking changes)${RESET}"
echo ""
read -p "  Choose [1/2/3]: " -n 1 CHOICE
echo ""

case $CHOICE in
    1) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    2) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    3) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    *)
        echo -e "  ${RED}Invalid choice${RESET}"
        exit 1
        ;;
esac

echo ""
echo -e "  Releasing ${BOLD}v${NEW_VERSION}${RESET}"
echo ""

# ── Check for clean working tree ─────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "  ${RED}✗${RESET} Working tree has uncommitted changes."
    echo "  Commit or stash them first."
    echo ""
    exit 1
fi
echo -e "  ${GREEN}✓${RESET} Working tree clean"

# ── Check we're on main ──────────────────────────────────────────────
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo -e "  ${RED}✗${RESET} Not on main branch (on: $BRANCH)"
    exit 1
fi
echo -e "  ${GREEN}✓${RESET} On main branch"

# ── Run all checks ───────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}Running checks...${RESET}"

echo -e "  ${DIM}  Prettier...${RESET}"
bun prettier --check . --log-level=silent 2>/dev/null || {
    echo -e "  ${RED}✗${RESET} Formatting issues. Run: bun run format"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} Prettier"

echo -e "  ${DIM}  TypeScript...${RESET}"
bun tsgo --noEmit 2>/dev/null || {
    echo -e "  ${RED}✗${RESET} Type errors"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} TypeScript"

echo -e "  ${DIM}  ESLint...${RESET}"
bun eslint src/ 2>/dev/null || {
    echo -e "  ${RED}✗${RESET} Lint errors"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} ESLint"

echo -e "  ${DIM}  Swift...${RESET}"
swiftc -typecheck TiltLauncher.swift -framework Cocoa -framework ServiceManagement 2>/dev/null || {
    echo -e "  ${RED}✗${RESET} Swift type errors"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} Swift"

echo -e "  ${DIM}  Node server...${RESET}"
node --check tilt-launcher.mjs 2>/dev/null || {
    echo -e "  ${RED}✗${RESET} Node syntax error"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} Node server"

# ── Build ────────────────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}Building...${RESET}"

echo -e "  ${DIM}  Dashboard (vite)...${RESET}"
bun vite build >/dev/null 2>&1 || {
    echo -e "  ${RED}✗${RESET} Vite build failed"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} Vite build"

echo -e "  ${DIM}  Menu bar app (swiftc)...${RESET}"
bash build.sh >/dev/null 2>&1 || {
    echo -e "  ${RED}✗${RESET} Swift build failed"
    exit 1
}
echo -e "  ${GREEN}✓${RESET} Swift build"

# ── Bump version ─────────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}Bumping version...${RESET}"

# Update package.json
sed -i '' "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/" package.json

# Update Info.plist version in build.sh
sed -i '' "s/<string>${CURRENT}<\/string>/<string>${NEW_VERSION}<\/string>/g" build.sh

git add package.json build.sh
git commit -m "v${NEW_VERSION}" --no-verify
echo -e "  ${GREEN}✓${RESET} Version bumped in package.json and build.sh"

# ── Tag and push ─────────────────────────────────────────────────────
echo ""
echo -e "  ${DIM}Tagging and pushing...${RESET}"

git tag "v${NEW_VERSION}"
git push origin main "v${NEW_VERSION}"

echo -e "  ${GREEN}✓${RESET} Pushed v${NEW_VERSION}"

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}  ────────────────────────────────────${RESET}"
echo -e "  ${GREEN}${BOLD}Release v${NEW_VERSION} triggered!${RESET}"
echo ""
echo -e "  GitHub Actions is building the DMGs."
echo -e "  Release: ${DIM}https://github.com/m4ttheweric/tilt-launcher/releases/tag/v${NEW_VERSION}${RESET}"
echo -e "  Actions: ${DIM}https://github.com/m4ttheweric/tilt-launcher/actions${RESET}"
echo ""
