"""Runs a command on a pseudo-terminal and types into it: python3 on-terminal.py <steps-json> <command...>

steps: [[text to wait for, keys to type], ...]. Prints what the terminal showed, exits with the command's code.
"""
import fcntl, json, os, pty, select, signal, struct, sys, termios, time

LIMIT_SECONDS = 15
TIMED_OUT = 124
ROWS, COLUMNS = 24, 80

steps = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    # A new pseudo-terminal is 0 columns wide: text would wrap after every character.
    fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLUMNS, 0, 0))
    os.execvp(sys.argv[2], sys.argv[2:])


def reads_keys():
    # Keys typed while the terminal still edits lines reach the program as a line, not as keys.
    return not termios.tcgetattr(fd)[3] & termios.ICANON


shown = b""
deadline = time.monotonic() + LIMIT_SECONDS
ended = False
while time.monotonic() < deadline:
    if steps and steps[0][0].encode() in shown and reads_keys():
        os.write(fd, steps.pop(0)[1].encode())
    ready, _, _ = select.select([fd], [], [], 0.05)
    if not ready:
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        chunk = b""
    if not chunk:
        ended = True
        break
    shown += chunk

sys.stdout.write(shown.decode(errors="replace"))
sys.stdout.flush()
if not ended:
    os.kill(pid, signal.SIGKILL)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if ended else TIMED_OUT)
