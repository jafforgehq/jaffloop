#!/usr/bin/env bash
# Proves auto update end to end on this Mac, with no network and no published release:
#   1. takes the signed Jaffloop.app from ./release (run scripts/release-mac.sh --skip-notarize --arch arm64 first) as "installed" 0.x.y,
#   2. builds a signed "x.y.(z+1)" next to it, serves it from a local feed,
#   3. launches the installed copy pointed at that feed, lets it download and install itself, and checks the new version.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="release/mac-arm64/Jaffloop.app"
[ -d "$APP" ] || { echo "build a signed app first: scripts/release-mac.sh --skip-notarize --arch arm64" >&2; exit 1; }
CUR="$(node -p "require('./package.json').version")"
NEXT="$(node -p "const v=require('./package.json').version.split('.').map(Number); v[2]++; v.join('.')")"
WORK="$(mktemp -d)"; PORT=8765
cleanup() { pkill -f "$WORK/Jaffloop.app" 2>/dev/null || true; pkill -f "http.server $PORT" 2>/dev/null || true; sed -i.bak "s/\"version\": \"$NEXT\"/\"version\": \"$CUR\"/" package.json; rm -f package.json.bak .electron-builder.nonotarize.yml; rm -rf "$WORK/feed"; node scripts/build.mjs >/dev/null 2>&1 || true; }
trap cleanup EXIT

cp -R "$APP" "$WORK/Jaffloop.app"
sed -i.bak "s/\"version\": \"$CUR\"/\"version\": \"$NEXT\"/" package.json && rm package.json.bak
node scripts/build.mjs >/dev/null
printf 'extends: ./electron-builder.signed.yml\nmac:\n  notarize: false\n' > .electron-builder.nonotarize.yml
npx electron-builder --mac --arm64 --publish never --config .electron-builder.nonotarize.yml --config.directories.output="$WORK/feed" >/dev/null
(cd "$WORK/feed" && python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &)
sleep 1
echo "installed: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$WORK/Jaffloop.app/Contents/Info.plist")  feed offers: $NEXT"
env -u ELECTRON_RUN_AS_NODE JAFFLOOP_DB="$WORK/db.sqlite" JAFFLOOP_USERDATA="$WORK/ud" JAFFLOOP_UPDATE_FEED="http://127.0.0.1:$PORT" \
  JAFFLOOP_UPDATE_ANSWER=install JAFFLOOP_SEED=1 nohup "$WORK/Jaffloop.app/Contents/MacOS/Jaffloop" --background >/dev/null 2>&1 &
for _ in $(seq 1 25); do
  V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$WORK/Jaffloop.app/Contents/Info.plist")"
  [ "$V" = "$NEXT" ] && break
  sleep 8
done
[ "$V" = "$NEXT" ] || { echo "FAIL: still $V after waiting" >&2; exit 1; }
codesign --verify --deep --strict "$WORK/Jaffloop.app"
echo "UPDATE OK: $CUR -> $V, signature valid"
