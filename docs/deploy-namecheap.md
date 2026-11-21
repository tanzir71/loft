# Deploy Loft on Namecheap shared hosting

Loft runs on plain shared hosting: PHP 8.2 + SQLite. No Composer, no daemons, no WebSockets, no cron. Daily jobs (invoice drafts on the 1st, reminders, credit expiry, branding notices) run on the first request of each day.

Production URLs: landing `https://<your-domain>/loft`, app `https://<your-domain>/spaces`.

## 1. Get the build

Every release on GitHub has a `loft-prod.zip` attached (built by `.github/workflows/release-zip.yml`). To build it yourself:

```bash
npm ci
```

```bash
node scripts/build-prod.mjs --out loft-prod.zip
```

The zip contains:

| Folder | Goes to | What |
|---|---|---|
| `public_html/loft/` | your web root | the landing page |
| `public_html/spaces/` | your web root | the app (HTTP adapter, hash routing) and `.htaccess` |
| `public_html/spaces/api/` | your web root | the API front controller (`index.php`) and `.htaccess` |
| `loft-app/api/` | **outside** the web root | the PHP code and migrations |
| `loft-app/data/` | **outside** the web root | created by the installer: `loft.sqlite`, `files/`, `config.php` |

## 2. Upload

1. cPanel → **File Manager** → your home folder (the one that contains `public_html`).
2. **Upload** `loft-prod.zip`, then **Extract** it there. You now have `~/public_html/loft`, `~/public_html/spaces` and `~/loft-app`.
3. Check that `~/loft-app/data` exists and is writable by PHP (permissions `700` or `750`).

If your web root isn't `public_html` (an addon domain, for example), move `public_html/loft` and `public_html/spaces` into that domain's folder and keep `loft-app` next to it, one level above. The front controller looks for `../../../loft-app/api/src/bootstrap.php` from `spaces/api/`. To use another location, set the environment variable `LOFT_DATA` (data folder) in `.htaccess` with `SetEnv LOFT_DATA /home/<user>/loft-app/data`.

## 3. PHP settings

cPanel → **Select PHP Version**:

- PHP **8.2**
- Extensions: `pdo_sqlite`, `sqlite3`, `openssl`, `sodium`, `curl`, `mbstring`, `iconv`
- Options: `upload_max_filesize` and `post_max_size` at least `20M` (board PDFs and files).

## 4. Install

Open `https://<your-domain>/spaces/`. The first visit shows the **install wizard** (Figma 07 · "Install · first run"):

1. **Server check**: PHP version and extensions, a writable data folder outside the web root.
2. **Owner account**: your name, email and the site address (for example `https://tanziro.com/spaces`). You become the owner; only you can open `/spaces/#/owner`.
3. **Done**: an encryption key is generated into `loft-app/data/config.php`. Keep that file private and back it up.

Sign-in is by email link (single use, 15 minutes) sent with PHP `mail()`. Namecheap's `mail()` works out of the box; use an address at your domain as the sender (the installer uses your email; edit `mail_from` in `config.php` to change it). If mail lands in spam, add SPF/DKIM for your domain in cPanel → **Email Deliverability**.

## 5. Agent links

Agents fetch `https://<your-domain>/spaces/a/<token>`. `public_html/spaces/.htaccess` routes `/spaces/a/*` to the API. Nothing else to configure. Rate limits (60 requests a minute per seat) and the audit log are stored in SQLite.

## 6. Calendar feeds and invites

- Private feeds: `https://<your-domain>/spaces/api/v1/ics/<token>.ics` (each host's token is on Calendar → Availability).
- Invites are emailed as `.ics` attachments with a stable UID; updates send SEQUENCE+1, cancellations METHOD:CANCEL.

## 7. Branding

The owner switches branding on per organisation in `/spaces/#/owner` with a paid-until date. Branding stays active until paid-until + 14 days. The organisation's admin then publishes their name, colours and address in Brand studio. No checkout, no custom domains: the branded link is `https://<your-domain>/spaces/<org-slug>`.

## 8. Backups and updates

- **Back up** `~/loft-app/data/` (database, uploads, `config.php`). A daily cPanel backup or a download of that folder is enough.
- **Update**: upload the new `loft-prod.zip` and extract it over the old files. `data/` is never touched; database migrations run automatically on the next request.

## 9. Optional: deploy from GitHub

Only if you add FTP/SFTP secrets to the repository (`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`). Without them nothing is deployed automatically. Uploading the zip by hand is the supported path.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Loft is not installed correctly: the API code was not found" | `loft-app` isn't three levels above `spaces/api/`. Move it, or set `LOFT_DATA` and keep the code path. |
| The app loads but every request says "Not signed in" after signing in | The site address in `config.php` (`app_url`) doesn't match the URL you use (http vs https, www). Fix it and sign in again. |
| Sign-in emails don't arrive | Check `~/loft-app/data/mail.log` exists only if `mail_mode` is `log`; otherwise check cPanel → Track Delivery and set SPF/DKIM. |
| 500 errors | cPanel → **Errors** (or `error_log` in `public_html/spaces/api/`). Lines starting with `[loft]` come from the API. |
