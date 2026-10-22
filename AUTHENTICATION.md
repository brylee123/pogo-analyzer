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
