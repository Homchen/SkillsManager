#!/usr/bin/env bash
set -euo pipefail

AGENT=""
USER_HOME="${HOME:-}"
ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent|-Agent)
      AGENT="${2:-}"
      shift 2
      ;;
    --user-home|-UserHome)
      USER_HOME="${2:-}"
      shift 2
      ;;
    --all|-All)
      ALL=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$ALL" -ne 1 && -z "$AGENT" ]]; then
  echo "Pass --agent <id> or --all" >&2
  exit 1
fi

if [[ -z "$USER_HOME" ]]; then
  echo "User home is empty; pass --user-home or set HOME." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Hook uninstaller requires node on PATH, but node was not found." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$ALL" -eq 1 ]]; then
  exec node "$ROOT/lib/manage.cjs" uninstall --all --user-home "$USER_HOME"
fi
exec node "$ROOT/lib/manage.cjs" uninstall --agent "$AGENT" --user-home "$USER_HOME"
