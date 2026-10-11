#!/bin/sh
# Install the Mock binary (the app, sign-in/sync server and Meet bridge in one file).
# Downloads a prebuilt release; nothing else (no Node, no Go) is needed to run it.
#
#   curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh
#
# MOCK_VERSION=v0.1.0 picks a release (default: latest); MOCK_INSTALL_DIR picks where it goes
# (default: /usr/local/bin if writable, else ~/.local/bin).
set -eu

REPO="adeelahmad/Mock"
VERSION="${MOCK_VERSION:-latest}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in linux|darwin) ;; *) echo "mock: no prebuilt binary for $os; build it with 'make binary'" >&2; exit 1 ;; esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "mock: no prebuilt binary for $(uname -m); build it with 'make binary'" >&2; exit 1 ;;
esac

if [ "$VERSION" = latest ]; then base="https://github.com/$REPO/releases/latest/download"
else base="https://github.com/$REPO/releases/download/$VERSION"; fi

dir="${MOCK_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
asset="mock-$os-$arch"
echo "Downloading $asset ($VERSION)…"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || {
  echo "mock: couldn't download $asset ($VERSION). If no release is published yet, use the hosted" >&2
  echo "app (https://adeelahmad.github.io/Mock/app/) or build from source: make binary" >&2
  exit 1
}
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

want=$(grep " $asset\$" "$tmp/checksums.txt" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
else got=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); fi
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "mock: checksum mismatch for $asset" >&2; exit 1; }

chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$dir/mock"
echo "Installed $("$dir/mock" version 2>/dev/null || echo mock) to $dir/mock"
case ":$PATH:" in *":$dir:"*) ;; *) echo "Add $dir to your PATH." ;; esac
echo "Run: mock   (then open http://localhost:8787)"
