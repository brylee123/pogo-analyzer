# Local multi-profile authentication (development build)

On startup, users visit `/login` to sign in or create a profile (username and password, minimum 12 characters). User accounts and salted scrypt password hashes are kept in `baza_pogo.db`.

- Each account stores its own latest upload in `user_latest_upload`.
- Historical session APIs filter by signed-in user.
- A PGSharp trainer name is claimed by the first local user who imports it; later imports into other accounts are rejected. **A trainer name is not cryptographic proof of ownership.** This is intended for trusted users of one local server, not a public authentication authority.
- Folder-watched exports are accepted only for trainer names already linked to an existing user, so unclaimed files remain pending.
- The global analyzer state was replaced with request-local state to avoid crossing account boundaries.
- Existing `last_upload` legacy data is not automatically assigned to anyone; import it into the intended profile after creating that user.

Configuration:
```ini
# .env or environment
SECRET_KEY=use-a-long-random-unique-secret
HOST=127.0.0.1
PORT=5000
PGS_EXPORT_DIR=exports
COOKIE_SECURE=0
```
Set `COOKIE_SECURE=1` only after deploying behind HTTPS. For LAN HTTP access, the cookie cannot be Secure. **Do not expose the Flask development server directly to the internet.** Use a production WSGI server plus TLS proxy and add login rate limiting, account recovery and security tests first.

Known limitations: No password reset, no email verification, no rate limiting, no admin dashboard, no per-user folder configurations, and no production-hardening audit. Login is not yet migrated to Material UI. This branch must be tested with at least two real, distinct accounts and exports before merging.

## Trainer-account verification (new)
The PGSharp JSON contains `account.creationTimeMs`, the timestamp of account creation. The date is displayed as a verification prompt after signing in. A date from a freshly user-uploaded file is **never** accepted as an authoritative answer.

An operator first establishes an independently trusted reference:

```bash
python provision_trainer.py /secure/trusted/PGSStats.json
```

The operator must obtain this file independently and must never provision it using a stranger's claimant-uploaded file. Provisioning records a hashed UTC account-creation date associated with a trainer name. The player then signs in and visits `/verify`, enters their trainer name and calendar date, and the application matches that answer to the stored trusted hash. Five unsuccessful attempts lock further claims until the operator intervenes.

The regular latest-upload and historical-import endpoints now reject exports for unverified trainer claims; the watcher processes only previously verified trainer identities. Existing historic claims created before this change should be audited before public use.

**Security limitation:** This is a knowledge check, not cryptographic ownership proof. Creation dates are obtainable by anyone holding an export, and a player may have publicly shared the date. For internet-facing or untrusted multi-tenant hosting, use an external authenticated identity provider or an additional independently verified account-control challenge. Treat this implementation as a trusted LAN prototype.
