#!/usr/bin/env bash
# Ensure Wails CLI / go.mod / @wailsio/runtime stay on the same version.
# Usage:
#   ./scripts/check-wails-version.sh           # require wails3 on PATH
#   ./scripts/check-wails-version.sh --skip-cli # skip CLI check if binary missing
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_CLI=0
for arg in "$@"; do
  case "$arg" in
    --skip-cli) SKIP_CLI=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-cli]"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

GO_VER="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3)"
if [[ -z "$GO_VER" ]]; then
  echo "error: failed to read github.com/wailsapp/wails/v3 from go.mod" >&2
  exit 1
fi
# npm package versions omit the leading "v"
NPM_EXPECT="${GO_VER#v}"

PKG_JSON="$ROOT/frontend/package.json"
if [[ ! -f "$PKG_JSON" ]]; then
  echo "error: missing $PKG_JSON" >&2
  exit 1
fi

# Pure-shell parse so Windows CI bash works without depending on python/node.
RUNTIME_SPEC="$(
  grep -E '"@wailsio/runtime"' frontend/package.json \
    | head -n 1 \
    | sed -E 's/.*"@wailsio\/runtime"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
)"

if [[ -z "$RUNTIME_SPEC" ]]; then
  echo "error: frontend/package.json missing dependencies['@wailsio/runtime']" >&2
  exit 1
fi

if [[ "$RUNTIME_SPEC" == ^* || "$RUNTIME_SPEC" == ~* ]]; then
  echo "error: @wailsio/runtime must be an exact pin (no ^ or ~): got \"$RUNTIME_SPEC\"" >&2
  echo "  go.mod: github.com/wailsapp/wails/v3 $GO_VER" >&2
  echo "  fix: set frontend/package.json \"@wailsio/runtime\" to \"$NPM_EXPECT\" then reinstall lockfile" >&2
  exit 1
fi

if [[ "$RUNTIME_SPEC" != "$NPM_EXPECT" ]]; then
  echo "error: @wailsio/runtime \"$RUNTIME_SPEC\" != go.mod $GO_VER (expected exact \"$NPM_EXPECT\")" >&2
  echo "  CLI / go.mod / @wailsio/runtime 必须同一版本；不要自行升 beta。" >&2
  echo "  fix: pin frontend/package.json to \"$NPM_EXPECT\" and refresh bun.lock" >&2
  exit 1
fi

if command -v wails3 >/dev/null 2>&1; then
  CLI_OUT="$(wails3 version 2>&1 || true)"
  if [[ "$CLI_OUT" != *"$GO_VER"* ]]; then
    echo "error: wails3 version mismatch" >&2
    echo "  go.mod:  $GO_VER" >&2
    echo "  wails3:  $CLI_OUT" >&2
    echo "  install: go install github.com/wailsapp/wails/v3/cmd/wails3@$GO_VER" >&2
    exit 1
  fi
elif [[ "$SKIP_CLI" -eq 1 ]]; then
  echo "check-wails-version: wails3 not on PATH; skipping CLI check (--skip-cli)"
else
  echo "error: wails3 not found on PATH (required for task build/dev)" >&2
  echo "  go.mod expects: $GO_VER" >&2
  echo "  install: go install github.com/wailsapp/wails/v3/cmd/wails3@$GO_VER" >&2
  exit 1
fi

echo "wails versions OK: go.mod=$GO_VER @wailsio/runtime=$RUNTIME_SPEC"
