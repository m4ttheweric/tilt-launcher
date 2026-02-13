#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Parse flags ──────────────────────────────────────────────────────
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
    DRY_RUN=1
fi

# ── Get current version ──────────────────────────────────────────────
CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

echo ""
echo -e "${BOLD}▲ Tilt Launcher Release${RESET}"
if [ "$DRY_RUN" -eq 1 ]; then
    echo -e "  ${DIM}(dry run — no changes will be made)${RESET}"
fi
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

# ── Run all checks (same as pre-commit) ──────────────────────────────
echo ""
bash "$SCRIPT_DIR/hooks/pre-commit" || {
    echo ""
    echo -e "  ${RED}Checks failed. Fix the issues above and try again.${RESET}"
    echo ""
    exit 1
}

# ── Dry run stops here ───────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
    echo ""
    echo -e "${DIM}  ────────────────────────────────────${RESET}"
    echo -e "  ${GREEN}${BOLD}Dry run passed!${RESET}"
    echo ""
    echo -e "  All checks passed. If this were a real release:"
    echo -e "    • Version would bump to ${BOLD}v${NEW_VERSION}${RESET}"
    echo -e "    • package.json and build.sh would be updated"
    echo -e "    • Tag ${BOLD}v${NEW_VERSION}${RESET} would be created and pushed"
    echo -e "    • GitHub Actions would build DMGs"
    echo ""
    echo -e "  Run without ${BOLD}--dry-run${RESET} to release for real."
    echo ""
    exit 0
fi

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
