"""Exercise deployment input validation, migration rollback, and CI gates."""

import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock


def load(name):
    path = Path(__file__).resolve().parents[1] / "product/deploy" / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


receiver = load("receive_release")
gate = load("check_ci")


def archive(extra=()):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as output:
        for name, kind, link in [
            ("nginx.conf", tarfile.REGTYPE, ""),
            ("skills/public/example/SKILL.md", tarfile.REGTYPE, ""),
            *extra,
        ]:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.linkname = link
            if kind == tarfile.REGTYPE:
                info.size = 3
                output.addfile(info, io.BytesIO(b"abc"))
            else:
                output.addfile(info)
    return buffer.getvalue()


class InputTests(unittest.TestCase):
    def test_restricted_commands(self):
        self.assertEqual(receiver.parse_command("verify"), ("verify",))
        for command in ("bash", "verify; id", "deploy " + "a" * 40, "", "deploy $(id)"):
            with self.subTest(command=command), self.assertRaises(ValueError):
                receiver.parse_command(command)
        sha, first, second = receiver.parse_command("deploy " + "a" * 40 + " sha256:" + "b" * 64 + " sha256:" + "c" * 64)
        self.assertEqual(sha, "a" * 40)

    def test_valid_archive(self):
        with tempfile.TemporaryDirectory() as path:
            receiver.unpack_assets(archive(), Path(path))
            self.assertEqual((Path(path) / "nginx.conf").read_bytes(), b"abc")

    def test_forbidden_members(self):
        cases = [
            ("../escape", tarfile.REGTYPE, ""),
            ("/etc/crontab", tarfile.REGTYPE, ""),
            ("skills/public/escape", tarfile.SYMTYPE, "/etc"),
            ("skills/public/hard", tarfile.LNKTYPE, "/etc/passwd"),
            ("skills/public/.env", tarfile.REGTYPE, ""),
            ("nginx.conf", tarfile.REGTYPE, ""),
            ("config.yaml", tarfile.REGTYPE, ""),
        ]
        for item in cases:
            with self.subTest(item=item), tempfile.TemporaryDirectory() as path:
                with self.assertRaises(ValueError):
                    receiver.unpack_assets(archive([item]), Path(path))

    def test_archive_size_limit(self):
        with mock.patch.object(receiver, "MAX_ARCHIVE_BYTES", 1):
            with tempfile.TemporaryDirectory() as path, self.assertRaises(ValueError):
                receiver.unpack_assets(archive(), Path(path))


class CIGateTests(unittest.TestCase):
    def runs(self, conclusion="success"):
        return [dict(name=name, status="completed", conclusion=conclusion, event="push", run_number=i, run_attempt=1) for i, name in enumerate(gate.REQUIRED)]

    def test_only_exact_success_is_accepted(self):
        self.assertTrue(gate.verdict(self.runs()))
        self.assertFalse(gate.verdict([]))
        for conclusion in ("failure", "cancelled", "skipped", "timed_out"):
            with self.subTest(conclusion=conclusion), self.assertRaises(RuntimeError):
                gate.verdict(self.runs(conclusion))

    def test_waits_for_running_checks(self):
        runs = self.runs()
        runs[0]["status"] = "in_progress"
        self.assertFalse(gate.verdict(runs))

    def test_rerun_and_optional_checks(self):
        runs = self.runs()
        old = dict(runs[0], run_attempt=0, conclusion="failure")
        self.assertTrue(gate.verdict(runs + [old]))
        extra = dict(runs[0], name="E2E Tests", conclusion="failure")
        with self.assertRaises(RuntimeError):
            gate.verdict(runs + [extra])


class RolloutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "app"
        self.root.mkdir()
        (self.root / "skills/public").mkdir(parents=True)
        (self.root / "skills/public/old").write_text("old", encoding="utf-8")
        (self.root / "docker/nginx").mkdir(parents=True)
        (self.root / "docker/nginx/nginx.conf").write_text("old nginx", encoding="utf-8")
        for name in (".env", "config.yaml", "extensions_config.json", "docker-compose.remote.yaml"):
            (self.root / name).write_text("private operator config", encoding="utf-8")
        self.assets = Path(self.temp.name) / "assets"
        receiver.unpack_assets(archive(), self.assets)
        self.patches = [
            mock.patch.object(receiver, "ROOT", self.root),
            mock.patch.object(receiver, "BACKUPS", Path(self.temp.name) / "backups"),
            mock.patch.object(receiver, "DATA", Path(self.temp.name) / "data"),
            mock.patch.object(receiver, "run", return_value=mock.Mock(stdout="deer-flow-gateway:previous\n")),
            mock.patch.object(receiver, "compose"),
            mock.patch.object(receiver, "save_database"),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_failure_restores_previous_release(self):
        with mock.patch.object(receiver, "start_stack", side_effect=RuntimeError("new migration failed")), mock.patch.object(receiver, "rollback") as restore:
            with self.assertRaises(RuntimeError):
                receiver.apply_release(self.assets, "a" * 40, dict(gateway="new-gateway", frontend="new-frontend"))
            previous = restore.call_args.args[1]
            self.assertEqual(previous, dict(gateway="deer-flow-gateway:previous", frontend="deer-flow-gateway:previous"))
            inspect_calls = [call for call in receiver.run.call_args_list if call.args[:2] == ("docker", "inspect")]
            self.assertEqual(len(inspect_calls), 2)
            self.assertTrue(all(call.args[-1] == "{{.Config.Image}}" for call in inspect_calls))
            self.assertFalse((self.root / "deployed-revision").exists())

    def test_backup_failure_starts_unchanged_services(self):
        with mock.patch.object(receiver, "save_database", side_effect=RuntimeError("backup failed")), mock.patch.object(receiver, "start_stack") as restart, mock.patch.object(receiver, "rollback") as restore:
            with self.assertRaises(RuntimeError):
                receiver.apply_release(self.assets, "a" * 40, dict(gateway="new-gateway", frontend="new-frontend"))
            restart.assert_called_once()
            restore.assert_not_called()
            self.assertFalse((self.root / "docker-compose.images.json").exists())
            self.assertEqual((self.root / "skills/public/old").read_text(), "old")

    def test_success_records_revision_and_preserves_operator_config(self):
        with mock.patch.object(receiver, "start_stack"):
            receiver.apply_release(self.assets, "a" * 40, dict(gateway="new-gateway", frontend="new-frontend"))
        self.assertEqual((self.root / "deployed-revision").read_text().strip(), "a" * 40)
        self.assertEqual((self.root / ".env").read_text(), "private operator config")
        self.assertEqual(json.loads((self.root / "docker-compose.images.json").read_text())["services"]["gateway"]["image"], "new-gateway")


if __name__ == "__main__":
    unittest.main()
