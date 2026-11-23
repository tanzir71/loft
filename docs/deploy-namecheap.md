# Deploy Loft on Namecheap shared hosting

Loft runs on plain shared hosting: PHP 8.2 + SQLite. No Composer, no daemons, no WebSockets, no cron. Daily jobs (invoice drafts on the 1st, reminders, credit expiry, branding notices) run on the first request of each day.

Production URLs: landing `https://<your-domain>/loft`, app `https://<your-domain>/spaces`.

**To install, follow [`INSTALL.md`](../INSTALL.md)**: download the release zip, set PHP, upload and extract it, create the owner account, save the recovery code, and check it works. This page covers what comes after that.

What the zip contains:

| Folder | Goes to | What |
|---|---|---|
| `public_html/loft/` | your web root | the landing page |
| `public_html/spaces/` | your web root | the app (HTTP adapter, hash routing) and `.htaccess` |
| `public_html/spaces/api/` | your web root | the API front controller (`index.php`) and `.htaccess` |
| `loft-app/api/` | **outside** the web root | the PHP code and migrations |
| `loft-app/data/` | **outside** the web root | filled in by the installer: `loft.sqlite`, `files/`, `config.php` |

## 1. Agent links

Agents fetch `https://<your-domain>/spaces/a/<token>`. `public_html/spaces/.htaccess` routes `/spaces/a/*` to the API. Nothing else to configure. Rate limits (60 requests a minute per seat) and the audit log are stored in SQLite.

## 2. Calendar feeds and invites

- Private feeds: `https://<your-domain>/spaces/api/v1/ics/<token>.ics` (each host's token is on Calendar → Availability).
- Invites are emailed as `.ics` attachments with a stable UID; updates send SEQUENCE+1, cancellations METHOD:CANCEL.

## 3. Branding

The owner switches branding on per organisation in `/spaces/#/owner` with a paid-until date. Branding stays active until paid-until + 14 days. The organisation's admin then publishes their name, colours and address in Brand studio. No checkout, no custom domains: the branded link is `https://<your-domain>/spaces/<org-slug>`.

## 4. Optional: video with your own keys

Calls work with nothing set up: P2P audio, stage mode and your own Meet/Zoom link. To add video, each organisation's admin opens `/spaces/#/admin` → **Calls & budget**, switches on one provider, pastes its keys and sets a monthly budget (or free minutes):

- **Cloudflare Realtime**: an SFU app (App ID + App token) for cameras, and optionally a TURN key (Key ID + API token) for people on blocked networks.
- **Daily**: an API key. Loft creates a private Daily room per Loft room and a token per person.
- **Jitsi as a Service (8×8)**: the App ID, the API key ID and the private key (PEM). Loft signs room tokens on your server.

Keys are encrypted with the key in `config.php` and never sent to browsers. The server reaches `rtc.live.cloudflare.com` and `api.daily.co` over HTTPS with PHP's `curl` extension. New video stops for the day at 80% of the daily pool; a call that's already live is never cut.

## 5. Backups, restore and updates

- **Back up**: the owner console (`/spaces/#/owner` → Backups → Download backup) gives a zip of `data/` with a consistent copy of the database (`VACUUM INTO`, safe while people are using Loft), every upload and `config.php`. A daily cPanel backup of `~/loft-app/data/` works too.
- **Restore**: rename `~/loft-app/data` to `data-old`, upload the backup zip to `~/loft-app/` and extract it (it creates `data/`), open Loft, then delete `data-old`. Keep `config.php` from the backup: it holds the key that decrypts stored provider keys.
- **Update**: upload the new `loft-prod.zip` and extract it over the old files. `data/` is never touched; database migrations run automatically on the next request.

## 6. Optional: deploy from GitHub

Only if you add FTP/SFTP secrets to the repository (`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`). Without them nothing is deployed automatically. Uploading the zip by hand is the supported path.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Loft is not installed correctly: the API code was not found" | `loft-app` isn't next to your web root folder. Move it, or add `SetEnv LOFT_APP /home/<user>/loft-app` to `spaces/api/.htaccess` (see INSTALL.md, step 3). |
| The app loads but every request says "Not signed in" after signing in | The site address in `config.php` (`app_url`) doesn't match the URL you use (http vs https, www). Fix it and sign in again. |
| Invoice or reminder emails don't arrive | Set `mail_from` in `config.php` to an address at your domain, repair SPF/DKIM, and check cPanel → Track Delivery. Sign-in doesn't use email. |
| 500 errors | cPanel → **Errors** (or `error_log` in `public_html/spaces/api/`). Lines starting with `[loft]` come from the API. |
