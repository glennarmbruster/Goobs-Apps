# Goobs-Apps

Personal installable web apps (PWAs). Plain HTML/CSS/JS, no build step, no dependencies.

- `bills/` – recurring bill reminders
- `money/` – retirement Monte Carlo planner and monthly budget
- `travel/` – trip planner (packing, itinerary, budget, ideas, weather); can be shared between two phones
- `grocery/` – shared grocery list grouped by aisle
- `todo/` – shared to-do lists with due dates and notes
- `recipes/` – recipe collection: ingredients, steps, notes, scaling, timers, cook mode. Shared recipes live in `recipes/library.json`; format in `recipes/FORMAT.md`
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

Recipes does not use Firebase. Its shared library is the file `recipes/library.json` in this repo (public, like the code); recipes added inside the app stay on that phone until you export them (Backup & library → Export library file) and upload the file here as `recipes/library.json`.

Everything else lives in the device's browser storage. Use each app's Backup screen to save a JSON file (optionally passphrase-encrypted) to Files or OneDrive.

Money is financial data: back it up with a passphrase and keep the file out of this repo. Its retirement results are a planning model, not a forecast.

Weather uses the free Open-Meteo service (no account or key); only the destination coordinates are sent.
Printing (Trips only): the Print buttons on Overview, Packing, Plan and Weather open a chooser (itinerary, weather, packing lists, to-dos, budget). On iPhone use the Share button in the print preview to save a PDF.


## Added: Health, VA Claim, House, Inventory (+ expense Split in Trips)
- `health/` labs, vitals, meds, visits, charts, doctor summary. On-device only.
- `va/` VA claim organizer: ITF clock, conditions, evidence, contacts, log. On-device only.
- `house/` recurring upkeep, reading logs (pool), warranties, vehicles. On-device only.
- `inventory/` home inventory with photos for insurance, plus an opt-in storm checklist. On-device only.
- Trips: Budget now has a Split view (people, expenses, who-pays-whom) that syncs like the rest of the trip.
None of the new apps use Firebase; each has its own encrypted Backup screen.

## Added: Household, Occasions, Work Log (+ pet care in House)
- `household/` how the house runs: contacts, accounts, vendors, a printable sheet. Blocks passwords/SSNs/long numbers. On-device only.
- `occasions/` birthdays and events with countdowns, gift ideas and history. On-device only.
- `worklog/` what you did on each job, tickets, time, weekly status report. On-device only.
- `house/` now has pets: vet, vaccines/preventives in Due, and a printable sitter sheet.
- Recipes read one file per recipe from `recipes/library/`; Change category is in a recipe's More menu.
