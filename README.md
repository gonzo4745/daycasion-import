# DayCasion Desktop Import

Static page for **https://import.daycasion.com**: members sign in with their DayCasion account and import folders of photos and videos into a memory profile's Add Past Memories.

- No build step and no dependencies. GitHub Pages serves these files as they are.
- `config.js` holds only public settings: the Supabase project URL and its publishable key. Access is enforced by Supabase sign-in, row-level security and server functions, never by this page.
- Source, tests and database migrations live in the DayCasion development workspace (`remediation/desktop-import/`). Change them there, run `tests/run_all.sh`, then copy `portal/` here.

## Branding

DayCasion navy `#0A1640` (from the logo) with the app's warm cream background `#FAF7F2` and white cards; a navy page in dark mode. Every text and background pair meets WCAG AA contrast. `images/logo.png` is the app's logo, and `images/logo-dark.png` is the same logo with light lettering for dark mode. The typeface is DM Sans, the app's font, self-hosted in `fonts/` under the SIL Open Font License 1.1 (© The DM Sans Project Authors).
