# Updating an older single-user history database

Stop the server before updating. Back up `baza_pogo.db` and, if present,
`baza_pogo.db-wal` and `baza_pogo.db-shm` together while the server is stopped.

In PowerShell, from your checkout:

```powershell
cd C:\Users\bryle\Documents\GitHub\pogo-analyzer
git switch master
git pull --ff-only origin master
.\start-windows.bat
```

Startup automatically migrates the old history tables in one transaction.
All export JSON, source paths, timestamps, hashes, snapshot IDs, session IDs,
session contents and snapshot links are retained. The old globally unique
snapshot hash becomes unique per user. Repeat startups are safe. If migration
fails, its schema and data changes roll back together.

Old history has no reliable local profile owner. It remains stored with a NULL
user_id and is excluded from all signed-in history queries until you sign in
and successfully verify that trainer at `/verify`. Existing verified owners can
repeat verification to attach their legacy history. Each trainer must be
verified separately; no data is assigned to the first registered user.

Verification still requires an operator-provisioned trusted trainer reference;
see AUTHENTICATION.md. This update does not invent profiles, passwords, trusted
references, or trainer claims. Legacy `last_upload` analyzer state is unchanged.

If an export was already reimported into the verified profile, its original
legacy row and dependent sessions remain preserved and unassigned to avoid
duplicate hashes. New imports rebuild that profile's chronological sessions
from its assigned snapshots.

Run the migration regression suite with:

```powershell
python -m unittest discover -s tests -v
```
