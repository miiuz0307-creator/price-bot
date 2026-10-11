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
# The emulator itself sometimes shows "System UI isn't responding" while booting: press "Wait".
dismiss_system_dialog() { local dump="$1" xy; xy=$(echo "$dump" | grep -E 'text="(Wait|המתן)"' | head -1 | center); [ -n "$xy" ] && adb shell input tap $xy; }
wait_text() { local dump; for _ in $(seq 1 "${2:-30}"); do dump=$(ui); echo "$dump" | grep -qF "$1" && return 0; dismiss_system_dialog "$dump"; sleep 2; done; return 1; }
shot() { sleep "${2:-3}"; adb exec-out screencap -p > "$prefix-$1.png"; }
alive() { [ -n "$(adb shell pidof $pkg)" ]; }

adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null
started=0; wait_text "כניסה" 60 && started=1
if [ "$started" != 1 ]; then  # second chance after a system dialog
  adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null; wait_text "כניסה" 30 && started=1
fi
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
    { wait_text "מסלולים במחירון" 25 || { sleep 3; ui | grep -qF "מסלולים במחירון"; }; } && signed=1
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
  # Android back button must go back inside the app, not close it.
  adb shell am start -W -a android.intent.action.VIEW -d "pricebot://prices" $pkg >/dev/null 2>&1; sleep 3
  adb shell am start -W -a android.intent.action.VIEW -d "pricebot://product/$pid" $pkg >/dev/null 2>&1; sleep 3
  adb shell input keyevent 4; sleep 3
  focus=$(adb shell dumpsys window | grep -m1 mCurrentFocus)
  if echo "$focus" | grep -q $pkg; then echo "::notice title=Back button::stays in the app ($focus)"; else echo "::warning title=Back button::app left the foreground after Back: $focus"; fi
  shot after-back 1
else
  echo "::warning title=Android smoke test::could not sign in on the emulator (screens not captured)"
fi

# Online update: publish new code to the test server; after two launches the app must run it.
ota=skipped
if [ -n "${OTA_DIR:-}" ] && [ "$signed" = 1 ]; then
  if UPDATE_URL=http://127.0.0.1:8080 node scripts/ci/publish-update.mjs "$OTA_DIR" "$OTA_CONFIG"; then
    for round in 1 2; do
      adb shell am force-stop $pkg; sleep 1
      adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 20
    done
    adb shell am start -W -a android.intent.action.VIEW -d "pricebot://more" $pkg >/dev/null 2>&1; sleep 4
    ota=missing
    for _ in 1 2 3 4; do
      if ui | grep -qF "· עדכון "; then ota=applied; break; fi
      adb shell input swipe 540 1900 540 500 300; sleep 2
    done
    shot "ota-$ota" 1
  else
    ota=publish-failed
  fi
  if [ "$ota" = applied ]; then echo "::notice title=Online update::the app downloaded and runs the published update"
  else echo "::error title=Online update::not applied ($ota)"; fi
fi

adb logcat -d > /tmp/logcat.txt
crash=$(grep -E "FATAL EXCEPTION| E AndroidRuntime| E ReactNativeJS" /tmp/logcat.txt | head -n 40)
if [ "$ota" = missing ] || [ "$ota" = publish-failed ]; then
  echo "::warning title=Updates log::$(grep -iE "expo-updates|EXUpdates|updates" /tmp/logcat.txt | tail -n 30 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  exit 1
fi
if [ -n "$crash" ] || ! alive || [ "$started" != 1 ]; then
  msg="started=$started signed_in=$signed alive=$(alive && echo yes || echo no)%0A$(echo "$crash" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  [ -z "$crash" ] && msg="$msg$(grep -E "$pkg|ReactNative|expo" /tmp/logcat.txt | tail -n 40 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  echo "::error title=Android smoke test failed::$msg"
  exit 1
fi
echo "::notice title=Android smoke test::App started, signed in=$signed, screens: $(ls "$prefix"-*.png | wc -l)"
