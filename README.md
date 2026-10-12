# Goobs-Apps

Personal installable web apps (PWAs). Plain HTML/CSS/JS, no build step, no dependencies.

- `bills/` – recurring bill reminders
- `money/` – retirement Monte Carlo planner and monthly budget
- `travel/` – trip planner (packing, itinerary, budget, ideas, weather); can be shared between two phones
- `grocery/` – shared grocery list grouped by aisle
- `todo/` – shared to-do lists with due dates and notes
- `sharing/` – setup notes and database rules for the shared apps

## Publish on GitHub Pages
1. Repo must be **public** for free Pages. It contains code only. Never commit backup files or real data.
2. Settings → Pages → Deploy from a branch → `main` / root.
3. Open `https://<your-username>.github.io/Goobs-Apps/`.

## Install on iPhone
Open each app in Safari → Share → Add to Home Screen. Do this **before** entering data: the home-screen app has its own storage, separate from the Safari tab.

## Updating
Upload changed files to the repo. Installed apps pick up the new version the next time they are opened after a refresh (fully close and reopen the app once or twice).

## Data
Bills and Money live only in the device's browser storage and never leave it. Trips, Grocery and To-do also work that way until you sign in; after sign-in they keep each phone's copy and share changes through a private Firebase database that only the two allowed accounts can read (see `sharing/SETUP.md`). Every app still has a Backup screen.

Everything lives in the device's browser storage. Use each app's Backup screen to save a JSON file (optionally passphrase-encrypted) to Files or OneDrive.

Money is financial data: back it up with a passphrase and keep the file out of this repo. Its retirement results are a planning model, not a forecast.

Weather uses the free Open-Meteo service (no account or key); only the destination coordinates are sent.
