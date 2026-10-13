### Readability article extraction (`readability.py`)

When Readability.js is unavailable or fails, keep article/main markup for the Python fallback so useful anchor and image destinations survive Markdown conversion. Strip active/embed/form/navigation content and unsafe URL schemes before returning fallback HTML. Keep fetched-page URL resolution ahead of extraction so relative destinations use the document URL or its first valid `<base href>`. Regressions live in `tests/test_web_fetch_relative_links.py`; run them with pytest temp output outside the repository and remove that temp directory afterward.

### Agent / Tool Assembly Off-Load

Tool and agent assembly re-enters `get_available_tools()` and may block on MCP discovery, so the four async assembly entry points — `run_agent`'s `agent_factory` call, `task_tool`, durable batch `_execute_item`, and `abuild_checkpoint_state_accessor` — dispatch through `deerflow.utils.assembly_io.run_assembly`, a dedicated ContextVar-preserving bounded executor (`DEER_FLOW_ASSEMBLY_WORKERS`, default 8) rather than the loop's default executor; a hung MCP server therefore parks an assembly worker instead of queueing unrelated default-executor work, and the pool logs a warning when pending assemblies exceed the worker count. `tests/blocking_io/test_tool_assembly_offloop.py` pins all four offloads plus the ContextVar propagation.
