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

## Added: Pool
- `pool/` water-chemistry advisor for one pool (default 14,000 gal; set the volume in Settings and every dose scales). Log a test (FC and pH required; TA, CYA, CH optional, CYA accepts `<40`) and it picks the mode (normal, preventative, SLAM, mustard, post-SLAM) and shows exact amounts in priority order with when to add and when to retest. Also: chemical dose log, history charts with target bands, daily/weekly/monthly routine with due badges, editable targets, encrypted Backup. On-device only, no Firebase, no reminders or notifications.
- Rules built in: liquid chlorine first, no pH changes while FC is above 10, no algaecide or cal-hypo in plans, Yellow Treat only for confirmed mustard (enter the label dose in Settings for exact ounces), pucks (not granular stabilizer) for CYA. Granular stabilizer amounts and the "what not to use" list appear only after tapping Ask.

## Added: Sous Vide, Watch Log, Sports
- **Sous Vide** (`/sousvide/`): steak and sous vide time/temperature calculator (cut, thickness, start state, doneness), sear plan, 10 steakhouse-style recipes with a low-calorie swap, saved recipes, cook mode with timers, and a cook log. Defaults to Anova Precision Oven bagless mode.
- **Watch Log** (`/watchlog/`): private TV/movie log. You type or paste cast and crew; it cross-references who was in what, shared cast between titles, and shortest chains between two people.
- **Sports** (`/sports/`): schedules (paste import, .ics export), standings calculator, head-to-head rivalry records and a rivalry matrix. You enter the data.
None of these use Firebase or the network. Data stays on the device; JSON backup as in the other apps.
