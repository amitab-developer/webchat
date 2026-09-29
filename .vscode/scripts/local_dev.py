from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

COSMOS_IMAGE = "mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview"
CONTAINER_NAME = "webchat-cosmos"
COSMOS_PORT = 8081
GATEWAY_PORT = 1234
ROOT_DIR = Path(__file__).resolve().parents[2]
VENV_PYTHON = ROOT_DIR / ".venv" / "Scripts" / "python.exe"
FRONTEND_DIR = ROOT_DIR / "src" / "frontend"
CLEAN_DIRECTORIES = (
    ROOT_DIR / ".venv",
    FRONTEND_DIR / "node_modules",
)
CLEAN_DIRECTORY_NAMES = {
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".npm-cache",
}


def port_is_open(port: int) -> bool:
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def clean_workspace() -> int:
    directories = list(CLEAN_DIRECTORIES)
    directories.extend(
        path
        for path in ROOT_DIR.rglob("*")
        if path.is_dir() and path.name in CLEAN_DIRECTORY_NAMES
    )
    removed: set[Path] = set()
    for directory in directories:
        if directory in removed or not directory.exists():
            continue
        try:
            shutil.rmtree(directory)
        except OSError as error:
            print(f"[clean] could not remove {directory}: {error}", file=sys.stderr)
            return 1
        removed.add(directory)
        print(f"[clean] removed {directory.relative_to(ROOT_DIR)}", flush=True)
    print("[clean] workspace dependencies and caches cleared", flush=True)
    return 0


def dependencies_are_ready() -> bool:
    if not VENV_PYTHON.is_file():
        return False
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(ROOT_DIR / "src")
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", "import backend.main"],
        capture_output=True,
        env=environment,
        check=False,
    )
    return result.returncode == 0


def restore_python_environment() -> bool:
    if dependencies_are_ready():
        return True
    uv = shutil.which("uv")
    if uv is None:
        print("[preflight] uv is required to restore the Python environment.", file=sys.stderr)
        return False
    print("[preflight] restoring Python environment with uv sync", flush=True)
    result = subprocess.run([uv, "sync"], cwd=ROOT_DIR, check=False)
    if result.returncode != 0:
        print("[preflight] uv sync failed.", file=sys.stderr)
        return False
    if not dependencies_are_ready():
        print("[preflight] Python dependencies are still unavailable after uv sync.", file=sys.stderr)
        return False
    return True


def frontend_dependencies_are_ready(npm: str) -> bool:
    result = subprocess.run(
        [npm, "--prefix", str(FRONTEND_DIR), "ls", "--depth=0"],
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def restore_frontend_dependencies() -> bool:
    npm = shutil.which("npm")
    if npm is None:
        print("[preflight] Node.js/npm is required to restore frontend dependencies.", file=sys.stderr)
        return False
    if frontend_dependencies_are_ready(npm):
        return True
    print("[preflight] restoring frontend dependencies with npm install", flush=True)
    result = subprocess.run([npm, "install"], cwd=FRONTEND_DIR, check=False)
    if result.returncode != 0:
        print("[preflight] npm install failed.", file=sys.stderr)
        return False
    if not frontend_dependencies_are_ready(npm):
        print("[preflight] frontend dependencies are still unavailable after npm install.", file=sys.stderr)
        return False
    return True


def preflight_environment() -> bool:
    ready = restore_python_environment() and restore_frontend_dependencies()
    if shutil.which("docker") is None:
        print("[preflight] Docker is required to run the Cosmos emulator.", file=sys.stderr)
        ready = False
    return ready


def start_cosmos(*, detached: bool = False) -> int:
    if shutil.which("docker") is None:
        print("Docker is required to run the Cosmos emulator.", file=sys.stderr)
        return 1

    if port_is_open(COSMOS_PORT):
        print(f"[cosmos] port already listening on {COSMOS_PORT}", flush=True)
        return 0

    command = ["docker", "run", "--rm"]
    if detached:
        command.append("-d")
    command.extend([
        "--name",
        CONTAINER_NAME,
        "-v",
        "webchat-cosmos-data:/data",
        "-p",
        f"{COSMOS_PORT}:8081",
        "-p",
        f"{GATEWAY_PORT}:1234",
        COSMOS_IMAGE,
    ])
    print(f"[cosmos] starting: {' '.join(command)}", flush=True)
    if detached:
        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            return result.returncode
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if port_is_open(COSMOS_PORT):
                print(f"[cosmos] ready on {COSMOS_PORT}", flush=True)
                return 0
            time.sleep(1)
        print("[cosmos] emulator did not become ready within 180 seconds", file=sys.stderr)
        return 1

    process = subprocess.Popen(command)
    deadline = time.monotonic() + 180
    while process.poll() is None and time.monotonic() < deadline:
        if port_is_open(COSMOS_PORT):
            print(f"[cosmos] ready on {COSMOS_PORT}", flush=True)
            break
        time.sleep(1)

    if process.poll() is None:
        return process.wait()
    return process.returncode


def preflight() -> int:
    if not preflight_environment():
        return 1
    if port_is_open(COSMOS_PORT):
        print(f"[cosmos] preflight ready on {COSMOS_PORT}", flush=True)
        return 0
    print("[cosmos] preflight unavailable; starting emulator", flush=True)
    return start_cosmos(detached=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local WebChat development services.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    up_parser = subparsers.add_parser("up")
    up_parser.add_argument("--services", required=True, choices=("cosmos",))
    subparsers.add_parser("clean")
    subparsers.add_parser("preflight")
    args = parser.parse_args()

    if args.command == "clean":
        return clean_workspace()
    if args.command == "up" and args.services == "cosmos":
        return start_cosmos()
    if args.command == "preflight":
        return preflight()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
