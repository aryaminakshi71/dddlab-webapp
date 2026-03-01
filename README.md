# DDDL Gurugram Lab Web App

A GitHub Pages-ready web app for:
- sample registration at intake
- report file upload
- status tracking (Received/In Process/Report Ready/Dispatched)
- staff login/register with role-based access (admin/staff)
- multi-user attribution on each record (created/updated by)
- report preview modal (PDF/image), printable sample slip, and printable report template
- quick JSON export

## Tech
- Static HTML/CSS/JS
- IndexedDB for local browser storage (records + uploaded report files + users)

## Run locally
Open `index.html` directly in a modern browser, or run a local static server:

```bash
cd dddl-lab-webapp
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Roles
- First registered user becomes `admin`.
- Next users are `staff`.
- Admin can clear all data.
- Staff can edit/delete only records they created.

## Deploy on GitHub Pages
1. Create a new GitHub repo.
2. Push this folder contents to the repo root.
3. On GitHub: `Settings` -> `Pages`.
4. Under `Build and deployment`, choose:
   - Source: `Deploy from a branch`
   - Branch: `main` and folder `/ (root)`
5. Save. GitHub will provide a public URL.

## Git Setup (already ready in this folder)
```bash
cd dddl-lab-webapp
git init
git add .
git commit -m "Initial DDDL lab portal"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Notes
- Data is stored in the browser only.
- Uploaded reports remain on the same browser/device profile.
- Multi-user is local to each browser profile unless a backend is added.
- `Export Records` exports metadata JSON (not the binary report files).
