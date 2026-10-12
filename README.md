# Goobs-Apps

Personal installable web apps (PWAs). Plain HTML/CSS/JS, no build step, no dependencies.

- `bills/` – recurring bill reminders
- `travel/` – trip planner (packing, itinerary, budget, ideas, weather)

## Publish on GitHub Pages
1. Repo must be **public** for free Pages. It contains code only. Never commit backup files or real data.
2. Settings → Pages → Deploy from a branch → `main` / root.
3. Open `https://<your-username>.github.io/Goobs-Apps/`.

## Install on iPhone
Open each app in Safari → Share → Add to Home Screen. Do this **before** entering data: the home-screen app has its own storage, separate from the Safari tab.

## Updating
Upload changed files to the repo. Installed apps pick up the new version the next time they are opened after a refresh (fully close and reopen the app once or twice).

## Data
Everything lives in the device's browser storage. Use each app's Backup screen to save a JSON file (optionally passphrase-encrypted) to Files or OneDrive.

Weather uses the free Open-Meteo service (no account or key); only the destination coordinates are sent.
