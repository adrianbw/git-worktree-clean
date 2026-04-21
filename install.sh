#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
WRAPPER="$REPO_DIR/bin/git-worktree-clean"
LINK="$BIN_DIR/git-worktree-clean"

echo "Installing git-worktree-clean..."

# Install dependencies
echo "→ Installing npm dependencies..."
cd "$REPO_DIR"
npm install

# Make wrapper executable
chmod +x "$WRAPPER"

# Create bin directory if needed
mkdir -p "$BIN_DIR"

# Create symlink (replace if exists)
if [ -L "$LINK" ] || [ -e "$LINK" ]; then
  echo "→ Replacing existing $LINK"
  rm "$LINK"
fi
ln -s "$WRAPPER" "$LINK"
echo "→ Symlinked $LINK → $WRAPPER"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "⚠ $BIN_DIR is not on your PATH."
  echo "  Add this to your shell profile (~/.zshrc or ~/.bashrc):"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "✓ Installed! Run 'git-worktree-clean' from any git repo."
