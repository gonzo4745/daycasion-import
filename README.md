# DayCasion Desktop Import

Static page for **https://import.daycasion.com**: members sign in with their DayCasion account and import folders of photos and videos into a memory profile's Add Past Memories.

- No build step and no dependencies. GitHub Pages serves these files as they are.
- `config.js` holds only public settings: the Supabase project URL and its publishable key. Access is enforced by Supabase sign-in, row-level security and server functions, never by this page.
- Source, tests and database migrations live in the DayCasion development workspace (`remediation/desktop-import/`). Change them there, run `tests/run_all.sh`, then copy `portal/` here.
