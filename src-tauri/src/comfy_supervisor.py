"""Run ComfyUI without a console window; keep logs/control alive across editor exits.

Only the loopback control socket accepts requests, authenticated by a per-session
token. No shell, SSH, batch launcher, or third-party Python package is involved.
"""
import _thread
import hmac
import io
import json
import os
from pathlib import Path
import runpy
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value), encoding="utf-8")
    os.replace(temp, path)


class BinaryOutput(io.RawIOBase):
    """ComfyUI's logger wraps stream.buffer in its own TextIOWrapper."""
    def __init__(self, output):
        self.output = output

    def writable(self):
        return True

    def write(self, value):
        self.output.write(bytes(value).decode("utf-8", errors="replace"))
        return len(value)

    def flush(self):
        self.output.flush()

    def fileno(self):
        return self.output.fileno()


class Output(io.TextIOBase):
    """Bound disk usage, flush each write, and keep stdout/stderr interleaved."""
    def __init__(self, path):
        self.file = open(path, "a+", encoding="utf-8", errors="replace", newline="")
        self.lock = threading.RLock()

    @property
    def encoding(self):
        return "utf-8"

    @property
    def buffer(self):
        # Independent adapters: closing a stdout wrapper must not close stderr.
        return BinaryOutput(self)

    @property
    def line_buffering(self):
        return True

    def writable(self):
        return True

    def isatty(self):
        return False

    def fileno(self):
        return self.file.fileno()

    def reconfigure(self, **kwargs):
        pass

    def write(self, value):
        with self.lock:
            # Native extensions may write directly to the inherited file handle.
            if os.fstat(self.file.fileno()).st_size > 8 * 1024 * 1024:
                self.file.seek(0)
                tail = self.file.read()[-2 * 1024 * 1024:]
                self.file.seek(0)
                self.file.truncate()
                self.file.write(tail)
            result = self.file.write(value)
            self.file.flush()
            return result

    def flush(self):
        with self.lock:
            self.file.flush()


def main():
    session = Path(sys.argv[1])
    config = json.loads((session / "launch.json").read_text(encoding="utf-8"))
    token = config["token"]
    output = Output(session / "output.log")
    sys.stdout = sys.stderr = output
    stopping = threading.Event()

    class Control(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.handle_control(False)

        def do_POST(self):
            self.handle_control(True)

        def handle_control(self, mutate):
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.send_error(403)
                return
            if self.path not in (["/stop", "/force"] if mutate else ["/state"]):
                self.send_error(404)
                return
            result = json.dumps({"pid": os.getpid(), "stopping": stopping.is_set()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
            self.wfile.flush()
            if mutate:
                stopping.set()
                if self.path == "/force":
                    def force():
                        atomic_json(session / "exit.json", {"code": 137, "stopped": True})
                        os._exit(137)
                    threading.Timer(0.15, force).start()
                else:
                    print("\n[INFO] Shutdown requested", flush=True)
                    _thread.interrupt_main()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Control)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    atomic_json(session / "control.json", {"port": server.server_address[1]})
    print("[INFO] ComfyUI process started · PID " + str(os.getpid()), flush=True)
    code = 0
    try:
        directory = config["directory"]
        sys.path.insert(0, directory)
        sys.argv = [str(Path(directory) / "main.py")] + config["args"]
        runpy.run_path(sys.argv[0], run_name="__main__")
    except KeyboardInterrupt:
        stopping.set()
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else (1 if exc.code else 0)
    except BaseException:
        code = 1
        traceback.print_exc()
    finally:
        print("\n[INFO] ComfyUI exited · code " + str(code), flush=True)
        atomic_json(session / "exit.json", {"code": code, "stopped": stopping.is_set()})
        server.shutdown()
    # Custom nodes can leave non-daemon threads behind. The session has ended.
    output.flush()
    os._exit(code)


if __name__ == "__main__":
    main()
