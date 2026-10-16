# Backend Tests

Backend tests must preserve the runtime invariants they exercise without changing production execution topology.

## Executor starvation tests

`test_executor_starvation.py` covers the deterministic starvation semantics from RFC #4560:

- default-executor saturation and queueing;
- cancellation of an awaiter while an already-started synchronous worker continues;
- isolation between the asyncio default executor and DeerFlow's dedicated file-I/O executor.

Use explicit synchronization such as `threading.Event` rather than sleep-based timing thresholds for worker lifecycle assertions. Every test must release blocked workers and restore any process-global monkeypatches so teardown cannot leak threads or state into later tests.

Stress/soak testing, AnyIO worker instrumentation, Uvicorn multi-process behavior, and broad production executor redesign are separate concerns and should not be folded into these deterministic regressions.

IAM OIDC token-vault regressions must prove per-session isolation as well as
encryption: separate local `sid` values for one user must retain distinct token
pairs, ciphertext AAD must reject moving an envelope between sessions, generic
serialization/repr must not expose ciphertext, and logout deletion must be
scoped to `(user_id, sid)`. Migration tests must pin the composite key and user
cascade without assuming that a user has only one SSO session.

Central IAM memory-scope regressions must prove that only an exact owner/self
scope for the active subject and tenant reaches storage. Cover read/write/delete
action combinations, missing or broader tenant/org scopes, local owner mismatch,
and the absence of manager calls after denial for both synchronous tools and
middleware hooks. Never place access tokens in serialized runtime context or
memory queue payloads.


For retry scheduling assertions, distinguish injected run-start time from actual I/O completion time. When retries intentionally schedule from failure completion, assert the expected interval within captured start/finish bounds instead of exact equality to run start.