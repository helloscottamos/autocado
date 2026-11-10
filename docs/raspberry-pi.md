# Running Autocado on a Raspberry Pi (kitchen mirror)

Autocado is one Node.js process plus a folder of JSON, so moving it is mostly "copy the folder, install Node".

## What you need

- Raspberry Pi 4 or 5 (2 GB+), **64-bit** Raspberry Pi OS (Bookworm or later). Playwright's Chromium needs 64-bit. If you only use cookie-paste sign-in, 32-bit is fine.
- A touch frame or touchscreen if you want to tap the mirror. A phone on the same Wi-Fi works too.

## 1. Install Node.js 22+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt-get install -y nodejs
```

## 2. Get Autocado

On the Pi:

```bash
git clone https://github.com/helloscottamos/autocado.git ~/autocado
cd ~/autocado && npm ci --omit=dev
```

**Moving from another computer?** Copy your `data/` folder (recipes, favourites, history) into `~/autocado/data/` on the Pi, for example:

```bash
rsync -av --exclude demo ./data/ pi@raspberrypi.local:/home/pi/autocado/data/
```

## 3. Connecting to Ocado from the Pi

The Firefox add-on is the reliable way. On the computer where you use Firefox, click the add-on's 🥑 button → **Change Autocado address…** and enter the Pi's address, e.g. `http://raspberrypi.local:3456`. Firefox needs to be open somewhere when Autocado fills the trolley.

Autocado's own sign-in also works on the Pi as a fallback. **Paste cookies** in Settings needs nothing extra. The browser-based sign-in methods need Chromium:

```bash
npx playwright install --with-deps chromium
```

## 4. Run it as a service

```bash
sudo cp deploy/autocado.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now autocado
```

The unit sets `HOST=0.0.0.0`, so you can reach it from your phone at `http://raspberrypi.local:3456`. There's no login on the app; keep it on your home network.

## 5. Show it on the mirror

Pick one:

**A. Plain kiosk browser (simplest).** Autostart Chromium full-screen on the Pi's display:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars "http://localhost:3456/?theme=dark"
```

On Bookworm (Wayland/labwc), add that line to `~/.config/labwc/autostart`.

**B. Inside MagicMirror².** Use a module that embeds a web page (an iframe/webview module, e.g. MMM-WebView) and point it at `http://localhost:3456/?theme=dark`. Give it a large region (e.g. `fullscreen_above` or a tall `middle_center`). Autocado's dark theme uses a near-black background so the mirror glass stays reflective around it.

The layout switches to a side menu at 900 px and wider. On a portrait 1080×1920 mirror you get the phone-style bottom tabs with big touch targets.

## Updating

```bash
cd ~/autocado && git pull && npm ci --omit=dev && sudo systemctl restart autocado
```

## Troubleshooting

- `journalctl -u autocado -f` shows the server log.
- "Ocado session has expired": reconnect from Settings. On a Pi with no screen attached, "Sign in myself" isn't offered; use email & password (headless) or paste cookies.
- If Ocado's bot check blocks headless sign-in, use cookie paste. It always works because the cookies come from your real browser.
