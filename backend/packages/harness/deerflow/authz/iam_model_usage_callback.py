"""LangChain callback that meters DeerFlow model calls through Central IAM.

Usage is opt-in and uses only the Gateway's in-memory IAM vault capability.
Prompt and completion content is inspected transiently for token estimation,
but only UUIDs, token counts, outcomes, and latency are sent to Central IAM.
"""

from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from collections.abc import Mapping, Sequence
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from langchain_core.callbacks import BaseCallbackHandler

from deerflow.authz.iam_model_usage import IamModelUsageClient
from deerflow.persistence.iam_model_usage_outbox import (
    IamModelUsageOutboxStore,
    get_iam_model_usage_outbox_store,
)

logger = logging.getLogger(__name__)

_CENTRAL_IAM_PROVIDER = "deerflow.authz.iam_deerflow:DeerFlowIamAuthorizationProvider"
_MAX_TOKENS = 10_000_000
_CJK_RE = re.compile(r"[\u1100-\u11ff\u2e80-\u2fff\u3040-\u30ff\u3100-\u312f\u3130-\u318f\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]")
_RUN_MODEL_USAGE_CALLBACK: ContextVar[IamModelUsageCallback | None] = ContextVar(
    "deerflow_run_iam_model_usage_callback",
    default=None,
)


@dataclass(frozen=True, slots=True)
class _UsageAttempt:
    request_id: str
    tenant_id: str
    model_id: str
    application_id: str
    user_id: str
    input_tokens_estimate: int
    reserved_output_tokens: int
    reservation_required: bool
    started_at: float


class IamModelUsageCallback(BaseCallbackHandler):
    """Reserve before dispatch, settle known results, and hold uncertain outcomes.

    This is a synchronous callback on purpose: LangChain dispatches synchronous
    handlers from async model calls in its callback executor. ``raise_error``
    makes reserve failures propagate before the Provider receives the prompt.
    Settlement failures are logged with redacted identifiers and do not leak
    prompts or Provider error objects.
    """

    raise_error = True
    run_inline = False

    def __init__(
        self,
        *,
        client: IamModelUsageClient,
        credentials: Mapping[str, Any],
        tenant_id: str,
        application_id: str,
        model_resource_ids: Mapping[str, str],
        reserved_output_tokens: Mapping[str, int],
        outbox_store: IamModelUsageOutboxStore | None = None,
    ) -> None:
        self._client: IamModelUsageClient | None = client
        self._credentials: Mapping[str, Any] | None = credentials
        self._tenant_id = _uuid(tenant_id, "IAM tenant ID")
        self._application_id = _uuid(application_id, "IAM application ID")
        self._model_resource_ids = dict(model_resource_ids)
        self._reserved_output_tokens = dict(reserved_output_tokens)
        self._outbox_store = outbox_store
        self._user_id: str | None = None
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._pending: dict[str, _UsageAttempt] = {}
        self._starting: set[str] = set()
        self._closed = False

    def __repr__(self) -> str:
        return "IamModelUsageCallback(<server credentials redacted>)"

    def for_model(self, model_name: str) -> IamModelUsageModelCallback:
        """Bind the server-selected DeerFlow profile name to one model instance.

        Provider deployment names can differ from ``config.models[].name``.
        Binding the profile name here keeps usage attribution identical to the
        earlier ``model.invoke`` check without trusting request metadata.
        """
        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError("DeerFlow model name is required for IAM usage")
        return IamModelUsageModelCallback(self, model_name.strip())

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._reserve_before_dispatch(serialized, messages, run_id=run_id, callback_kwargs=kwargs)

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._reserve_before_dispatch(serialized, prompts, run_id=run_id, callback_kwargs=kwargs)

    def on_llm_end(self, response: Any, *, run_id: UUID, **_kwargs: Any) -> None:
        attempt = self._take_attempt(run_id)
        if attempt is None:
            return
        input_tokens, output_tokens, estimated = _read_usage(response)
        if input_tokens is None:
            input_tokens = attempt.input_tokens_estimate
            estimated = True
        if output_tokens is None:
            output_tokens = _estimate_output_tokens(response)
            estimated = True
        self._finish(attempt, input_tokens, output_tokens, "succeeded", estimated)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **_kwargs: Any) -> None:
        # 按已确认的配额策略，只有能证明 Provider 未被调用时才能释放预留。
        # An exception after the start callback does not prove that the Provider
        # never received or billed the request (for example, a read timeout can
        # happen after the Provider completed). Keep the reservation open for
        # IAM's administrator reconciliation flow instead of guessing zero use.
        with self._lock:
            attempt = self._pending.get(str(run_id))
        if attempt is not None:
            logger.warning(
                "Leaving IAM model usage reservation unresolved after Provider error (%s)",
                type(error).__name__,
            )

    def close(self) -> None:
        """Drop local callback capabilities without guessing an unknown call's outcome.

        A missing terminal LangChain event does not prove that the Provider was
        never called or that it completed without billable usage. Leave the
        durable IAM reservation untouched so it can enter the administrator
        reconciliation flow after its normal expiry.
        """
        with self._condition:
            if self._closed:
                return
            self._closed = True
            # A sync callback may still be in LangChain's executor while the
            # async worker is being cancelled. Wait for its bounded IAM calls
            # to finish before dropping the run's credential capability.
            while self._starting:
                self._condition.wait()
            pending = list(self._pending.values())
            self._pending.clear()

        if pending:
            logger.warning(
                "Leaving %d IAM model usage reservation(s) unresolved for administrator reconciliation",
                len(pending),
            )

        # Explicitly drop capability references before the worker resets its
        # run-scoped credential context.
        with self._lock:
            self._credentials = None
            self._client = None

    def _reserve_before_dispatch(
        self,
        serialized: Mapping[str, Any],
        prompt_payload: Any,
        *,
        run_id: UUID,
        callback_kwargs: Mapping[str, Any],
        bound_model_name: str | None = None,
    ) -> None:
        call_key = str(run_id)
        with self._lock:
            if self._closed:
                raise RuntimeError("IAM model usage callback is closed")
            if call_key in self._pending or call_key in self._starting:
                return
            self._starting.add(call_key)

        try:
            model_name = bound_model_name or self._resolve_model_name(serialized, callback_kwargs)
            model_id = self._model_resource_ids.get(model_name)
            output_cap = self._reserved_output_tokens.get(model_name)
            if model_id is None or output_cap is None:
                raise RuntimeError("IAM usage policy is not configured for the invoked model")
            input_estimate = _estimate_tokens(prompt_payload)
            user_id = self._resolve_user_id()
            request_id = f"deerflow:llm:{_safe_run_suffix(run_id)}"
            client = self._require_client()
            reservation = client.reserve_usage(
                request_id=request_id,
                tenant_id=self._tenant_id,
                model_id=model_id,
                application_id=self._application_id,
                user_id=user_id,
                reserved_input_tokens=input_estimate,
                reserved_output_tokens=output_cap,
            )
            attempt = _UsageAttempt(
                request_id=request_id,
                tenant_id=self._tenant_id,
                model_id=model_id,
                application_id=self._application_id,
                user_id=user_id,
                input_tokens_estimate=input_estimate,
                reserved_output_tokens=output_cap,
                reservation_required=reservation["reservation_required"],
                started_at=time.monotonic(),
            )
            with self._lock:
                if self._closed:
                    # The run cannot normally close while an LLM start callback
                    # is still executing. If cancellation races this path, the
                    # reservation is returned as a failed call immediately.
                    self._finish(attempt, input_estimate, 0, "failed", True)
                    raise RuntimeError("IAM model usage callback closed during model admission")
                self._pending[call_key] = attempt
        finally:
            with self._condition:
                self._starting.discard(call_key)
                self._condition.notify_all()

    def _resolve_model_name(self, serialized: Mapping[str, Any], callback_kwargs: Mapping[str, Any]) -> str:
        candidates: set[str] = set()
        sources: list[Any] = [serialized.get("kwargs"), callback_kwargs.get("invocation_params"), callback_kwargs]
        for source in sources:
            if not isinstance(source, Mapping):
                continue
            for key in ("model", "model_name", "model_id", "deployment_name"):
                value = source.get(key)
                if isinstance(value, str) and value.strip() in self._model_resource_ids:
                    candidates.add(value.strip())
        if len(candidates) != 1:
            raise RuntimeError("IAM usage policy could not identify the invoked model")
        return candidates.pop()

    def _resolve_user_id(self) -> str:
        with self._lock:
            if self._user_id is not None:
                return self._user_id
            credentials = self._credentials
            client = self._client
            access_token = credentials.get("iam_access_token") if isinstance(credentials, Mapping) else None
            if not isinstance(access_token, str) or not access_token:
                raise RuntimeError("The IAM session is unavailable for model usage admission")
            user_id = client.resolve_user_id(access_token) if client is not None else None
            if not user_id:
                raise RuntimeError("IAM could not resolve the model usage user")
            self._user_id = _uuid(user_id, "IAM user ID")
            return self._user_id

    def _take_attempt(self, run_id: UUID) -> _UsageAttempt | None:
        with self._lock:
            self._starting.discard(str(run_id))
            return self._pending.pop(str(run_id), None)

    def _finish(
        self,
        attempt: _UsageAttempt,
        input_tokens: int,
        output_tokens: int,
        outcome: str,
        usage_is_estimated: bool,
    ) -> None:
        client = self._require_client()
        latency_ms = min(86_400_000, max(0, round((time.monotonic() - attempt.started_at) * 1000)))
        event = {
            "request_id": attempt.request_id,
            "tenant_id": attempt.tenant_id,
            "model_id": attempt.model_id,
            "application_id": attempt.application_id,
            "user_id": attempt.user_id,
            "action": "settle" if attempt.reservation_required else "report",
            "reserved_input_tokens": attempt.input_tokens_estimate,
            "reserved_output_tokens": attempt.reserved_output_tokens,
            "input_tokens": _bounded_tokens(input_tokens),
            "output_tokens": _bounded_tokens(output_tokens),
            "outcome": outcome,
            "usage_is_estimated": usage_is_estimated,
            "latency_ms": latency_ms,
        }
        try:
            if self._outbox_store is None:
                self._deliver_direct(client, attempt, event)
            else:
                self._outbox_store.enqueue(**event)
                self._outbox_store.dispatch_request(attempt.request_id, client)
        except Exception as exc:
            # If the local DB is unavailable, make one best-effort IAM request.
            # Once enqueued, IAM request-ID idempotency makes this fallback safe.
            logger.warning(
                "IAM model usage outbox failed for request %s (%s)",
                attempt.request_id,
                type(exc).__name__,
            )
            self._deliver_direct(client, attempt, event)

    @staticmethod
    def _deliver_direct(
        client: IamModelUsageClient,
        attempt: _UsageAttempt,
        event: Mapping[str, Any],
    ) -> None:
        """Best-effort fallback when durable local persistence is unavailable."""
        arguments = {
            "request_id": event["request_id"],
            "input_tokens": event["input_tokens"],
            "output_tokens": event["output_tokens"],
            "outcome": event["outcome"],
            "usage_is_estimated": event["usage_is_estimated"],
            "latency_ms": event["latency_ms"],
        }
        try:
            if event["action"] == "settle":
                client.settle_usage(**arguments)
            else:
                client.report_usage(
                    tenant_id=attempt.tenant_id,
                    model_id=attempt.model_id,
                    application_id=attempt.application_id,
                    user_id=attempt.user_id,
                    **arguments,
                )
        except Exception as exc:
            logger.warning(
                "IAM model usage delivery failed for request %s (%s)",
                attempt.request_id,
                type(exc).__name__,
            )

    def _require_client(self) -> IamModelUsageClient:
        client = self._client
        if client is None:
            raise RuntimeError("IAM model usage callback is closed")
        return client


def build_iam_model_usage_callback(
    app_config: Any,
    credentials: Mapping[str, Any] | None,
    *,
    environ: Mapping[str, str] | None = None,
) -> IamModelUsageCallback | None:
    """Build a callback only for the explicitly enabled Central IAM adapter."""
    authorization = getattr(app_config, "authorization", None)
    provider = getattr(authorization, "provider", None)
    if provider is None or getattr(provider, "use", None) != _CENTRAL_IAM_PROVIDER:
        return None

    provider_config = getattr(provider, "config", None)
    if not isinstance(provider_config, Mapping):
        return None
    usage_config = provider_config.get("model_usage")
    if not isinstance(usage_config, Mapping) or usage_config.get("enabled") is not True:
        return None
    if getattr(authorization, "enabled", False) is not True:
        raise ValueError("Central IAM authorization must be enabled before model usage metering")
    if not isinstance(credentials, Mapping):
        raise ValueError("A server-owned IAM session is required for model usage metering")

    env = os.environ if environ is None else environ
    gateway_key = env.get("IAM_MODEL_USAGE_API_KEY")
    if not isinstance(gateway_key, str) or len(gateway_key) < 32:
        raise ValueError("IAM_MODEL_USAGE_API_KEY must contain at least 32 characters")

    api_base_url = provider_config.get("api_base_url")
    application_id = provider_config.get("application_id")
    tenant_id = credentials.get("iam_tenant_id")
    if not isinstance(api_base_url, str) or not api_base_url.strip():
        raise ValueError("Central IAM api_base_url is required for model usage metering")

    resource_ids = provider_config.get("model_resource_ids")
    output_caps = usage_config.get("reserved_output_tokens")
    if not isinstance(resource_ids, Mapping) or not resource_ids:
        raise ValueError("Central IAM model_resource_ids must be configured for model usage metering")
    if not isinstance(output_caps, Mapping) or not output_caps:
        raise ValueError("model_usage.reserved_output_tokens must explicitly cover configured models")

    validated_ids: dict[str, str] = {}
    validated_caps: dict[str, int] = {}
    for raw_name, raw_id in resource_ids.items():
        if not isinstance(raw_name, str) or not raw_name.strip():
            raise ValueError("Central IAM model names must be non-empty strings")
        name = raw_name.strip()
        validated_ids[name] = _uuid(raw_id, "IAM model ID")
        raw_cap = output_caps.get(name)
        if isinstance(raw_cap, bool) or not isinstance(raw_cap, int) or not 1 <= raw_cap <= _MAX_TOKENS:
            raise ValueError("Each configured IAM model needs a valid reserved output token cap")
        validated_caps[name] = raw_cap

    database_config = getattr(app_config, "database", None)
    if database_config is None:
        raise ValueError("A persistent DeerFlow database is required for IAM model usage metering")
    outbox_store = get_iam_model_usage_outbox_store(database_config)
    timeout = provider_config.get("timeout_seconds", 3.0)
    client = IamModelUsageClient(api_base_url, gateway_key, timeout_seconds=timeout)
    return IamModelUsageCallback(
        client=client,
        credentials=credentials,
        tenant_id=_uuid(tenant_id, "IAM tenant ID"),
        application_id=_uuid(application_id, "IAM application ID"),
        model_resource_ids=validated_ids,
        reserved_output_tokens=validated_caps,
        outbox_store=outbox_store,
    )


class IamModelUsageModelCallback(BaseCallbackHandler):
    """Per-model adapter that pins the configured model profile name."""

    raise_error = True
    run_inline = False

    def __init__(self, parent: IamModelUsageCallback, model_name: str) -> None:
        self._parent = parent
        self._model_name = model_name

    def __repr__(self) -> str:
        return "IamModelUsageModelCallback(<server model binding redacted>)"

    def close(self) -> None:
        """Release the one-call parent callback and its vault capability."""
        self._parent.close()

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._parent._reserve_before_dispatch(
            serialized,
            messages,
            run_id=run_id,
            callback_kwargs=kwargs,
            bound_model_name=self._model_name,
        )

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._parent._reserve_before_dispatch(
            serialized,
            prompts,
            run_id=run_id,
            callback_kwargs=kwargs,
            bound_model_name=self._model_name,
        )

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        self._parent.on_llm_end(response, run_id=run_id, **kwargs)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._parent.on_llm_error(error, run_id=run_id, **kwargs)


def bind_run_iam_model_usage_callback(callback: IamModelUsageCallback | None) -> Token:
    """Bind the run's callback for model instances created inside this run."""
    return _RUN_MODEL_USAGE_CALLBACK.set(callback)


def reset_run_iam_model_usage_callback(token: Token) -> None:
    """Restore the previous callback after the run finishes."""
    _RUN_MODEL_USAGE_CALLBACK.reset(token)


def get_run_iam_model_usage_callback() -> IamModelUsageCallback | None:
    """Return the current run's callback without exposing it to graph state."""
    return _RUN_MODEL_USAGE_CALLBACK.get()


def _read_usage(response: Any) -> tuple[int | None, int | None, bool]:
    candidates: list[Any] = []
    llm_output = getattr(response, "llm_output", None)
    if isinstance(llm_output, Mapping):
        candidates.extend((llm_output.get("token_usage"), llm_output.get("usage"), llm_output))
    for group in getattr(response, "generations", ()) or ():
        for generation in group or ():
            message = getattr(generation, "message", None)
            usage = getattr(message, "usage_metadata", None)
            if isinstance(usage, Mapping):
                candidates.append(usage)

    input_tokens = output_tokens = None
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            continue
        if input_tokens is None:
            input_tokens = _first_count(candidate, "input_tokens", "prompt_tokens", "prompt_token_count")
        if output_tokens is None:
            output_tokens = _first_count(candidate, "output_tokens", "completion_tokens", "completion_token_count")
        if input_tokens is not None and output_tokens is not None:
            break
    return input_tokens, output_tokens, False


def _estimate_output_tokens(response: Any) -> int:
    chunks: list[str] = []
    for group in getattr(response, "generations", ()) or ():
        for generation in group or ():
            message = getattr(generation, "message", None)
            if message is not None:
                chunks.append(_extract_text(getattr(message, "content", None)))
            else:
                chunks.append(_extract_text(getattr(generation, "text", None)))
    return _estimate_tokens(chunks)


def _estimate_tokens(payload: Any) -> int:
    text, modality_units = _collect_content(payload)
    cjk_chars = len(_CJK_RE.findall(text))
    other_chars = max(0, len(text) - cjk_chars)
    # A deliberately conservative, provider-independent estimate. It is used
    # only when the Provider omitted usage metadata and is marked as estimated.
    estimate = math.ceil(cjk_chars * 1.0 + other_chars / 3.0 + modality_units * 1024)
    return min(_MAX_TOKENS, estimate)


def _collect_content(value: Any) -> tuple[str, int]:
    if isinstance(value, str):
        return value, 0
    if isinstance(value, Mapping):
        kind = value.get("type")
        if isinstance(kind, str) and kind.lower() in {"image", "image_url", "input_image", "audio", "input_audio", "video"}:
            return "", 1
        text = value.get("text")
        if isinstance(text, str):
            return text, 0
        chunks: list[str] = []
        units = 0
        for key, item in value.items():
            if key in {"url", "image_url", "data", "bytes", "token", "access_token"}:
                continue
            child_text, child_units = _collect_content(item)
            chunks.append(child_text)
            units += child_units
        return " ".join(chunks), units
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        chunks = []
        units = 0
        for item in value:
            child_text, child_units = _collect_content(item)
            chunks.append(child_text)
            units += child_units
        return " ".join(chunks), units
    content = getattr(value, "content", None)
    if content is not None and content is not value:
        return _collect_content(content)
    return "", 0


def _extract_text(value: Any) -> str:
    return _collect_content(value)[0]


def _first_count(source: Mapping[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= _MAX_TOKENS:
            return value
    return None


def _bounded_tokens(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return min(_MAX_TOKENS, value)


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a UUID")
    try:
        return str(UUID(value))
    except (ValueError, AttributeError):
        raise ValueError(f"{label} must be a UUID") from None


def _safe_run_suffix(run_id: Any) -> str:
    try:
        return UUID(str(run_id)).hex
    except (ValueError, AttributeError):
        return uuid4().hex
