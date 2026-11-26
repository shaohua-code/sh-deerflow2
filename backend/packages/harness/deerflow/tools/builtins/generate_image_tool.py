"""Bounded image generation for deployments without sandbox bash."""

from __future__ import annotations

import base64
import binascii
import logging
import os
import uuid
from typing import Annotated

import httpx
from langchain.tools import InjectedToolCallId, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from deerflow.config.paths import get_paths
from deerflow.runtime.secret_context import read_active_secrets
from deerflow.runtime.user_context import resolve_runtime_user_id
from deerflow.tools.builtins.present_file_tool import _get_thread_id
from deerflow.tools.types import Runtime

logger = logging.getLogger(__name__)
_SIZES = {"1:1": "1024x1024", "16:9": "1536x1024", "3:2": "1536x1024", "9:16": "1024x1536", "2:3": "1024x1536"}
_MAX_IMAGE_BYTES = 20 * 1024 * 1024


def _generate_image(runtime: Runtime, prompt: str, aspect_ratio: str, tool_call_id: str) -> Command:
    def result(message: str, *, path: str | None = None) -> Command:
        update: dict = {"messages": [ToolMessage(message, tool_call_id=tool_call_id)]}
        if path:
            update["artifacts"] = [path]
        return Command(update=update)

    key = read_active_secrets(runtime.context).get("IMAGE_GENERATION_API_KEY")
    if not key:
        return result("Image generation is unavailable: activate the image-generation skill with a configured API key.")
    thread_id = _get_thread_id(runtime)
    if not thread_id:
        return result("Image generation is unavailable: thread ID is missing.")
    prompt = prompt.strip()
    if not prompt or len(prompt) > 12000:
        return result("Image prompt must contain 1 to 12000 characters.")
    if aspect_ratio not in _SIZES:
        return result("Unsupported aspect ratio. Use 1:1, 16:9, 3:2, 9:16, or 2:3.")

    base_url = os.getenv("IMAGE_GENERATION_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("IMAGE_GENERATION_MODEL", "gpt-image-2.5-flare")
    if not base_url.startswith("https://") or not model:
        return result("Image generation provider is not configured correctly.")
    fields = {"model": model, "prompt": prompt, "n": 1, "size": os.getenv("IMAGE_GENERATION_SIZE") or _SIZES[aspect_ratio]}
    if model in {"dall-e-2", "dall-e-3"}:
        fields["response_format"] = "b64_json"
    else:
        fields["output_format"] = "png"
    try:
        response = httpx.post(
            f"{base_url}/images/generations",
            headers={"Authorization": f"Bearer {key}"},
            json=fields,
            timeout=180,
        )
        response.raise_for_status()
        item = response.json()["data"][0]
        encoded = item.get("b64_json") or item.get("image_base64") or item.get("base64")
        if not encoded and str(item.get("url", "")).startswith("data:image/png;base64,"):
            encoded = item["url"].split(",", 1)[1]
        if not isinstance(encoded, str):
            return result("Image provider did not return inline image data.")
        image = base64.b64decode(encoded, validate=True)
        if not image.startswith(b"\x89PNG\r\n\x1a\n") or len(image) > _MAX_IMAGE_BYTES:
            return result("Image provider returned an invalid or oversized PNG.")
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, binascii.Error):
        logger.exception("Image generation provider request failed")
        return result("Image generation failed at the provider. Check the Gateway logs for the status code.")

    outputs = get_paths().sandbox_outputs_dir(thread_id, user_id=resolve_runtime_user_id(runtime))
    outputs.mkdir(parents=True, exist_ok=True)
    filename = f"generated-{uuid.uuid4().hex}.png"
    output = outputs / filename
    output.write_bytes(image)
    virtual_path = f"/mnt/user-data/outputs/{filename}"
    return result(f"Generated image: {virtual_path}", path=virtual_path)


@tool("generate_image", parse_docstring=True)
def generate_image_tool(
    runtime: Runtime,
    prompt: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    aspect_ratio: str = "16:9",
) -> Command:
    """Generate and present one image from a text prompt using the active image-generation skill.

    Args:
        prompt: Detailed English description of the image to generate.
        aspect_ratio: One of 1:1, 16:9, 3:2, 9:16, or 2:3.
    """
    return _generate_image(runtime, prompt, aspect_ratio, tool_call_id)
