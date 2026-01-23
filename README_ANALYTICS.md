# Website visitor analytics (how many visits, from where, etc.)

Yes, it's possible to see:
- visitors per day/month
- countries/cities
- referrers (Google, Twitter, etc.)
- most visited pages

Because this site is static, the usual method is to add a small analytics script in `index.html`.

## Option A: Privacy-friendly (recommended)
### GoatCounter (free / simple)
1) Create a GoatCounter site and copy your code (like `https://YOURNAME.goatcounter.com/count`)
2) In `index.html`, enable the GoatCounter script (search for **Analytics (optional)**)
3) Commit and push.

## Option B: Google Analytics (most detailed)
1) Create a GA4 property and get your Measurement ID (looks like `G-XXXXXXX`)
2) Paste the GA4 snippet in `index.html` (same place)

## Where to add it
Open `index.html` and look for:
`<!-- Analytics (optional) -->`

Uncomment the provider you want and set your ID.
