# Sharing setup (Firebase, free Spark plan)

Trips, Grocery and To-do can share data between two phones. Bills and Money never use this.
The Firebase settings in the apps (`apiKey` etc.) are not secrets. What protects the data is
the rules below plus the two passwords.

## One-time setup in the Firebase console (project `goobs-apps-aa819`)
1. **Authentication → Sign-in method → Email/Password → Enable** (the first switch only; leave "Email link" off). Save.
2. **Authentication → Users → Add user** twice: one for each person (any email address works, it does not have to
   receive mail), each with its own strong password stored in a password manager.
   Copy each user's **User UID** from the Users table.
3. **Firestore Database → Rules**: replace everything with the contents of `firestore.rules`,
   put the two UIDs in place of the placeholders, then **Publish**.
4. If **Authentication → Settings → User actions** has "Enable create (sign-up)", turn it **off** so nobody can add accounts.
5. Make sure the project stays on the **Spark** (no cost) plan. No card is needed.

## On each phone
Open the app from the Home Screen icon (not a Safari tab; they keep separate storage), go to
**Backup & sharing → Sign in to share**, and use that person's email and password.
Sign in inside the installed app, once per app per phone.

## Good to know
- Each phone keeps its own full copy and works offline. Changes made offline are sent when you are back online.
- Two people editing the same item at the same moment: the later edit wins.
- Deleting something on one phone deletes it on the other. An edit made offline *before* a delete can bring the item back.
- Weather is never shared; each phone looks it up itself.
- Backups are still wise: Backup screen → file to Files/OneDrive. Never put backup files in this repo.
