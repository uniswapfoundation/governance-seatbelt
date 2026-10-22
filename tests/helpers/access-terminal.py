"""Exercise the real first-use terminal prompt without echoing the synthetic access code."""
import errno
import json
import os
import pty
import select
import subprocess
import sys
import time

with open(sys.argv[1], encoding="utf-8") as f:
    control = json.load(f)
master, slave = pty.openpty()
child = subprocess.Popen(control["command"], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b""
prompts = 0
deadline = time.monotonic() + control.get("timeoutSeconds", 45)
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            if prompts == 0 and b"Seatbelt team access code (saved for future runs): " in output:
                os.write(master, (control["code"] + "\r").encode())
                prompts += 1
        if child.poll() is not None:
            break
    if child.poll() is None:
        child.kill()
    code = child.wait()
finally:
    os.close(master)
print(json.dumps({"exitCode": code, "prompts": prompts, "output": output.decode(errors="replace")}))
