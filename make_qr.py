"""Generate the production QR by calling the Node generator.

Python is only a wrapper so there is one URL check and one encoded value.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python make_qr.py https://your-deployed-host/", file=sys.stderr)
        return 1
    node = shutil.which("node")
    script = Path(__file__).resolve().parent / "scripts" / "make-qr.mjs"
    if node is None or not script.is_file():
        print("Install Node.js 20 or newer, run npm install, then npm run qr -- https://your-deployed-host/", file=sys.stderr)
        return 1
    completed = subprocess.run([node, str(script), sys.argv[1]], check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
