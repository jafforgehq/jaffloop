#!/bin/bash
# Builds, signs (Developer ID, hardened runtime) and optionally notarizes Jaffloop.app.
#
#   scripts/build-app.sh                       # signed with the first Developer ID found
#   SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" scripts/build-app.sh
#   SIGN_IDENTITY=- scripts/build-app.sh       # ad-hoc (local use only)
#   NOTARY_PROFILE=jaffloop scripts/build-app.sh   # also notarize + staple (see README)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-0.0.4}"
OUT="dist"
APP="$OUT/Jaffloop.app"

if [ -z "${SIGN_IDENTITY:-}" ]; then
  SIGN_IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)
  SIGN_IDENTITY="${SIGN_IDENTITY:--}"
fi
echo "==> signing identity: $SIGN_IDENTITY"

rm -rf "$OUT"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> building (release, arm64)"
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)"
cp "$BIN/Jaffloop" "$APP/Contents/MacOS/Jaffloop"
cp "$BIN/jaffloop-mcp" "$APP/Contents/MacOS/jaffloop-mcp"
sed "s/__VERSION__/$VERSION/g" scripts/Info.plist > "$APP/Contents/Info.plist"

echo "==> icon"
ICONSET="$(mktemp -d)/AppIcon.iconset"
swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> codesign"
OPTS=(--force --timestamp --options runtime --sign "$SIGN_IDENTITY")
[ "$SIGN_IDENTITY" = "-" ] && OPTS=(--force --sign -)
codesign "${OPTS[@]}" "$APP/Contents/MacOS/jaffloop-mcp"
codesign "${OPTS[@]}" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

ZIP="$OUT/Jaffloop-$VERSION.zip"
ditto -c -k --keepParent "$APP" "$ZIP"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  echo "==> notarizing"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  rm "$ZIP"; ditto -c -k --keepParent "$APP" "$ZIP"
  spctl --assess --type execute --verbose=2 "$APP"
else
  echo "==> NOT notarized (set NOTARY_PROFILE to notarize)"
fi
( cd "$OUT" && shasum -a 256 "Jaffloop-$VERSION.zip" > "Jaffloop-$VERSION.zip.sha256" )
echo "==> done: $ZIP"
