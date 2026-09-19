#!/usr/bin/env bash
# BrownSpot installer — safe for: curl -fsSL <URL> | bash
# On native Windows use scripts/install.ps1 instead (irm … | iex).
# This bash script covers macOS, Linux, and WSL.
set -euo pipefail

REPO="KhriseanStewart/brownspot"
INSTALL_DIR="${BROWNSPOT_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="dotstart"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
GITHUB_DOWNLOAD="${GITHUB_DOWNLOAD:-https://github.com}"

err() { printf 'brownspot-install: %s\n' "$*" >&2; exit 1; }
info() { printf 'brownspot-install: %s\n' "$*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "required command not found: $1"
}

detect_target() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin|linux) ;;
    *) err "unsupported OS: $(uname -s) (need macOS or Linux)" ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) err "unsupported architecture: $(uname -m)" ;;
  esac

  printf '%s-%s' "$os" "$arch"
}

resolve_version() {
  if [[ -n "${BROWNSPOT_VERSION:-}" ]]; then
    printf '%s' "${BROWNSPOT_VERSION#v}"
    return
  fi
  need_cmd curl
  local tag
  tag="$(curl -fsSL "${GITHUB_API}/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1)"
  [[ -n "$tag" ]] || err "could not resolve latest release for ${REPO}"
  printf '%s' "${tag#v}"
}

download() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    # -f fail on HTTP errors, -L follow redirects, -# progress to stderr (visible under curl|bash)
    # Avoid -s so large binaries do not look "stuck".
    curl -fL --progress-bar "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$dest" "$url"
  else
    err "need curl or wget to download"
  fi
}

main() {
  need_cmd uname
  need_cmd mkdir
  need_cmd chmod
  need_cmd mktemp
  need_cmd mv

  local target version asset tag url tmp
  target="$(detect_target)"
  version="$(resolve_version)"
  tag="v${version}"
  asset="${BIN_NAME}-${target}"
  url="${GITHUB_DOWNLOAD}/${REPO}/releases/download/${tag}/${asset}"

  info "installing ${BIN_NAME} ${tag} (${target})"
  info "downloading ${url} (this can take a minute — binary is large)"
  mkdir -p "$INSTALL_DIR"

  tmp="$(mktemp "${TMPDIR:-/tmp}/${asset}.XXXXXX")"
  # shellcheck disable=SC2064
  trap 'rm -f "$tmp"' EXIT

  if ! download "$url" "$tmp"; then
    err "download failed: ${url}"
  fi

  # Refuse empty / HTML error pages
  if [[ ! -s "$tmp" ]]; then
    err "downloaded file is empty — is release ${tag} published with ${asset}?"
  fi
  if head -c 15 "$tmp" 2>/dev/null | grep -qi '<!DOCTYPE\|<html'; then
    err "download returned HTML, not a binary — check that ${tag} includes ${asset}"
  fi

  chmod +x "$tmp"
  mv -f "$tmp" "${INSTALL_DIR}/${BIN_NAME}"
  trap - EXIT

  info "installed ${INSTALL_DIR}/${BIN_NAME}"

  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      info "note: ${INSTALL_DIR} is not on your PATH"
      info "add this to your shell profile, then reopen the terminal:"
      info "  export PATH=\"${INSTALL_DIR}:\$PATH\""
      ;;
  esac

  info "run: ${BIN_NAME}"
}

main "$@"
