#!/usr/bin/env bash
# android-smoke.sh <apk> <out-dir>: installs the app on the running emulator, opens it,
# and fails if it crashes or never draws the sign-in screen.
set -uo pipefail
apk="$1"; out="$2"; pkg=app.pricebot.mobile
mkdir -p "$out"
adb wait-for-device
adb install -r "$apk" || { echo "::error title=Android smoke test::install failed"; exit 1; }
adb logcat -c
adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null
ok=0
for i in $(seq 1 45); do
  sleep 2
  if adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml | grep -q "כניסה"; then ok=1; break; fi
done
sleep 3
adb exec-out screencap -p > "$out/android-emulator-login.png"
adb logcat -d > /tmp/logcat.txt
crash=$(grep -E "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS: .*(Error|Invariant)" /tmp/logcat.txt | head -n 40)
alive=$(adb shell pidof $pkg || true)
if [ -n "$crash" ] || [ -z "$alive" ] || [ "$ok" != 1 ]; then
  msg="started=$ok pid=${alive:-none}%0A$(echo "$crash" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  [ -z "$crash" ] && msg="$msg$(grep -E "$pkg|ReactNative|expo" /tmp/logcat.txt | tail -n 40 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  echo "::error title=Android smoke test failed::$msg"
  exit 1
fi
echo "::notice title=Android smoke test::App started and shows the sign-in screen (pid $alive)"
