"""Regression coverage for #3758: macOS nginx argv rewriting broke make stop."""

from __future__ import annotations

import shlex
import subprocess
from pathlib import Path

import pytest
from support.shell import require_script_bash

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVE_SH = REPO_ROOT / "scripts" / "serve.sh"


def _to_bash_path(path: Path) -> str:
    """Return an absolute path that Git Bash can consume on Windows."""
    posix = path.resolve().as_posix()
    if len(posix) > 1 and posix[1] == ":":
        return "/" + posix[0].lower() + posix[2:]
    return posix


def _extract_shell_function(name: str) -> str:
    text = SERVE_SH.read_text(encoding="utf-8")
    marker = f"{name}() {{"
    start = text.index(marker)
    depth = 0
    chunks: list[str] = []

    for line in text[start:].splitlines(keepends=True):
        chunks.append(line)
        depth += line.count("{") - line.count("}")
        if depth == 0:
            return "".join(chunks)

    raise AssertionError(f"Could not extract shell function {name}")


def _is_repo_nginx_pid(
    *,
    tmp_path: Path,
    command: str,
    args: str,
    repo_root: Path | str,
    deerflow_pid: bool = False,
) -> bool:
    bash = require_script_bash()

    function = _extract_shell_function("_is_repo_nginx_pid")
    repo_root_text = _to_bash_path(Path(repo_root))
    script = f"""
REPO_ROOT={shlex.quote(repo_root_text)}
DEERFLOW_ROOTS={shlex.quote(repo_root_text)}
FAKE_COMMAND={shlex.quote(command)}
FAKE_ARGS={shlex.quote(args)}
FAKE_DEERFLOW_PID={1 if deerflow_pid else 0}

_is_deerflow_pid() {{
    [ "$FAKE_DEERFLOW_PID" = "1" ]
}}

ps() {{
    case "$*" in
        *"-o comm="*) printf '%s\\n' "$FAKE_COMMAND" ;;
        *"-o args="*) printf '%s\\n' "$FAKE_ARGS" ;;
        *) return 1 ;;
    esac
}}

{function}

_is_repo_nginx_pid 12345
"""
    script_path = tmp_path / "nginx-pid-check.sh"
    script_path.write_text(script, encoding="utf-8")
    result = subprocess.run([bash, _to_bash_path(script_path)], check=False)
    return result.returncode == 0


def test_repo_nginx_pid_accepts_macos_rewritten_master_command(tmp_path):
    # The simulated macOS ps line embeds POSIX-form paths no matter which host
    # runs this test, so build the fixture with forward slashes explicitly;
    # on Windows a Path would render with backslashes and never match the
    # "$root"/docker/nginx/... pattern the shell function greps for.
    repo_root_path = tmp_path / "deer-flow"
    repo_root = _to_bash_path(repo_root_path)
    nginx_conf = f"{repo_root}/docker/nginx/nginx.local.conf"

    assert _is_repo_nginx_pid(
        tmp_path=tmp_path,
        command=f"nginx: master process /opt/homebrew/bin/nginx -c {nginx_conf}",
        args=f"nginx: master process /opt/homebrew/bin/nginx -c {nginx_conf} -p {repo_root}",
        repo_root=repo_root_path,
    )


def test_repo_nginx_pid_accepts_macos_rewritten_worker_after_repo_check(tmp_path):
    repo_root = tmp_path / "deer-flow"

    assert _is_repo_nginx_pid(
        tmp_path=tmp_path,
        command="nginx: worker process",
        args="nginx: worker process",
        repo_root=repo_root,
        deerflow_pid=True,
    )


@pytest.mark.parametrize(
    ("command", "args", "deerflow_pid"),
    [
        ("nginx: worker process", "nginx: worker process", False),
        ("python", "python -m nginx /tmp/deer-flow/docker/nginx/nginx.local.conf", True),
    ],
)
def test_repo_nginx_pid_rejects_unowned_or_non_nginx_processes(
    tmp_path,
    command: str,
    args: str,
    deerflow_pid: bool,
):
    assert not _is_repo_nginx_pid(
        tmp_path=tmp_path,
        command=command,
        args=args,
        repo_root=tmp_path / "deer-flow",
        deerflow_pid=deerflow_pid,
    )
