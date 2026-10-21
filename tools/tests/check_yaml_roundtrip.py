from __future__ import annotations

import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.common.yaml_io import load_yaml, parse_yaml_text, save_yaml


class YamlRoundtripTests(unittest.TestCase):
    def assert_same_value(self, actual, expected):
        self.assertIs(type(actual), type(expected))
        if isinstance(expected, dict):
            self.assertEqual(actual.keys(), expected.keys())
            for key in expected:
                self.assert_same_value(actual[key], expected[key])
        elif isinstance(expected, list):
            self.assertEqual(len(actual), len(expected))
            for left, right in zip(actual, expected):
                self.assert_same_value(left, right)
        else:
            self.assertEqual(actual, expected)
            if isinstance(expected, float) and expected == 0:
                self.assertEqual(math.copysign(1, actual), math.copysign(1, expected))

    def roundtrip(self, data):
        with tempfile.TemporaryDirectory(prefix="pkos-yaml-roundtrip-") as temp:
            path = Path(temp) / "object.yaml"
            self.assertEqual(save_yaml(path, data), [])
            actual, issues = load_yaml(path)
            self.assertEqual(issues, [])
            self.assert_same_value(actual, data)

    def test_strings(self):
        values = [
            "", "00123", "-01", "+12", "1.25", "1e3", "1.0e3", "'quoted'",
            '"quoted"', "'", '"', "null", "~", "true", "False", "[]", "{}",
            " leading", "trailing ", "key: value", "# comment", "-", "- item",
            "a\\b", "a\tb", "a\x00b", "first\nsecond\n", "first\r\nsecond",
            "a\x85b", "a\u2028b", "a\u2029b", "\u4e2d\u6587", "ordinary",
        ]
        for value in values:
            with self.subTest(value=value):
                self.roundtrip({"value": value, "items": [value]})

    def test_scalar_types(self):
        for value in [None, True, False, 0, -42, 10**40, 1.25, -0.0, 1e20, 1e-20]:
            with self.subTest(value=value):
                self.roundtrip({"value": value, "items": [value]})

    def test_empty_containers(self):
        for data in [{}, {"list": []}, {"map": {}}, {"items": [[], {}, "", None]}]:
            with self.subTest(data=data):
                self.roundtrip(data)

    def test_nested_lists_and_mappings(self):
        self.roundtrip({"items": [
            {"source": "manual", "nested": [{"code": "00123", "empty": []}]},
            [1, {"value": "'quoted'", "other": {}}, [True, None]],
        ], "last": "retained"})

    def test_legacy_parse_compatibility(self):
        text = (
            "# old object\nid: fact.example\nempty:\nnumber: 12\n"
            "literal: 'hello'\nflag: True\nnull_value: ~\n"
            "sources:\n  - name: manual\n    url: https://example.invalid\n"
            "list: []\nmap: {}\n"
        )
        self.assert_same_value(parse_yaml_text(text), {
            "id": "fact.example", "empty": "", "number": 12, "literal": "hello",
            "flag": True, "null_value": None,
            "sources": [{"name": "manual", "url": "https://example.invalid"}],
            "list": [], "map": {},
        })

    def test_title_only_rewrite_preserves_unknown_fields(self):
        original = parse_yaml_text(
            'title: Original\ncustom_code: "00123"\ncustom_empty: []\n'
            'custom_quote: "\'quoted\'"\ncustom_mapping:\n  - keep: important\n'
        )
        original["title"] = "Changed title"
        self.roundtrip(original)

    def test_unsupported_values_do_not_mutate_filesystem(self):
        values = [
            {"value": (1, 2)}, {"value": {1, 2}}, {"value": b"bytes"},
            {"value": float("nan")}, {"value": float("inf")},
            {1: "integer key"}, {"bad:key": "ambiguous key"},
            {"bad\nkey": "multiline key"}, ["non-mapping root"],
        ]
        for data in values:
            with self.subTest(data=data), tempfile.TemporaryDirectory(prefix="pkos-yaml-reject-") as temp:
                root = Path(temp)
                existing = root / "existing.yaml"
                self.assertEqual(save_yaml(existing, {"keep": "unchanged"}), [])
                before = existing.read_bytes()
                for target in [existing, root / "absent" / "new.yaml"]:
                    self.assertTrue(save_yaml(target, data))
                self.assertEqual(existing.read_bytes(), before)
                self.assertEqual(list(root.iterdir()), [existing])

    def test_roundtrip_guard_precedes_replace(self):
        with tempfile.TemporaryDirectory(prefix="pkos-yaml-guard-") as temp:
            path = Path(temp) / "object.yaml"
            self.assertEqual(save_yaml(path, {"keep": "unchanged"}), [])
            before = path.read_bytes()
            for expected, emitted in [("00123", "123"), (True, "1"), (1, "1.0"), ([], '""')]:
                with self.subTest(expected=expected), patch(
                    "tools.common.yaml_io._dump_yaml", return_value=[f"value: {emitted}"]
                ):
                    self.assertTrue(save_yaml(path, {"value": expected}))
                self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
