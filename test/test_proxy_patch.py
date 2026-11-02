"""Offline patch fixtures; run with Python 3.10+ and the standard unittest runner."""
import ast
import contextlib
import importlib.util
import io
import pathlib
import runpy
import tempfile
import types
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "patch_proxy.py"
TREE = ast.parse(SCRIPT.read_text(encoding="utf-8"))
FIXES = ast.literal_eval(next(node.value for node in TREE.body if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == "FIXES" for target in node.targets)))


class ProxyPatchTests(unittest.TestCase):
    def fixture(self, root):
        (root / "__init__.py").touch()
        for name, fixes in FIXES.items():
            (root / name).write_text("\n".join(old for old, _ in fixes), encoding="utf-8")

    def apply(self, root):
        original = importlib.util.find_spec
        def find_spec(name, *args, **kwargs):
            if name == "comfy_api_proxy":
                return types.SimpleNamespace(origin=str(root / "__init__.py"))
            return original(name, *args, **kwargs)
        with mock.patch.object(importlib.util, "find_spec", side_effect=find_spec), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(SCRIPT))

    def test_unsupported_second_file_preserves_every_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            (root / "realtime.py").write_text("incompatible version\n", encoding="utf-8")
            before = {name: (root / name).read_bytes() for name in FIXES}
            with self.assertRaises(SystemExit):
                self.apply(root)
            self.assertEqual({name: (root / name).read_bytes() for name in FIXES}, before)

    def test_supported_patch_is_complete_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            self.apply(root)
            for name, fixes in FIXES.items():
                for _, replacement in fixes:
                    self.assertIn(replacement, (root / name).read_text(encoding="utf-8"))
            first = {name: (root / name).read_bytes() for name in FIXES}
            self.apply(root)
            self.assertEqual({name: (root / name).read_bytes() for name in FIXES}, first)


if __name__ == "__main__":
    unittest.main()
