# Client Guide - DDDLab Web App

## 1) Open the App
- Open brochure-first page: `https://aryaminakshi71.github.io/dddlab-webapp/`
- Click `Open Lab App`, or directly open: `https://aryaminakshi71.github.io/dddlab-webapp/app.html`

## 2) First Login Setup
- In `Staff Login`, enter Name, Email, Password.
- Click `Register`.
- First registered account becomes `admin`.

## 3) Daily Usage Flow
1. Fill intake form and click `Save Sample`.
2. Attach report file (PDF/Image) once available.
3. Update status in table:
   - `Received` -> `In Process` -> `Report Ready` -> `Dispatched`
4. Use `Print Report` and `Print Slip` as needed.
5. Click `Export Records` for end-of-day backup JSON.

## 4) Multi-user Rules
- `admin` can edit/delete all records and clear data.
- `staff` can edit/delete only records created by themselves.

## 5) Optional Cloud Sync (Supabase)
- Add Supabase URL + anon key in `Cloud Sync`.
- Click `Connect Cloud`, then `Sync Now`.
- Cloud lets multiple devices share records.

## 6) Important Notes
- Without cloud, data stays on the same browser/device only.
- Keep regular JSON exports as backups.
