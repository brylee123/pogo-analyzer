# Mandatory first-run directory bootstrap

On a fresh installation, opening the server redirects to `/setup`. File uploads, login, and ordinary profile registration are blocked until initialization completes.

1. On the **server computer** (loopback address only), launch the Flask app and visit `http://127.0.0.1:5000/setup`.
2. Enter an absolute path to an **existing directory on the server** containing one trainer's complete PGSharp `.json` or `.txt` export files. This is a **server filesystem path**, not a browser upload. No file selection/upload is offered during setup.
3. Choose the first administrator username and a password of at least 12 characters.
4. The server validates all matching exports, sorts them by their embedded timestamps and uses the earliest valid one as the historical baseline. Each subsequent snapshot is compared chronologically; unchanged comparisons are ignored. The administrator is linked to this initial trainer, and their latest snapshot is loaded into the existing analyzer.
5. The selected directory is saved to SQLite and used by the background watcher after restarts. Additional user registrations and verified trainer imports may follow normal onboarding.

**Bootstrap folder requirements:** Only one distinct trainer across the valid exports; must contain at least one valid PGSharp full export with a creation timestamp. Files that do not parse as PGSharp exports are skipped. The directory must already exist and be readable by the server process.

**Important:** This is for a trusted local/LAN instance, not public multi-tenancy. Loopback restriction means setup must be done on the hosting machine, and login and account verification must be hardened before public exposure. Administrators should point it only at a trusted path, because initial trainer ownership is established from the folder. Existing installations with users skip initial setup; migrating a preexisting single-user dataset requires manual planning.

After initialization, manually uploading further exports remains supported for an authenticated, verified trainer. No initial uploaded file is needed.
