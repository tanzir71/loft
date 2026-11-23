# Install Loft

For the combined portfolio `deploy-namecheap.zip`, follow [Tools Index and Loft setup/admin access](https://github.com/tanzir71/tanziro-website/blob/main/docs/SETUP-AND-ADMIN.md): that ZIP is extracted directly into the existing `public_html/`. The steps below describe the separate `loft-prod.zip`, which is extracted into the hosting home. Keep the two archive layouts distinct.

Step by step, on Namecheap shared hosting with cPanel. Any host with PHP 8.1+ and SQLite works the same way.
No Composer, no command line, no cron jobs, nothing to keep running. It takes about 20 minutes.

When you're done:

- the landing page is at `https://<your-domain>/loft`
- the app is at `https://<your-domain>/spaces`

Whatever is already at the root of your domain keeps working: Loft only adds those two folders.

## What you need

- A Namecheap shared hosting plan with cPanel, and a domain pointing to it.
- HTTPS on that domain. In cPanel → **SSL/TLS Status**, run **AutoSSL** if the domain isn't covered yet. Loft's sign-in cookies only work over HTTPS.
- Optional: a sender at your domain for invoices, reminders and other email notifications. Account registration, sign-in and recovery work without an email sender.

## 1. Download the build

Open the repository on GitHub → **Releases** → the latest release → download **`loft-prod.zip`** (about 1 MB).

To build it yourself instead (Node 20+):

```bash
npm ci
```

```bash
node scripts/build-prod.mjs --out loft-prod.zip
```

## 2. Set up PHP

cPanel → **Select PHP Version**:

1. Choose **8.2** (or newer) and click **Set as current**.
2. On the **Extensions** tab, make sure these are ticked: `pdo_sqlite`, `sqlite3`, `sodium`, `openssl`, `curl`, `mbstring`, `iconv`.
3. On the **Options** tab, set `upload_max_filesize` and `post_max_size` to at least **20M**. Board PDFs and file uploads need this.

If an extension isn't in the list, ask Namecheap support to enable it.

## 3. Upload and extract

1. cPanel → **File Manager**.
2. Go to your **home folder**: `/home/<your-cpanel-user>`, the folder that *contains* `public_html`. Don't open `public_html` itself.
3. **Upload** `loft-prod.zip` there.
4. Right-click the zip → **Extract** → make sure the destination is your home folder → **Extract Files**.
5. Delete `loft-prod.zip`.

You should now have:

```text
/home/<your-cpanel-user>/
├── public_html/
│   ├── loft/        landing page
│   └── spaces/      the app
│       └── api/     the API's front door (index.php)
└── loft-app/        the code and your data, out of reach of the web
    ├── api/
    └── data/        database, uploads and config.php (filled in by the installer)
```

**If your domain's files aren't in `public_html`** (an addon domain, for example):

- If the domain's folder sits directly in your home folder (`/home/<user>/example.com`), move `loft` and `spaces` into it and leave `loft-app` where it is. Nothing else changes.
- If the domain's folder is *inside* `public_html` (`/home/<user>/public_html/example.com`), move `loft` and `spaces` into it, keep `loft-app` in your home folder, and add this line at the top of `spaces/api/.htaccess` (File Manager → right-click → **Edit**):

  ```text
  SetEnv LOFT_APP /home/<your-cpanel-user>/loft-app
  ```

## 4. Run the installer

Open `https://<your-domain>/spaces/`. The first visit shows the install wizard.

1. **Server check.** Every line should be green: PHP version, PDO SQLite, OpenSSL, Sodium, cURL, and "Data folder is writable". If one is red, fix it in step 2 or 3 and reload the page.
2. **Owner account.** Enter your name, choose a username (3–32 letters, numbers, dots, dashes or underscores) and a password/passphrase (10–72 bytes). The site address and time zone are detected automatically.
3. Click **Create owner and finish**. Save the recovery code in your password manager, check **I saved my recovery code**, then **Continue**.

You're signed in as the **owner**. The installer wrote `loft-app/data/config.php` with your settings and a random encryption key. Keep that file private, and back it up: it decrypts any provider keys your organisations save.

## Owner and admin access

Owner/admin access after setup:

- Sign-in: `/spaces/#/signin`, using your username and password. New users choose **Create an account**; registration never grants installation-owner access.
- Site owner console: `/spaces/#/owner`, available only to the first-run owner account. It manages branding access, requests and private backups.
- Organisation admin: `/spaces/#/admin`, for the signed-in account's own calls, optional video providers and budget.
- Settings: `/spaces/#/settings`, where you can change your username/password, save a replacement recovery code and sign out.
- Brand studio: `/spaces/#/brand`. Organisation admin access does not grant site-owner access.

No default production owner/admin password is supplied. Keep the generated private config and encryption key intact; owner recovery does not require reinstalling or resetting data.

Use **Use a recovery code** at sign-in to reset your password; this revokes existing sessions and replaces the recovery code. Save the replacement. Existing email accounts with a password can still sign in with that email in the Username field and choose a username in Settings.

If an existing owner never configured a password or has lost both password and recovery code, run this in the hosting terminal, from the folder that contains `spaces/` (usually `public_html/`):

```sh
php spaces/api/index.php set-owner-password
```

In a source checkout, run `php api/public/index.php set-owner-password` from the repository root instead. Enter your chosen credentials when prompted and privately save the printed recovery code. This changes only the existing owner's credentials, revokes old sessions, and preserves accounts, spaces, uploads, config and encryption keys. Set the same `LOFT_APP`/`LOFT_DATA` environment overrides in the terminal if your web server uses custom paths. Never reinstall to recover access.

## 5. Optional notification email

Invoices, reminders and calendar invites can use PHP's `mail()` from your hosting. Login/register/recovery do not depend on it. Legacy email-link API sign-in stays disabled unless the private config explicitly sets `email_signin_enabled` to `true`; the default UI uses passwords.

1. File Manager → `loft-app/data/config.php` → right-click → **Edit**.
2. Change the `'mail_from'` line to an address at your domain (create one in cPanel → **Email Accounts**):

   ```text
   'mail_from' => 'loft@<your-domain>',
   ```

3. Save.
4. cPanel → **Email Deliverability** → make sure SPF and DKIM are valid for your domain (click **Repair** if not).

## 6. Check it works

1. **Sign-in:** in Loft, open **More** → **Settings** → **Sign out**. Sign in again with your username/password. Keep your recovery code privately saved.
2. **App:** on Home, click **Start a room**, then **Invite to this room** → **Copy**. Open the link in a private window and join as a guest: you should see each other's cursors and board edits.
3. **Owner console:** open `https://<your-domain>/spaces/#/owner`. This is where you switch branding on per organisation, with a paid-until date. Only you can open it.

That's it: Loft is live. Daily jobs (invoice drafts on the 1st, reminders, credit expiry, branding notices) run on the first visit of each day, so there's nothing to schedule.

## Updating to a new version

1. Download the new `loft-prod.zip` from **Releases**.
2. Upload it to your home folder and **Extract** it over the old files.

Your data in `loft-app/data/` is never touched, and database changes apply themselves on the next visit. Back up first if you like (below).

## Backups

Owner console (`/spaces/#/owner`) → **Backups** → **Download backup**: a zip of `loft-app/data/` with a consistent copy of the database, every upload and `config.php`. It's safe to take while people are using Loft. A daily cPanel backup of `loft-app/data/` works too.

To restore: rename `loft-app/data` to `data-old`, upload the backup zip to `loft-app/`, extract it (it recreates `data/`), open Loft, then delete `data-old`.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Loft is not installed correctly: the API code was not found" | `loft-app` isn't next to your web root folder. Move it (step 3), or add the `SetEnv LOFT_APP …` line. |
| A red line on the installer's server check | Fix it in **Select PHP Version** (step 2). For "Data folder is writable", check that `loft-app/data` exists and has permissions 755. |
| Signed in, but every page then says "Not signed in" | The site address doesn't match the address you use (`http` vs `https`, or `www`). Fix `'app_url'` in `loft-app/data/config.php`, then sign in again. |
| Lost password | Use your saved recovery code. For owner access only, the host terminal command above preserves the existing installation. |
| A blank page or "500" error | cPanel → **Errors**, or the `error_log` file in `public_html/spaces/api/`. Lines starting with `[loft]` come from Loft. |

## More

[`docs/deploy-namecheap.md`](docs/deploy-namecheap.md) covers the optional parts: agent links, calendar feeds, branding, video with your own provider keys, and deploying from GitHub with FTP.
