#!/bin/bash
# vexp-hint: event-driven orientation hint (UserPromptSubmit). Fails open.
VEXP_BIN="/Users/augusto/.vscode/extensions/vexp.vexp-vscode-3.1.1-darwin-arm64/binaries/vexp-core-darwin-arm64/vexp-core"
# An extension upgrade removes the versioned folder above; fall back to the
# newest installed vexp extension binary. Managed by vexp.
if [ ! -x "$VEXP_BIN" ]; then
  case "$VEXP_BIN" in
    */extensions/vexp.vexp-vscode-*)
      _vexp_ext_root="${VEXP_BIN%%/vexp.vexp-vscode-*}"
      _vexp_latest="$(ls -d "$_vexp_ext_root"/vexp.vexp-vscode-*/binaries/*/vexp-core* 2>/dev/null | sort -V | tail -n 1)"
      [ -n "$_vexp_latest" ] && [ -x "$_vexp_latest" ] && VEXP_BIN="$_vexp_latest"
      ;;
  esac
fi
[ -x "$VEXP_BIN" ] || exit 0
"$VEXP_BIN" prompt-hint 2>/dev/null
exit 0
