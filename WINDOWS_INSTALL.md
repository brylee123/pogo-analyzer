## Windows quick start

1. Install [Python 3.11+](https://www.python.org/downloads/windows/) (check **Add Python to PATH**).
2. Download the repository from GitHub using **Code → Download ZIP**, extract it, and double-click **`start-windows.bat`**. Or clone it with Git.
3. The script creates `.venv`, installs dependencies, and starts the server. Open **http://127.0.0.1:6090** in a browser.
4. On the first run, point setup to an **existing local server directory** containing complete PGSharp JSON files for **one trainer only**. Create the administrator's username and password (12+ characters). The app imports files from earliest to latest and creates the initial profile.
5. Leave the command window open while using the application. Close it or press Ctrl+C to stop it. On subsequent runs, double-click the batch file again.

No Node.js is required for the current Flask frontend. This branch has a prototype authentication UI, not yet the proposed Material UI PWA.

**Security:** This starts a local-only Flask server on 127.0.0.1. Do not port-forward it. The built-in launcher is for local evaluation, not deployment as a public multiuser web service.

**Data backup:** Back up `baza_pogo.db` (including its WAL/SHM files when active) and `.env`. Your PGSharp exports and account data should not be committed to a public repository.
