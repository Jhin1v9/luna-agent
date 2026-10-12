#!/bin/bash
# luna-brain-sync: drains packages/kernel/.brain/.pending-commits and updates
# .brain/ via an AI subagent (kimi CLI).
#
# Behavior:
#   - Concurrency  -> an flock on .brain/.sync.lock prevents overlapping runs;
#                     a second invocation exits 0 with "already running".
#   - Empty queue  -> prints "nothing pending" and exits 0.
#   - Snapshot     -> the queue is moved to .pending-commits.inflight and a new
#                     empty queue is created, so the post-commit hook keeps
#                     appending while the sync runs. On success the inflight
#                     file is deleted; on ANY failure its hashes are appended
#                     back to the queue (no commits lost).
#   - Dead hashes  -> hashes failing `git cat-file -e <h>^{commit}` are skipped
#                     with a stderr warning instead of aborting the run. If the
#                     whole snapshot is dead, it is dropped (not restored) so a
#                     bad hash cannot block the queue forever.
#   - kimi present -> runs `kimi -p "<prompt+diffs>"` from the repo root
#                     (-p = non-interactive one-prompt mode; in this mode the
#                     agent edits files without interactive approval).
#   - kimi missing -> writes prompt+diffs to ~/.luna-brain-sync-last.md,
#                     restores the queue, prints manual instructions, exits 2.
#
# Verified against kimi-code CLI (`kimi --help`): there is no --headless flag;
# `-p, --prompt` is the non-interactive mode. Note: `-p` cannot be combined
# with `--yolo` or `--auto` (CLI rejects both) — prompt mode already applies
# edits non-interactively, verified with a real file-write test.
set -euo pipefail
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_ROOT="$(git -C "$(dirname "$SCRIPT_PATH")/.." rev-parse --show-toplevel)"
BRAIN="$REPO_ROOT/packages/kernel/.brain"
PENDING="$BRAIN/.pending-commits"
INFLIGHT="$PENDING.inflight"
FALLBACK="$HOME/.luna-brain-sync-last.md"

# Concurrency lock (fd 9 held for the life of the process).
exec 9>"$BRAIN/.sync.lock"
flock -n 9 || { echo "luna-brain-sync: already running" >&2; exit 0; }

if [ ! -s "$PENDING" ]; then
  echo "luna-brain-sync: nothing pending."
  exit 0
fi

# Snapshot the queue; recreate an empty one so the hook keeps appending.
mv "$PENDING" "$INFLIGHT"
: > "$PENDING"

restore_inflight() {
  if [ -f "$INFLIGHT" ]; then
    cat "$INFLIGHT" >> "$PENDING"
    rm -f "$INFLIGHT"
  fi
}

TMP_DIFF=$(mktemp)
trap 'rm -f "$TMP_DIFF"' EXIT

# Dedup preserving chronological order; skip unreachable hashes.
HASHES=$(awk '!seen[$0]++' "$INFLIGHT")
VALID=0
for h in $HASHES; do
  if ! git -C "$REPO_ROOT" cat-file -e "$h^{commit}" 2>/dev/null; then
    echo "luna-brain-sync: skipping unreachable commit $h" >&2
    continue
  fi
  git -C "$REPO_ROOT" show --stat --format="COMMIT %h %ad %s" --date=short "$h" >> "$TMP_DIFF"
  echo "---" >> "$TMP_DIFF"
  VALID=1
done

if [ "$VALID" -eq 0 ]; then
  echo "luna-brain-sync: no valid commits in snapshot; dropping dead hashes." >&2
  rm -f "$INFLIGHT"
  exit 0
fi

PROMPT=$(cat "$REPO_ROOT/scripts/luna-brain-sync-prompt.md")

if command -v kimi >/dev/null 2>&1; then
  if (cd "$REPO_ROOT" && kimi -p "$PROMPT

Commits to process:

$(cat "$TMP_DIFF")"); then
    rm -f "$INFLIGHT"
    # Auto-commit the .brain updates; the [brain-sync] marker makes the
    # post-commit hook skip this commit (anti-loop).
    if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- "$BRAIN")" ]; then
      if git -C "$REPO_ROOT" add -- "$BRAIN" && \
         git -C "$REPO_ROOT" commit -m "docs(brain): living-memory sync [brain-sync]" -- "$BRAIN" >/dev/null 2>&1; then
        echo "luna-brain-sync: done. .brain updates auto-committed."
      else
        echo "luna-brain-sync: auto-commit failed; .brain changes left uncommitted." >&2
      fi
    else
      echo "luna-brain-sync: done. No .brain changes needed."
    fi
  else
    status=$?
    restore_inflight
    echo "luna-brain-sync: kimi failed (exit $status); queue restored." >&2
    exit "$status"
  fi
else
  {
    echo "$PROMPT"
    echo
    echo "Commits to process:"
    echo
    cat "$TMP_DIFF"
  } > "$FALLBACK"
  restore_inflight
  echo "luna-brain-sync: 'kimi' CLI not found." >&2
  echo "Prompt+diffs written to $FALLBACK — queue restored, NOT drained." >&2
  echo "Paste that file into an agent session, let it edit .brain/, then run:" >&2
  echo "  > $PENDING" >&2
  exit 2
fi
