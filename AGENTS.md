# Repository instructions

## Keep Loft and the website synchronized

This repository (`tanzir71/loft`) owns the canonical landing, React app, shared packages,
and PHP backend. `tanzir71/tanziro-website` serves the landing at `/loft` and the paired
production app at `/spaces/`. Changes requested from either repository must update
both. Never patch the website's generated Loft bundles or vendor archive as source.

For Loft changes, edit and verify the canonical source here, commit it, then run:

```sh
npm run sync:website -- --website <website-checkout>
```

`LOFT_WEBSITE_DIR` can provide that path. From the website checkout the equivalent is
`npm run loft:update -- --source <loft-checkout>` (`LOFT_SOURCE_DIR` supplies the source).
Both entry points use the same builder to refresh the website pin, paired archive,
website build, Namecheap ZIP and checksum. `--check` verifies the source pin and archive
checksum without writing files. `--skip-build` stages the pin/archive only; a release
still requires the full Namecheap packaging and persistence gates.

When commit/push is authorized, publish the canonical source commit and the website
pin/archive plus verified ZIP/checksum. The pin must reference the source commit
actually published. Preserve unrelated work in either checkout. Website-only portfolio
navigation, site adapters and landing integration do not need copying back here.
Run checks locally; do not enable, dispatch, tag-trigger or invoke GitHub Actions for
the paired website integration. Do not deploy or reset the live installation.

## Preserve existing installations

Extract releases over the same public_html tree. The production app remains at
`public_html/spaces/`. Databases, sessions, uploads, backups and encryption keys stay
outside public_html in `loft-app/data/`, or an existing legacy `loft-app/api/data/`.
Detect and retain the existing storage location without resetting, moving or replacing
it. Never put runtime data or secrets into Git, the vendor archive or release ZIP.
Keep the website's Tack first-install archive and lock immutable. Use its local
`npm run build:namecheap` gates before publishing the upload ZIP.

## Focus indicators

Use the shared input-modality policy and `:focus-visible`. Keyboard navigation keeps
visible indicators. Pointer clicks, autofocus and dialog restoration keep actual focus
without keyboard rings. Do not blur controls to hide focus indicators.

## Operator documentation

Keep `INSTALL.md` and `docs/website-integration.md` current when setup or owner/admin
access changes. The website's `docs/SETUP-AND-ADMIN.md` documents Tools Index and Loft
setup together. Owner/admin URLs use hash routing: `/spaces/#/owner`, `/spaces/#/admin`
and `/spaces/#/settings`. Credentials are created on the host, never in documentation.
