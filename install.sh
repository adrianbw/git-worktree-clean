#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
WRAPPER="$REPO_DIR/bin/git-worktree-clean"
LINK="$BIN_DIR/git-worktree-clean"

echo "Installing git-worktree-clean..."

# Install dependencies
echo "→ Installing dependencies with pnpm..."
cd "$REPO_DIR"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
elif command -v corepack >/dev/null 2>&1; then
  corepack pnpm install
else
  echo "✗ pnpm not found. Install it (e.g. 'npm i -g pnpm', 'brew install pnpm', or enable corepack) and re-run." >&2
  exit 1
fi

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

# Install shell function so the 'o' (open) key can cd the parent shell.
# The function wraps the binary, passes a temp file via env var, and cd's
# into whatever path the binary writes to that file.
install_shell_function() {
  local rcfile="$1"
  [ -f "$rcfile" ] || return 0
  if grep -q "git-worktree-clean shell function" "$rcfile"; then
    echo "→ Shell function already installed in $rcfile"
    return 0
  fi
  cat >> "$rcfile" <<'EOF'

# >>> git-worktree-clean shell function >>>
git-worktree-clean() {
  local cd_file
  cd_file="$(mktemp -t gwtc.XXXXXX)" || return 1
  GIT_WORKTREE_CLEAN_CD_FILE="$cd_file" command git-worktree-clean "$@"
  local rc=$?
  if [ -s "$cd_file" ]; then
    cd "$(cat "$cd_file")" || true
  fi
  rm -f "$cd_file"
  return $rc
}
# <<< git-worktree-clean shell function <<<
EOF
  echo "→ Added shell function to $rcfile"
}

install_shell_function "$HOME/.zshrc"
install_shell_function "$HOME/.bashrc"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "⚠ $BIN_DIR is not on your PATH."
  echo "  Add this to your shell profile (~/.zshrc or ~/.bashrc):"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "✓ Installed! Reload your shell (or 'source ~/.zshrc'), then run 'git-worktree-clean' from any git repo."
