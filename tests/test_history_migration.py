"""Run with python -m unittest discover -s tests -v (standard library only)."""
import importlib.util
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("history_under_test", ROOT / "history.py")
history = importlib.util.module_from_spec(spec)
# Keep these database migration tests independent of Flask/dotenv installation.
with patch.dict(sys.modules, {"database": types.SimpleNamespace(get_db=lambda: None)}):
    spec.loader.exec_module(history)

LEGACY = """
CREATE TABLE history_snapshots(
 id INTEGER PRIMARY KEY, account TEXT NOT NULL, captured_at TEXT NOT NULL,
 hash TEXT NOT NULL UNIQUE, source TEXT NOT NULL, raw_json TEXT NOT NULL);
CREATE INDEX idx_history_account_time ON history_snapshots(account,captured_at,id);
CREATE TABLE history_sessions(
 id INTEGER PRIMARY KEY, account TEXT NOT NULL, from_id INTEGER NOT NULL,
 to_id INTEGER NOT NULL UNIQUE, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
 changes_json TEXT NOT NULL, totals_json TEXT NOT NULL);
CREATE INDEX idx_sessions_account_time ON history_sessions(account,ended_at);
"""

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / "history.db")
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript("""
        CREATE TABLE app_users(id INTEGER PRIMARY KEY);
        INSERT INTO app_users VALUES(7),(8);
        CREATE TABLE trainer_ownership(trainer TEXT PRIMARY KEY COLLATE NOCASE,
            user_id INTEGER REFERENCES app_users(id));
        """)
        self.patcher = patch.object(history, "get_db", self.connect)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def legacy(self):
        self.db.executescript(LEGACY)
        self.db.executemany("INSERT INTO history_snapshots VALUES(?,?,?,?,?,?)", [
            (11, "Ash", "2026-01-01", "hash1", "one.json", '{"original":1}'),
            (22, "Ash", "2026-01-02", "hash2", "two.json", '{"original":2}'),
            (33, "Misty", "2026-01-03", "hash3", "three.json", '{"original":3}'),
        ])
        self.db.execute("INSERT INTO history_sessions VALUES(5,'Ash',11,22,'start','end','changes','totals')")
        self.db.commit()

    def rows(self, table):
        return [dict(row) for row in self.db.execute(f"SELECT * FROM {table} ORDER BY id")]

    def test_fresh_database_and_repeat_startup(self):
        history.init_history()
        history.init_history()
        self.assertEqual([], self.rows("history_snapshots"))
        self.assertIn("user_id", [r["name"] for r in self.db.execute("PRAGMA table_info(history_sessions)")])

    def test_legacy_preserves_every_value_and_link(self):
        self.legacy()
        before = {t:self.rows(t) for t in ("history_snapshots", "history_sessions")}
        history.init_history()
        history.init_history()
        for table, rows in before.items():
            self.assertEqual([dict(row, user_id=None) for row in rows], self.rows(table))
        self.assertEqual("ok", self.db.execute("PRAGMA integrity_check").fetchone()[0])

    def test_claim_requires_verified_owner_and_is_case_insensitive(self):
        self.legacy()
        history.init_history()
        with self.assertRaises(PermissionError):
            history.claim_legacy_history(self.db, "Ash", 7)
        self.db.execute("INSERT INTO trainer_ownership VALUES('Ash',7)")
        with self.assertRaises(PermissionError):
            history.claim_legacy_history(self.db, "Ash", 8)
        history.claim_legacy_history(self.db, "ash", 7)
        history.claim_legacy_history(self.db, "ASH", 7)
        self.assertEqual([7,7,None], [r["user_id"] for r in self.rows("history_snapshots")])
        self.assertEqual(7, self.rows("history_sessions")[0]["user_id"])
        self.db.commit()
        history.init_history()
        self.assertEqual([7,7,None], [r["user_id"] for r in self.rows("history_snapshots")])

    def test_hash_is_unique_per_user_after_upgrade(self):
        self.legacy()
        history.init_history()
        self.db.execute("UPDATE history_snapshots SET user_id=7 WHERE id=11")
        self.db.execute("""INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json)
            VALUES(8,'Ash','later','hash1','copy','{}')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json)
                VALUES(7,'Ash','later','hash1','copy','{}')""")

    def test_existing_multi_user_database_unchanged(self):
        self.db.executescript(LEGACY.replace(
            "id INTEGER PRIMARY KEY, account",
            "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id), account"
        ).replace("hash TEXT NOT NULL UNIQUE", "hash TEXT NOT NULL"))
        history.init_history()
        self.db.execute("""INSERT INTO history_snapshots
            VALUES(19,8,'Misty','date','digest','source','payload')""")
        self.db.commit()
        before = self.rows("history_snapshots")
        history.init_history()
        self.assertEqual(before, self.rows("history_snapshots"))

    def test_partial_upgrade(self):
        self.legacy()
        self.db.execute("ALTER TABLE history_sessions ADD COLUMN user_id INTEGER REFERENCES app_users(id)")
        self.db.commit()
        history.init_history()
        self.assertEqual(3, len(self.rows("history_snapshots")))
        self.assertEqual(1, len(self.rows("history_sessions")))

    def test_failed_migration_rolls_back_schema_and_data(self):
        self.legacy()
        before = self.rows("history_snapshots")
        path = self.path
        class FailingConnection(sqlite3.Connection):
            def execute(self, sql, *args):
                if sql.startswith("CREATE UNIQUE INDEX"):
                    raise sqlite3.OperationalError("injected failure")
                return super().execute(sql, *args)
        def failing():
            db = sqlite3.connect(path, factory=FailingConnection)
            db.row_factory = sqlite3.Row
            return db
        with patch.object(history, "get_db", failing):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected failure"):
                history.init_history()
        self.assertEqual(before, self.rows("history_snapshots"))
        self.assertNotIn("user_id", [r["name"] for r in self.db.execute("PRAGMA table_info(history_snapshots)")])
        history.init_history()

    def test_reimport_collision_preserves_unassigned_original(self):
        self.legacy()
        history.init_history()
        self.db.execute("INSERT INTO trainer_ownership VALUES('Ash',7)")
        self.db.execute("""INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json)
            VALUES(7,'Ash','date','hash1','reimport','{}')""")
        history.claim_legacy_history(self.db, "Ash", 7)
        rows = self.rows("history_snapshots")
        self.assertIsNone(rows[0]["user_id"])
        self.assertEqual(7, rows[1]["user_id"])
        self.assertIsNone(self.rows("history_sessions")[0]["user_id"])
        self.assertEqual(4, len(rows))

if __name__ == "__main__":
    unittest.main()
