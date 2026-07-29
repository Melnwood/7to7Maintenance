# Chair Check — 7to7 Dental maintenance

Three small web pages plus one Netlify Function, talking to your Airtable base
**7to7 Maintenance** (`appVzX39Tuax7PHeo`). The Airtable token is **never** in the
pages — it lives only in Netlify as a hidden setting.

## Files (keep this folder structure exactly)

```
index.html                      ← landing page
office.html                     ← an office's report + status page
dashboard.html                  ← the crew's view (all offices)
netlify.toml                    ← tells Netlify where the function is
netlify/
  functions/
    airtable.js                 ← the "middleman" that holds the token
```

## Put it online (one time)

1. **GitHub:** create a repo (e.g. `7to7-maintenance`) and add all of these files,
   keeping the folder structure above.
2. **Netlify:** Add new site → Import from GitHub → pick the repo → Deploy.
3. **The token (the important part):** in Netlify go to
   **Site configuration → Environment variables → Add a variable**
   - Key:   `AIRTABLE_TOKEN`
   - Value: *(paste your base-scoped Airtable token here)*
   Save, then **Deploys → Trigger deploy → Deploy site** so it picks up the token.

That's it. The token is only ever in that Netlify box — not in the pages, not in GitHub.

## How each office uses it

Give each office a bookmark to their own page:

- Mission Oaks → `https://YOURSITE.netlify.app/office.html?office=Mission%20Oaks`
- Braun        → `https://YOURSITE.netlify.app/office.html?office=Braun`
- …and so on for all 12.

Each office page only loads and reports for that one office.

The crew uses `https://YOURSITE.netlify.app/dashboard.html` (keep this link to the crew).

## Notes / next steps
- Photos: not in this first version (Airtable photos need an upload step) — easy to add next.
- Crew names live in `dashboard.html` (the `CREW` list) — edit there to match real names.
- The token is base-scoped, so even if someone found it, it can only touch this one base.
