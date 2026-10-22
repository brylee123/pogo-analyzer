"""Profile isolation, English rendering, and backward-compatible appearance storage."""
import gc
import json
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
from database import init_db, get_db
from auth import init_auth
from history import init_history
from verification import init_verification
from appearance import init_appearance, profile_appearance


class AppearanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_path = config.DB_PATH
        cls.bootstrap = tempfile.TemporaryDirectory()
        config.DB_PATH = Path(cls.bootstrap.name) / 'bootstrap.db'
        with patch('history_integration.start_watcher'):
            from app import app
        cls.app = app
        cls.app.config.update(TESTING=True, SECRET_KEY='test-only')

    @classmethod
    def tearDownClass(cls):
        config.DB_PATH = cls.original_path
        gc.collect()
        cls.bootstrap.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        config.DB_PATH = Path(self.tmp.name) / 'profile.db'
        init_db(); init_auth(); init_history(); init_verification(); init_appearance()
        with closing(get_db()) as db, db:
            db.executemany('INSERT INTO app_users(id,username,password_hash) VALUES(?,?,?)',
                           [(1,'alice','unused'), (2,'bob','unused')])
        self.client = self.app.test_client()
        self.other = self.app.test_client()
        with self.client.session_transaction() as s: s['user_id'] = 1
        with self.other.session_transaction() as s: s['user_id'] = 2

    def tearDown(self):
        gc.collect()
        self.tmp.cleanup()

    def save(self, client, theme='dark', accent='valor'):
        return client.put('/api/appearance', json={'theme':theme,'accent':accent},
                          headers={'Origin':'http://localhost'})

    def test_defaults_and_unauthenticated_access(self):
        self.assertEqual(401, self.app.test_client().get('/api/appearance').status_code)
        data = self.client.get('/api/appearance').get_json()
        self.assertEqual(('system','auto','mystic'), (data['theme'],data['accent'],data['team']))

    def test_preferences_persist_and_do_not_cross_profiles(self):
        self.assertEqual(200, self.save(self.client).status_code)
        self.assertEqual('valor', self.client.get('/api/appearance').get_json()['accent'])
        self.assertEqual('auto', self.other.get('/api/appearance').get_json()['accent'])
        self.assertEqual('system', self.other.get('/api/appearance').get_json()['theme'])
        init_appearance()
        self.assertEqual('dark', self.client.get('/api/appearance').get_json()['theme'])

    def test_invalid_settings_and_identity_injection_are_rejected(self):
        for data in ({'theme':'sepia','accent':'auto'}, {'theme':'dark','accent':'green'},
                     {'theme':'light','accent':'mystic','user_id':2}, [], None):
            r=self.client.put('/api/appearance',json=data,headers={'Origin':'http://localhost'})
            self.assertEqual(400,r.status_code)
        self.assertEqual('system', self.client.get('/api/appearance').get_json()['theme'])

    def test_automatic_team_uses_only_signed_in_profile(self):
        with closing(get_db()) as db, db:
            db.execute('INSERT INTO user_latest_upload(user_id,raw_json) VALUES(?,?)',
                       (1,json.dumps({'account':{'team':3}})))
        self.assertEqual('instinct', self.client.get('/api/appearance').get_json()['team'])
        self.assertEqual('mystic', self.other.get('/api/appearance').get_json()['team'])
        self.save(self.client, accent='mystic')
        data=self.client.get('/api/appearance').get_json()
        self.assertEqual(('mystic','instinct'),(data['accent'],data['team']))
        self.save(self.client,theme='system',accent='auto')
        self.assertEqual('auto',self.client.get('/api/appearance').get_json()['accent'])

    def test_history_team_fallback_and_malformed_data(self):
        with closing(get_db()) as db, db:
            db.execute("""INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json)
                VALUES(1,'Ash','2026-01-01','x','test',?)""",(json.dumps({'account':{'team':2}}),))
        self.assertEqual('valor',self.client.get('/api/appearance').get_json()['team'])
        with closing(get_db()) as db, db:
            db.execute("INSERT INTO user_latest_upload(user_id,raw_json) VALUES(1,'invalid')")
        self.assertEqual('mystic',profile_appearance(1)['team'])

    def test_english_templates_and_shared_theme(self):
        for route in ('/','/verify'):
            response=self.client.get(route)
            self.assertEqual(200,response.status_code)
            html=response.get_data(as_text=True)
            self.assertIn('lang="en"',html)
            self.assertIn('css/material.css',html)
            self.assertIn('js/theme.js',html)
            self.assertNotIn('lang-pl',html)
            self.assertNotIn('Wgraj',html)
        self.assertIn('data-appearance-accent',self.client.get('/').get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()
