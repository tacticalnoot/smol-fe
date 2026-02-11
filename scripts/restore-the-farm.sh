#!/usr/bin/env bash
# Usage: ./scripts/restore-the-farm.sh [COMMIT_HASH] [--force]
#
# Restores the original THE FARM page from git history.
# If no commit hash is given, auto-detects the last good commit
# before the overwrite (d05be95).
#
# Safety: Aborts if uncommitted changes exist in target paths
# unless --force is passed.
set -euo pipefail

FARM_PAGE="src/pages/labs/the-farm.astro"
OVERWRITE_COMMIT="d05be95"
FORCE=false
COMMIT_HASH=""

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        *) COMMIT_HASH="$arg" ;;
    esac
done

# Auto-detect the last good commit if none provided
if [[ -z "$COMMIT_HASH" ]]; then
    echo "No commit hash provided. Auto-detecting last good commit..."
    echo ""

    # Find the commit immediately before the overwrite commit
    # The overwrite commit (d05be95) replaced the page with a redirect.
    # The commit before it for this file is the last good version.
    COMMIT_HASH=$(git log --format="%H" -- "$FARM_PAGE" | while read -r hash; do
        SHORT=$(git rev-parse --short "$hash")
        # Skip the overwrite and any commits after it
        if [[ "$SHORT" == "$OVERWRITE_COMMIT"* ]]; then
            # The next commit in the log (older) is the good one
            read -r good_hash
            echo "$good_hash"
            break
        fi
    done)

    if [[ -z "$COMMIT_HASH" ]]; then
        # Fallback: find the parent of the overwrite commit for this file
        FULL_OVERWRITE=$(git log --all --format="%H" --grep="Redirect /labs/the-farm" -- "$FARM_PAGE" | head -1)
        if [[ -n "$FULL_OVERWRITE" ]]; then
            COMMIT_HASH=$(git rev-parse "${FULL_OVERWRITE}~1")
        fi
    fi

    if [[ -z "$COMMIT_HASH" ]]; then
        echo "ERROR: Could not auto-detect the last good commit."
        echo "Please provide it manually: ./scripts/restore-the-farm.sh <COMMIT_HASH>"
        exit 1
    fi

    SHORT_HASH=$(git rev-parse --short "$COMMIT_HASH")
    COMMIT_MSG=$(git log -1 --format="%s" "$COMMIT_HASH")
    echo "Detected last good commit: $SHORT_HASH ($COMMIT_MSG)"
    echo "Reasoning: This is the commit immediately before the overwrite ($OVERWRITE_COMMIT)"
    echo "           which replaced the page with a 301 redirect."
    echo ""
fi

# Verify the commit exists
if ! git cat-file -e "$COMMIT_HASH" 2>/dev/null; then
    echo "ERROR: Commit $COMMIT_HASH does not exist."
    exit 1
fi

# Verify the file exists at that commit
if ! git show "$COMMIT_HASH:$FARM_PAGE" >/dev/null 2>&1; then
    echo "ERROR: $FARM_PAGE does not exist at commit $COMMIT_HASH"
    exit 1
fi

# Check for uncommitted changes
DIRTY_FILES=$(git diff --name-only -- "$FARM_PAGE" 2>/dev/null || true)
STAGED_FILES=$(git diff --cached --name-only -- "$FARM_PAGE" 2>/dev/null || true)

if [[ -n "$DIRTY_FILES" || -n "$STAGED_FILES" ]]; then
    echo "WARNING: Uncommitted changes detected in:"
    [[ -n "$DIRTY_FILES" ]] && echo "  (unstaged) $DIRTY_FILES"
    [[ -n "$STAGED_FILES" ]] && echo "  (staged)   $STAGED_FILES"
    echo ""
    if [[ "$FORCE" != true ]]; then
        echo "Aborting. Use --force to overwrite, or commit/stash changes first."
        exit 1
    fi
    echo "--force specified. Proceeding anyway."
    echo ""
fi

# Extract the file
echo "Restoring $FARM_PAGE from commit $(git rev-parse --short "$COMMIT_HASH")..."
git show "$COMMIT_HASH:$FARM_PAGE" > "$FARM_PAGE"

echo ""
echo "=== Restoration Complete ==="
echo "  File:   $FARM_PAGE"
echo "  Source: $(git rev-parse --short "$COMMIT_HASH") ($(git log -1 --format="%s" "$COMMIT_HASH"))"
echo ""
echo "REMINDER: The restored page loads TheFarmCore.svelte (the original game)."
echo "          You still need to re-apply the game link cards and sample proofs"
echo "          sections if you want the full merged page layout."
echo ""
echo "Next steps:"
echo "  1. Review the restored file:  git diff $FARM_PAGE"
echo "  2. Integrate game links section (dungeon-room, play, zkdungeon)"
echo "  3. Add sample proofs section"
echo "  4. Commit when satisfied"
