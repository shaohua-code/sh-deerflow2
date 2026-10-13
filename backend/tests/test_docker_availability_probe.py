"""The optional Docker integration suite must tolerate an unavailable CLI."""

import subprocess

from test_sandbox_orphan_reconciliation_e2e import _docker_available


def test_docker_probe_treats_process_permission_error_as_unavailable(monkeypatch):
    def deny_process_start(*_args, **_kwargs):
        raise PermissionError("Docker CLI process creation is restricted")

    monkeypatch.setattr(subprocess, "run", deny_process_start)

    assert _docker_available() is False
