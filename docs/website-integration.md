# Paired website release

`tanzir71/tanziro-website` serves the original static landing at `/loft`, its organisations page at `/loft/organisations/`, and the production HTTP-backed app at `/spaces/`. The website pins a committed Loft revision and verifies its archive checksum during every build. The portfolio navigation and Tools Index link to `/loft`.

For operator setup, owner/admin URLs and recovery, see [Tools Index and Loft setup](https://github.com/tanzir71/tanziro-website/blob/main/docs/SETUP-AND-ADMIN.md) and [INSTALL.md](../INSTALL.md).

Build with `npm run build:website -- --out <empty-directory>`. Unlike the standalone `build-prod.mjs` archive, this output goes directly inside the website's existing `public_html/` tree. It contains no database, uploads, config, credentials, tests, or demo records. Its landing buttons point at `/spaces/`; the milestones link points at the existing Pages archive.

The public API front controller includes a PHP payload containing only the reviewed backend source and migrations. On the first request for a release, it verifies the payload's SHA-256, serializes installation with a file lock, writes a temporary release directory, and publishes it with a rename. Backend code runs from `~/loft-app/releases/<hash>/`; user state remains at `~/loft-app/data/`, including the encryption key in `config.php`. This is the same data directory used by standalone Loft installations. A runtime update never copies, replaces, or resets that directory. Older code releases are retained. `LOFT_APP` selects the private root for nested document roots; `LOFT_DATA` can retain a previously configured external data directory. Paths inside the document root are rejected.

After committing and pushing Loft source, run `npm run loft:update -- --source <loft-checkout>` in the website checkout. This builds the paired archive, updates `vendor/loft.lock.json`, and runs the website's Namecheap packaging and persistence gates. `--skip-build` updates the source pin only; it does not publish an upload ZIP. Commit and push the website pin and verified upload ZIP too. Do not enable or invoke GitHub workflows for this integration.

From this repository, run the same updater through:

```sh
npm run sync:website -- --website <website-checkout>
```

Set `LOFT_WEBSITE_DIR` to omit `--website`; the website accepts `LOFT_SOURCE_DIR` instead of `--source`. Both commands require committed canonical source. Use `--check` with either entry point to compare the current source commit with the website pin and verify the paired archive checksum, without writing files. A mismatch fails and asks you to update. `--check` and `--skip-build` are mutually exclusive.

Updates requested from either repository must finish this pair. Edit the source here, verify it, commit it, run the sync, and commit the website pin/archive and verified ZIP/checksum. When commit/push is authorized, publish both repositories so the website pin references the Loft commit actually published. Website-only portfolio navigation and adapters stay in the website repo. The sync command builds and stages files; it does not commit, push, deploy, or run on every file save. `AGENTS.md` in both repositories requires this workflow.

Early standalone builds used `loft-app/api/data/` despite documenting `loft-app/data/`. If the legacy directory contains a database/config, the integrated runtime retains it without moving or resetting data. If both directories contain installations, it refuses to guess and requires `LOFT_DATA`. Fresh installs use `loft-app/data/`.

On Namecheap, extract the website upload ZIP over the existing `public_html/` without deleting the installation. PHP must be able to create or write `loft-app` beside the web root. PHP 8.1+, PDO SQLite, OpenSSL, Sodium, cURL, mbstring and iconv are required. Open `/spaces/` and complete the username/password owner wizard only on a fresh installation; save its recovery code. No email sender is required for accounts. Optional notifications can use `mail_from` in the private config. Existing owners can add credentials from Settings, or use `php spaces/api/index.php set-owner-password` from `public_html/` when locked out (see INSTALL.md). Never copy private data into either repository.

`/spaces/new` is a direct room-start shortcut, matching the landing page's **start free** action. Signed-out visitors sign in/register first, then resume the requested room. The app's separate `#/spaces/new` route remains the space-creation wizard.
