"""One-time operator registration of a trusted export identity.

Usage: python provision_trainer.py /secure/path/to/PGSStats.json
This *must* come from an independently trusted source, NOT a claimant upload.
"""
import json
import sys
from pathlib import Path
from database import init_db
from auth import init_auth
from verification import init_verification, provision
from history import verify
if __name__=="__main__":
    if len(sys.argv)!=2:
        sys.exit("Usage: python provision_trainer.py /path/to/trusted/PGSStats.json")
    data=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    name,_=verify(data)
    timestamp=data["account"].get("creationTimeMs")
    if not timestamp:sys.exit("Creation timestamp missing")
    init_db();init_auth();init_verification()
    provision(name,timestamp)
    print("Trusted reference registered for trainer:",name)
