#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

version="${INPUT_VERSION:-}"
if [ -z "$version" ]; then version=$(jq -r .version "$GITHUB_ACTION_PATH/cli/package.json"); fi
version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "version must be a niksi version such as 0.3.7, not $version."

case "$RUNNER_OS" in
  Linux) os=linux ;;
  macOS) os=darwin ;;
  *) fail "niksi has no build for $RUNNER_OS." ;;
esac
case "$RUNNER_ARCH" in
  X64) arch=x64 ;;
  ARM64) arch=arm64 ;;
  *) fail "niksi has no build for $RUNNER_ARCH." ;;
esac

archive="niksi-$os-$arch.tar.gz"
base="https://github.com/osrim/niksi/releases/download/v$version"
dir="$RUNNER_TEMP/niksi-$version"
mkdir -p "$dir"
cd "$dir"
curl -fsSL --retry 3 -o "$archive" "$base/$archive" || fail "Could not download $base/$archive."
curl -fsSL --retry 3 -o checksums.txt "$base/checksums.txt" || fail "Could not download $base/checksums.txt."
awk -v file="$archive" '$2 == file' checksums.txt > expected
[ -s expected ] || fail "checksums.txt of niksi $version has no line for $archive."
if command -v sha256sum > /dev/null; then sha256sum -c expected; else shasum -a 256 -c expected; fi
tar xzf "$archive" nik
echo "$dir" >> "$GITHUB_PATH"
"$dir/nik" --version
