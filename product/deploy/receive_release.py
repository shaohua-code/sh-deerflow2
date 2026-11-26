#!/usr/bin/env python3
"""Restricted SSH entry point for the single Flow Desk production stack.

Install root-owned at /usr/local/lib/flowdesk/receive_release.py. The deployment
key must use a forced command; it must never receive a general-purpose shell.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path("/srv/flowdesk")
DATA = Path("/data/flowdesk")
BACKUPS = Path("/srv/flowdesk-backups")
REPOSITORY = "ghcr.io/shaohua-code/sh-deerflow2-flowdesk"
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024


def parse_command(command: str) -> tuple[str, ...]:
    if command == "verify":
        return ("verify",)
    match = re.fullmatch(r"deploy ([0-9a-f]{40}) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64})", command)
    if match is None:
        raise ValueError("Only verify or a deployment with a commit and two digests is accepted")
    return match.groups()


def unpack_assets(payload: bytes, destination: Path) -> None:
    """Extract only regular public skill files and nginx.conf, with bounded size."""
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise ValueError("Release archive is too large")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    total = 0
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name:
                raise ValueError("Unsafe release path")
            if member.name in seen or not (member.isfile() or member.isdir()):
                raise ValueError("Duplicate paths and special files are forbidden")
            seen.add(member.name)
            allowed = member.name == "nginx.conf" or member.name in ("skills", "skills/public") or path.parts[:2] == ("skills", "public")
            if not allowed:
                raise ValueError("Release assets must be nginx.conf or public skills")
            if any(part.startswith(".") for part in path.parts) or path.suffix == ".pyc":
                raise ValueError("Runtime and hidden files are forbidden")
            total += member.size
            if total > MAX_ARCHIVE_BYTES or len(seen) > 10000:
                raise ValueError("Expanded release exceeds limits")
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                if member.size > 8 * 1024 * 1024:
                    raise ValueError("Single release file is too large")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)
    if not (destination / "nginx.conf").is_file() or not (destination / "skills/public").is_dir():
        raise ValueError("Release is missing nginx.conf or public skills")


def run(*args: str, **kwargs):
    # Never print stdin, environment, or expanded Compose configuration.
    return subprocess.run(args, check=True, **kwargs)


def compose(*args: str):
    files = ["docker/docker-compose.yaml", "product/deploy/docker-compose.postgres.yaml", "docker-compose.remote.yaml"]
    if (ROOT / "docker-compose.images.json").exists():
        files.append("docker-compose.images.json")
    command = ["docker", "compose", "--env-file", str(ROOT / ".env"), "-p", "flowdesk"]
    for name in files:
        command += ["-f", str(ROOT / name)]
    return run(*command, *args, cwd=ROOT)


def write_images(gateway: str, frontend: str) -> None:
    path = ROOT / "docker-compose.images.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"services": {"gateway": {"image": gateway}, "frontend": {"image": frontend}}}) + "\n", encoding="utf-8")
    temporary.replace(path)


def health() -> None:
    for route in ("/health/ready", "/login", "/api/product/v1/public-brand"):
        with urllib.request.urlopen("http://127.0.0.1:2026" + route, timeout=8) as response:
            if response.status != 200:
                raise RuntimeError("HTTP deployment probe failed")
            if route == "/health/ready":
                result = json.load(response)
                if result.get("status") != "ready" or result.get("database") != "ok" or result.get("checkpointer") != "ok":
                    raise RuntimeError("Gateway persistence is not ready")


def start_stack() -> None:
    compose("up", "-d", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "150", "frontend", "gateway", "nginx")
    for attempt in range(10):
        try:
            health()
            return
        except Exception:
            if attempt == 9:
                raise
            time.sleep(2)


def save_database(path: Path) -> None:
    with path.open("wb") as output:
        run("docker", "exec", "flowdesk-postgres", "pg_dump", "-U", "deerflow", "-d", "deerflow", "-Fc", stdout=output)
    with path.open("rb") as source:
        run("docker", "exec", "-i", "flowdesk-postgres", "pg_restore", "--list", stdin=source, stdout=subprocess.DEVNULL)


def rollback(backup: Path, previous: dict[str, str]) -> None:
    print("Restoring the previous images, database and files", flush=True)
    compose("stop", "nginx", "frontend", "gateway")
    with (backup / "database.dump").open("rb") as source:
        run("docker", "exec", "-i", "flowdesk-postgres", "pg_restore", "-U", "deerflow", "-d", "deerflow", "--clean", "--if-exists", "--exit-on-error", stdin=source)
    # Preserve failed-release writes for operator inspection; never overlay them
    # onto the pre-migration files or delete a computed runtime directory.
    DATA.rename(backup / "failed-runtime")
    run("tar", "-xzf", str(backup / "runtime.tar.gz"), "-C", str(DATA.parent))
    public = ROOT / "skills/public"
    if public.exists():
        public.rename(backup / "failed-skills")
    shutil.copytree(backup / "public", public)
    shutil.copyfile(backup / "nginx.conf", ROOT / "docker/nginx/nginx.conf")
    write_images(previous["gateway"], previous["frontend"])
    start_stack()
    print("Rollback passed readiness checks", flush=True)


def apply_release(assets: Path, revision: str, images: dict[str, str]) -> None:
    """Snapshot before migration, and restore the same snapshot on failed rollout."""
    previous = {}
    for service in ("gateway", "frontend"):
        # Config.Image is the pullable digest or local tag used to create the
        # container. The top-level Image field is an image ID, which Compose
        # cannot reliably use as a service image during rollback.
        result = run("docker", "inspect", f"flowdesk-{service}", "--format", "{{.Config.Image}}", capture_output=True, text=True)
        previous[service] = result.stdout.strip()
    backup = BACKUPS / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + revision[:12])
    backup.mkdir(mode=0o700, parents=True)
    shutil.copytree(ROOT / "skills/public", backup / "public")
    shutil.copyfile(ROOT / "docker/nginx/nginx.conf", backup / "nginx.conf")
    for name in (".env", "config.yaml", "extensions_config.json", "docker-compose.remote.yaml"):
        shutil.copyfile(ROOT / name, backup / name)
    (backup / "previous-images.json").write_text(json.dumps(previous), encoding="utf-8")
    if (ROOT / "docker-compose.images.json").exists():
        shutil.copyfile(ROOT / "docker-compose.images.json", backup / "previous-overlay.json")
    stopped = False
    changed = False
    try:
        stopped = True
        compose("stop", "nginx", "frontend", "gateway")
        save_database(backup / "database.dump")
        run("tar", "-czf", str(backup / "runtime.tar.gz"), "-C", str(DATA.parent), DATA.name)
        run("tar", "-tzf", str(backup / "runtime.tar.gz"), stdout=subprocess.DEVNULL)
        (backup / "snapshot-complete").touch()
        changed = True
        (ROOT / "skills/public").rename(backup / "replaced-public")
        shutil.copytree(assets / "skills/public", ROOT / "skills/public")
        shutil.copyfile(assets / "nginx.conf", ROOT / "docker/nginx/nginx.conf")
        write_images(images["gateway"], images["frontend"])
        compose("config", "--quiet")
        start_stack()
    except BaseException:
        if changed:
            rollback(backup, previous)
        elif stopped:
            start_stack()
        raise
    (ROOT / "deployed-revision").write_text(revision + "\n", encoding="utf-8")
    print(f"Deployed {revision}; recovery snapshot: {backup.name}", flush=True)


def deploy(revision: str, gateway_digest: str, frontend_digest: str) -> None:
    actor = sys.stdin.buffer.readline(257).decode("utf-8").rstrip("\n")
    token = sys.stdin.buffer.readline(8193).decode("utf-8").rstrip("\n")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", actor) or not token or len(token) > 8192:
        raise ValueError("Missing ephemeral registry authentication")
    payload = sys.stdin.buffer.read(MAX_ARCHIVE_BYTES + 1)
    with tempfile.TemporaryDirectory(prefix=".ci-", dir=ROOT) as directory:
        workspace = Path(directory)
        unpack_assets(payload, workspace / "assets")
        docker_config = workspace / "docker"
        docker_config.mkdir(mode=0o700)
        run("docker", "--config", str(docker_config), "login", "ghcr.io", "-u", actor, "--password-stdin", input=token + "\n", text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        images = {"gateway": f"{REPOSITORY}-gateway@{gateway_digest}", "frontend": f"{REPOSITORY}-frontend@{frontend_digest}"}
        for image in images.values():
            run("docker", "--config", str(docker_config), "pull", image)
            result = run("docker", "image", "inspect", image, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', capture_output=True, text=True)
            if result.stdout.strip() != revision:
                raise ValueError("Image revision differs from deployment commit")
        del token
        if shutil.disk_usage(ROOT).free < 6 * 1024**3:
            raise RuntimeError("Less than 6 GiB free; release refused before stopping services")
        apply_release(workspace / "assets", revision, images)


def main() -> None:
    import fcntl

    os.umask(0o077)
    command = parse_command(sys.argv[1] if len(sys.argv) == 2 else os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    # All paths are fixed by the operator, never supplied by SSH callers.
    if ROOT.resolve() != ROOT or DATA.resolve() != DATA or BACKUPS.resolve() != BACKUPS:
        raise ValueError("Deployment paths must not be symlinks")
    with (ROOT / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if command == ("verify",):
            compose("config", "--quiet")
            health()
            print("Restricted deployment key, Compose and readiness checks passed")
            return
        def interrupted(signum, frame):
            raise RuntimeError("Deployment interrupted")
        signal.signal(signal.SIGTERM, interrupted)
        deploy(*command)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exception messages from external clients may contain credentials.
        print(f"Deployment failed ({type(error).__name__}); previous release retained or recovery attempted", file=sys.stderr)
        sys.exit(1)
