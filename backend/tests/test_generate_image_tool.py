"""Image generation must work without exposing host bash or another user's files."""

import base64
import importlib
from types import SimpleNamespace

from deerflow.config.paths import Paths
from deerflow.runtime.runs.worker import _delivery_content_with_outputs
from deerflow.runtime.secret_context import ACTIVE_SECRETS_CONTEXT_KEY
from deerflow.tools.tools import BUILTIN_TOOLS

module = importlib.import_module("deerflow.tools.builtins.generate_image_tool")
PNG = b"\x89PNG\r\n\x1a\n" + b"test image data"


def _runtime(*, key: str | None):
    context = {"thread_id": "thread-image", "user_id": "alice"}
    if key:
        context[ACTIVE_SECRETS_CONTEXT_KEY] = {"IMAGE_GENERATION_API_KEY": key}
    return SimpleNamespace(context=context, config={}, state={})


def test_generate_image_is_available_without_bash_and_presents_current_user_output(tmp_path, monkeypatch):
    assert "generate_image" in {tool.name for tool in BUILTIN_TOOLS}
    paths = Paths(tmp_path)
    monkeypatch.setattr(module, "get_paths", lambda: paths)
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://images.example/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "gpt-image-2")

    def post(url, *, headers, json, timeout):
        assert url == "https://images.example/v1/images/generations"
        assert headers == {"Authorization": "Bearer bound-key"}
        assert json == {"model": "gpt-image-2", "prompt": "A red bicycle", "n": 1, "size": "1536x1024", "output_format": "png"}
        assert timeout == 180
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

    monkeypatch.setattr(module.httpx, "post", post)
    result = module._generate_image(_runtime(key="bound-key"), "A red bicycle", "16:9", "call-1")
    virtual_path = result.update["artifacts"][0]
    assert virtual_path.startswith("/mnt/user-data/outputs/generated-")
    assert paths.resolve_virtual_path("thread-image", virtual_path, user_id="alice").read_bytes() == PNG
    assert not paths.sandbox_outputs_dir("thread-image", user_id="bob").exists()
    delivery = _delivery_content_with_outputs(
        {"presented": 1, "paths": [virtual_path], "by_tool": {"generate_image": [virtual_path]}},
        [virtual_path],
    )
    assert delivery["satisfied"] is True


def test_generate_image_requires_active_skill_secret_and_rejects_bad_response(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "get_paths", lambda: Paths(tmp_path))
    monkeypatch.setattr(module.httpx, "post", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("provider called")))
    missing = module._generate_image(_runtime(key=None), "A red bicycle", "1:1", "call-1")
    assert "artifacts" not in missing.update
    assert "activate" in missing.update["messages"][0].content

    monkeypatch.setattr(
        module.httpx,
        "post",
        lambda *args, **kwargs: SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"data": [{"b64_json": base64.b64encode(b"bad").decode()}]}),
    )
    invalid = module._generate_image(_runtime(key="bound-key"), "A red bicycle", "1:1", "call-2")
    assert "artifacts" not in invalid.update
    assert not Paths(tmp_path).sandbox_outputs_dir("thread-image", user_id="alice").exists()
