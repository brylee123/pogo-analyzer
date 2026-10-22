## Windows quick start

1. Install [Python 3.11+](https://www.python.org/downloads/windows/) (check **Add Python to PATH**).
2. Download the repository from GitHub using **Code → Download ZIP**, extract it, and double-click **`start-windows.bat`**. Or clone it with Git.
3. The script creates `.venv`, installs dependencies, and starts the server. Open **http://127.0.0.1:6090** in a browser.
4. On the first run, point setup to an **existing local server directory** containing complete PGSharp JSON files for **one trainer only**. Create the administrator's username and password (12+ characters). The app imports files from earliest to latest and creates the initial profile.
5. Leave the command window open while using the application. Close it or press Ctrl+C to stop it. On subsequent runs, double-click the batch file again.

No Node.js is required to run the Flask frontend.

**Network access:** The launcher listens on all interfaces (0.0.0.0), so other devices can connect using your PC's LAN IP. The browser on this PC still opens localhost for setup. Do not port-forward this development server.

## Local network access

The Windows launcher explicitly starts the server on `0.0.0.0:6090`, including
when an older `.env` contains `HOST=127.0.0.1`. It opens localhost on the server
PC because first-run setup must run through a loopback connection.

After setup, other devices on the same network can open
`http://YOUR-PC-IP:6090`. For example, if the server PC is `192.168.1.7`, open
[http://192.168.1.7:6090](http://192.168.1.7:6090).
Allow Python/TCP port 6090 through Windows Firewall on Private networks if needed.
`0.0.0.0` is a listening address, not a browser destination.

For a direct start that overrides an existing `.env`:

```powershell
.venv\Scripts\python.exe app.py --host 0.0.0.0
```

For local-only access, start directly with `--host 127.0.0.1`. A direct start
without command-line options honors `HOST` and `PORT` from the environment or
`.env`, falling back to `0.0.0.0` and `6090`. `--port` overrides the port.
Debug mode remains disabled. Do not port-forward this development server.



**Data backup:** Back up `baza_pogo.db` (including its WAL/SHM files when active) and `.env`. Your PGSharp exports and account data should not be committed to a public repository.
