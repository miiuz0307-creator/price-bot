#!/usr/bin/env bash
# Seeds a running server (BASE_URL) with demo data through the public API.
set -euo pipefail
B="${BASE_URL:-http://127.0.0.1:8080}/api"
J='-H content-type:application/json'
cookie=$(curl -s -D - -o /dev/null $J -d '{"identifier":"0504107826","code":"2468"}' "$B/auth/pin" | grep -i '^set-cookie: price_bot_session' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/')
[ -n "$cookie" ] || { echo "::error title=Seed::owner login failed"; exit 1; }
C=(-H "cookie: $cookie")
m() { echo "[$1,$(( $1*2-20 )),$(( $1+30 )),$(( $1*2+40 )),$(( $1+50 )),$(( $1*2+80 )),$(( $1+70 )),$(( $1*2+120 ))]"; }
post() { curl -sf "${C[@]}" $J -X "$1" -d "$3" "$B$2" >/dev/null || echo "seed: $1 $2 failed"; }
post POST /products "{\"name\":\"בני ברק ⇔ ירושלים\",\"price\":160,\"aliases\":[\"בב ים\"],\"distance\":\"62 ק״מ\",\"duration\":\"50 דק׳\",\"level\":\"מחירון רגיל\",\"priceMatrix\":$(m 160),\"waitTime\":\"₪40 לשעה\"}"
post POST /products "{\"name\":\"ירושלים ⇔ תל אביב\",\"price\":250,\"aliases\":[\"ים תא\"],\"priceMatrix\":$(m 250)}"
post POST /products "{\"name\":\"אופקים ⇔ באר שבע\",\"price\":120,\"priceMatrix\":$(m 120)}"
post POST /products "{\"name\":\"בית שמש ⇔ ירושלים\",\"price\":180,\"priceMatrix\":$(m 180),\"active\":false}"
post POST /abbreviations '{"shortcut":"רג","expansion":"רמת גן"}'
post POST /targets '{"kind":"contact","identifier":"0501112222","label":"לקוח קבוע"}'
post POST /targets '{"kind":"group","identifier":"120363000000000001","label":"קבוצת נהגים"}'
post POST /admins '{"phone":"0531112222","label":"דנה","email":"dana@example.com","permissions":["targets.manage","lookups.manage"],"sharedWhatsapp":true}'
post POST /admins '{"phone":"0542223333","label":"יוסי","permissions":["catalog.edit","targets.manage","lookups.manage","surge.manage","whatsapp.manage"],"sharedWhatsapp":false}'
post POST /webhooks/whatsapp '{"from":"972501112222","body":"מ בני ברק ירושלים"}'
post POST /webhooks/whatsapp '{"from":"972501112222","body":"מ דימונה ⇔ ערד"}'
post POST /webhooks/whatsapp '{"from":"972501112222","body":"מ רמות גילה"}'
curl -s $J -d '{"identifier":"0531112222","code":"9999"}' "$B/auth/pin" >/dev/null || true
echo "Seeded demo data"
