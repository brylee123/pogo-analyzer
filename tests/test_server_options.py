import os
import unittest
from unittest.mock import patch
from server_options import server_options


class ServerOptionsTests(unittest.TestCase):
    def test_default_listens_on_lan(self):
        with patch.dict(os.environ, {}, clear=True):
            options = server_options([])
        self.assertEqual(("0.0.0.0", 6090), (options.host, options.port))

    def test_launcher_overrides_legacy_loopback_env(self):
        with patch.dict(os.environ, {"HOST": "127.0.0.1", "PORT": "6090"}, clear=True):
            options = server_options(["--host", "0.0.0.0"])
        self.assertEqual("0.0.0.0", options.host)

    def test_direct_start_respects_explicit_env(self):
        with patch.dict(os.environ, {"HOST": "127.0.0.1", "PORT": "7000"}, clear=True):
            options = server_options([])
        self.assertEqual(("127.0.0.1", 7000), (options.host, options.port))

    def test_command_line_can_select_loopback_and_port(self):
        with patch.dict(os.environ, {"HOST": "0.0.0.0", "PORT": "6090"}, clear=True):
            options = server_options(["--host", "127.0.0.1", "--port", "7001"])
        self.assertEqual(("127.0.0.1", 7001), (options.host, options.port))


if __name__ == "__main__":
    unittest.main()
