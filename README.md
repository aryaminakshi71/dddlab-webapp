# DDDL Gurugram Lab Web App

A GitHub Pages-ready web app for:
- sample registration at intake
- report file upload
- status tracking (Received/In Process/Report Ready/Dispatched)
- staff login/register with role-based access (admin/staff)
- multi-user attribution on each record (created/updated by)
- report preview modal (PDF/image), printable sample slip, and printable report template
- quick JSON export
- optional Supabase cloud sync for cross-device data

## Tech
- Static HTML/CSS/JS
- IndexedDB for local browser storage (records + uploaded report files + users)

## Run locally
Open `index.html` directly in a modern browser, or run a local static server:

```bash
cd dddlab-webapp
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Live URL
- GitHub Pages URL (after workflow deploy):  
  `https://aryaminakshi71.github.io/dddlab-webapp/`

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
cd dddlab-webapp
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

## Supabase Cloud Setup (optional)
Use this if you want shared records across devices.

1. Create a Supabase project.
2. In SQL editor, run:

```sql
create table if not exists public.lab_samples (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.lab_samples enable row level security;

create policy \"anon_read_lab_samples\" on public.lab_samples
for select to anon using (true);

create policy \"anon_insert_lab_samples\" on public.lab_samples
for insert to anon with check (true);

create policy \"anon_update_lab_samples\" on public.lab_samples
for update to anon using (true) with check (true);

create policy \"anon_delete_lab_samples\" on public.lab_samples
for delete to anon using (true);
```

3. Create storage bucket `lab-reports` and make it public.
4. Add storage policies for `anon` read/write/delete on `lab-reports`.
5. In app UI, paste:
   - `Supabase URL`
   - `Supabase anon key`
6. Click `Connect Cloud`, then `Sync Now`.

Important:
- These `anon` policies are permissive for quick setup/demo.
- For production, restrict policies with proper authenticated roles.

## Client Onboarding
- See [CLIENT_GUIDE.md](./CLIENT_GUIDE.md) for step-by-step client usage.
