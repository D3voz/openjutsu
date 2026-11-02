"""Fix live progress in comfy-api-proxy 0.1.6. start_openjutsu.bat runs this after installing the proxy.

The proxy throttles progress frames across nodes, so the next node's start is always dropped and the
page sits on the last node. It also sends a node's files only when the whole job ends, so mask previews
never arrive mid-run. Drop this once a proxy release fixes both.
"""
import importlib.util
import pathlib
import sys

FIXES = {
    "app.py": [
        (
            """\
        bridge = JobEventBridge(
            self.comfyui, job_id, client_id=client_id, snapshot=snapshot, session=self.session
        )
""",
            """\
        bridge = JobEventBridge(
            self.comfyui,
            job_id,
            client_id=client_id,
            snapshot=snapshot,
            node_outputs=lambda node_id, output: self._outputs(job_id, {"outputs": {node_id: output}}, base),
            session=self.session,
        )
""",
        ),
    ],
    "realtime.py": [
        (
            """\
StatusSnapshotFn = Callable[[], Awaitable[dict[str, Any]]]
""",
            """\
StatusSnapshotFn = Callable[[], Awaitable[dict[str, Any]]]
NodeOutputsFn = Callable[[str, dict[str, Any]], list[dict[str, Any]]]
""",
        ),
        (
            """\
        snapshot: StatusSnapshotFn,
        session: aiohttp.ClientSession,
""",
            """\
        snapshot: StatusSnapshotFn,
        node_outputs: NodeOutputsFn,
        session: aiohttp.ClientSession,
""",
        ),
        (
            """\
        self._snapshot = snapshot
        self._session = session
        self._last_progress_emit = 0.0
""",
            """\
        self._snapshot = snapshot
        self._node_outputs = node_outputs
        self._session = session
        self._last_progress_emit = 0.0
        self._last_progress_node: str | None = None
""",
        ),
        (
            """\
                    if self._is_executed_text(msg.data):
                        for frame in await self._reconcile_outputs(seen_outputs):
""",
            """\
                    if self._is_executed_text(msg.data):
                        # /history only lists a prompt's outputs once it has
                        # finished, so surface this node's files from the frame.
                        data = json.loads(msg.data)["data"]
                        live = self._node_outputs(str(data["node"]), data.get("output") or {})
                        for frame in self._final_outputs({"outputs": live}, seen_outputs):
                            yield frame
                        for frame in await self._reconcile_outputs(seen_outputs):
""",
        ),
        (
            """\
            now = time.monotonic()
            if now - self._last_progress_emit < _THROTTLE_SECONDS:
                return []
            self._last_progress_emit = now
            return [sse_frame("progress", self._translate_progress(mtype, data))]
""",
            """\
            progress = self._translate_progress(mtype, data)
            now = time.monotonic()
            # Throttle step updates of one node only: ComfyUI sends an empty
            # progress_state when a node finishes and the next node's start a
            # few ms later, so throttling across nodes always dropped the start.
            node = progress["current_node"]
            if node == self._last_progress_node and now - self._last_progress_emit < _THROTTLE_SECONDS:
                return []
            self._last_progress_emit = now
            self._last_progress_node = node
            return [sse_frame("progress", progress)]
""",
        ),
    ],
}

package = pathlib.Path(importlib.util.find_spec("comfy_api_proxy").origin).parent
# Validate the entire package before changing either side of the bridge contract.
updates = []
for name, fixes in FIXES.items():
    path = package / name
    text = path.read_text(encoding="utf-8")
    if all(new in text for _, new in fixes):
        continue
    for old, new in fixes:
        if text.count(old) != 1:
            sys.exit(f"Could not fix live progress in {path}. patch_proxy.py is written for comfy-api-proxy 0.1.6.")
        text = text.replace(old, new)
    updates.append((path, text))

for path, text in updates:
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Fixed live progress in {path}")
