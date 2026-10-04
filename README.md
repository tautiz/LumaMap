<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Y8KrbtcUvLYAf5MtFD_pm1U25GKpZSNh

## Automatic show

Open `?show` to start the saved show full screen with no controls, or `?show=<file>.lumamap` to load a show file
from a URL. To make a projector start the show at power-on, see
[docs/automatinis-pasirodymas.md](docs/automatinis-pasirodymas.md) (Lithuanian) and `scripts/raspberry-pi-kiosk.sh`.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds and publishes the app on every push to `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is served at `https://<user>.github.io/LumaMap/`.

The Gemini key is not included in the Pages build (it would be public), so AI texture generation is unavailable there.
