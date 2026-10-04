#!/usr/bin/env bash
# Makes a Raspberry Pi (Raspberry Pi OS with desktop) open the LumaMap show full screen at every power-on.
#
#   bash raspberry-pi-kiosk.sh                       # shows the show saved in this Pi's browser
#   bash raspberry-pi-kiosk.sh "https://.../?show=my-show.lumamap"   # shows a show file from the internet
set -euo pipefail

URL="${1:-https://tautiz.github.io/LumaMap/?show}"

BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium not found. Install it with: sudo apt install chromium-browser" >&2
  exit 1
fi

LAUNCHER="$HOME/.local/bin/lumamap-show"
mkdir -p "$(dirname "$LAUNCHER")" "$HOME/.config/autostart"

cat > "$LAUNCHER" <<SCRIPT
#!/usr/bin/env bash
# Wait up to two minutes for the network, so the page does not open before Wi-Fi is up.
for _ in \$(seq 60); do
  curl -sf --max-time 3 -o /dev/null "$URL" && break
  sleep 2
done
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required --password-store=basic "$URL"
SCRIPT
chmod +x "$LAUNCHER"

cat > "$HOME/.config/autostart/lumamap-show.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=LumaMap show
Exec=$LAUNCHER
X-GNOME-Autostart-enabled=true
DESKTOP

# Keep the screen from going blank during the show (Raspberry Pi OS only; ignored elsewhere).
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_blanking 1 || true
fi

echo "Done. LumaMap will open at power-on: $URL"
echo "To stop it: rm ~/.config/autostart/lumamap-show.desktop  (press Alt+F4 to close the show now)"
