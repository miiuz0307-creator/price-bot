#!/usr/bin/env bash
# android-smoke.sh <apk> <out-prefix>
# On the running emulator: installs the app, checks it starts and shows the sign-in
# screen, signs in to the local test server (demo data) and screenshots the main
# screens. Fails only if the app crashes or never shows the sign-in screen.
set -uo pipefail
apk="$1"; prefix="$2"; pkg=app.pricebot.mobile
mkdir -p "$(dirname "$prefix")"
rm -f "$prefix"-*.png
adb wait-for-device
adb reverse tcp:8080 tcp:8080 || true
adb install -r "$apk" || { echo "::error title=Android smoke test::install failed"; exit 1; }
adb logcat -c

ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null | tr '>' '\n'; }
center() { sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
tap_text() { local xy; xy=$(ui | grep -F "text=\"$1\"" | head -1 | center); [ -n "$xy" ] && adb shell input tap $xy; }
wait_text() { for _ in $(seq 1 "${2:-30}"); do ui | grep -qF "$1" && return 0; sleep 2; done; return 1; }
shot() { sleep "${2:-3}"; adb exec-out screencap -p > "$prefix-$1.png"; }
alive() { [ -n "$(adb shell pidof $pkg)" ]; }

adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null
started=0; wait_text "כניסה" 60 && started=1
shot login 2
if [ "$started" != 1 ]; then
  echo "::warning title=UI dump::$(adb shell uiautomator dump /sdcard/ui.xml 2>&1 | head -3 | tr '\n' ' ') $(adb shell cat /sdcard/ui.xml 2>/dev/null | head -c 1500 | sed -e 's/%/%25/g')"
fi

# Sign in with the demo owner's personal code.
signed=0
if [ "$started" = 1 ]; then
  tap_text "כניסה עם קוד אישי"; sleep 2
  mapfile -t fields < <(ui | grep 'class="android.widget.EditText"' | center)
  echo "::notice title=Sign-in fields::${#fields[@]} fields: ${fields[*]}"
  if [ "${#fields[@]}" -ge 2 ]; then
    adb shell input tap ${fields[0]}; sleep 1; adb shell input text 0504107826
    adb shell input tap ${fields[1]}; sleep 1; adb shell input text 2468
    shot pin-filled 1
    adb shell input keyevent 66; sleep 2
    tap_text "כניסה"
    wait_text "מסלולים במחירון" 25 && signed=1
    [ "$signed" = 1 ] || { shot signin-failed 1; echo "::warning title=Sign-in screen::$(ui | grep -o 'text="[^"]*"' | grep -v 'text=""' | head -30 | tr '\n' ' ')"; }
  fi
fi
if [ "$signed" = 1 ]; then
  shot home 3
  token=$(curl -s -H 'content-type: application/json' -H 'x-price-bot-client: mobile' -d '{"identifier":"0504107826","code":"2468"}' http://127.0.0.1:8080/api/auth/pin | jq -r .token)
  pid=$(curl -s -H "authorization: Bearer $token" http://127.0.0.1:8080/api/products | jq -r '[.[] | select(.name|startswith("בני ברק"))][0].id')
  for screen in prices "product/$pid" requests surge more whatsapp targets users activity; do
    adb shell am start -W -a android.intent.action.VIEW -d "pricebot://$screen" $pkg >/dev/null 2>&1
    name=$(echo "$screen" | sed 's#product/.*#route#')
    shot "$name" 4
    alive || break
  done
else
  echo "::warning title=Android smoke test::could not sign in on the emulator (screens not captured)"
fi

adb logcat -d > /tmp/logcat.txt
crash=$(grep -E "FATAL EXCEPTION| E AndroidRuntime| E ReactNativeJS" /tmp/logcat.txt | head -n 40)
if [ -n "$crash" ] || ! alive || [ "$started" != 1 ]; then
  msg="started=$started signed_in=$signed alive=$(alive && echo yes || echo no)%0A$(echo "$crash" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  [ -z "$crash" ] && msg="$msg$(grep -E "$pkg|ReactNative|expo" /tmp/logcat.txt | tail -n 40 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  echo "::error title=Android smoke test failed::$msg"
  exit 1
fi
echo "::notice title=Android smoke test::App started, signed in=$signed, screens: $(ls "$prefix"-*.png | wc -l)"
