from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import tempfile
from typing import Any


@dataclass
class DataIssue:
    path: Path
    field_path: str
    message: str

    def format(self) -> str:
        return f"{self.path.as_posix()} :: {self.field_path} :: {self.message}"


def _parse_scalar(text: str) -> Any:
    v = text.strip()
    if v in {"", "null", "~"}:
        return "" if v == "" else None
    if v in {"true", "True"}:
        return True
    if v in {"false", "False"}:
        return False
    if v == "[]":
        return []
    if v == "{}":
        return {}
    if v.startswith('"') and v.endswith('"'):
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, str) else v[1:-1]
        except Exception:
            return v[1:-1]
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1]
    try:
        if "." in v:
            return float(v)
        return int(v)
    except Exception:
        return v


def _looks_like_inline_mapping(text: str) -> bool:
    if text.startswith(('"', "'")):
        return False
    if ':' not in text:
        return False
    key = text.split(':', 1)[0].strip()
    if not key:
        return False
    for ch in key:
        if not (ch.isalnum() or ch in '._-'):
            return False
    return True


def _nested_container(lines: list[str], start: int, indent: int, default: Any) -> Any:
    for index in range(start, len(lines)):
        raw = lines[index]
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if len(raw) - len(raw.lstrip(" ")) <= indent:
            break
        line = raw.strip()
        return [] if line == "-" or line.startswith("- ") else {}
    return default


def parse_yaml_text(text: str) -> dict[str, Any] | list[Any] | None:
    root: dict[str, Any] = {}
    stack: list[tuple[int, Any]] = [(-1, root)]
    lines = text.splitlines()
    i = 0

    while i < len(lines):
        raw = lines[i]
        i += 1
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue

        indent = len(raw) - len(raw.lstrip(" "))
        if indent % 2 != 0:
            return None
        line = raw.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            return None
        container = stack[-1][1]

        if line == "-":
            if not isinstance(container, list):
                return None
            node = _nested_container(lines, i, indent, {})
            container.append(node)
            stack.append((indent, node))
            continue

        if line.startswith("- "):
            if not isinstance(container, list):
                return None
            remainder = line[2:].strip()
            if _looks_like_inline_mapping(remainder):
                k, v = remainder.split(":", 1)
                k = k.strip()
                v = v.strip()
                node: dict[str, Any] = {}
                if v == "":
                    node[k] = ""
                else:
                    node[k] = _parse_scalar(v)
                container.append(node)
                stack.append((indent, node))
            else:
                container.append(_parse_scalar(remainder))
            continue

        if ":" not in line or not isinstance(container, dict):
            return None

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        if value == "":
            container[key] = _nested_container(lines, i, indent, "")

            if isinstance(container[key], (dict, list)):
                stack.append((indent, container[key]))
        else:
            container[key] = _parse_scalar(value)

    return root


def _dump_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        text = str(value)
        if "e" in text and "." not in text:
            text = text.replace("e", ".0e", 1)
        return text
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)) and not value:
        return "{}" if isinstance(value, dict) else "[]"
    s = str(value)
    unicode_line_break = any(ch in s for ch in "\x85\u2028\u2029")
    if (
        s == ""
        or s.strip() != s
        or _parse_scalar(s) != s
        or s in {"null", "~", "true", "True", "false", "False", "[]", "{}"}
        or any(ch in s for ch in [":", "#", "[", "]", "{", "}", "\n", "\r", '"'])
        or any(ord(ch) < 32 for ch in s)
        or unicode_line_break
    ):
        return json.dumps(s, ensure_ascii=unicode_line_break)
    return s


def _dump_yaml(value: Any, indent: int = 0) -> list[str]:
    lines: list[str] = []
    space = " " * indent

    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{space}{k}:")
                lines.extend(_dump_yaml(v, indent + 2))
            else:
                lines.append(f"{space}{k}: {_dump_scalar(v)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)) and item:
                lines.append(f"{space}-")
                lines.extend(_dump_yaml(item, indent + 2))
            else:
                lines.append(f"{space}- {_dump_scalar(item)}")
    return lines


def load_yaml(path: Path) -> tuple[dict[str, Any] | None, list[DataIssue]]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        return None, [DataIssue(path, "$", f"read failed: {exc}")]

    data = parse_yaml_text(text)
    if not isinstance(data, dict):
        return None, [DataIssue(path, "$", "invalid YAML or unsupported YAML features")]
    return data, []


def _same_yaml_value(expected: Any, actual: Any) -> bool:
    if type(expected) is not type(actual):
        return False
    if isinstance(expected, dict):
        return (
            all(isinstance(key, str) for key in expected)
            and expected.keys() == actual.keys()
            and all(_same_yaml_value(value, actual[key]) for key, value in expected.items())
        )
    if isinstance(expected, list):
        return len(expected) == len(actual) and all(
            _same_yaml_value(left, right) for left, right in zip(expected, actual)
        )
    return expected == actual


def save_yaml(path: Path, data: dict[str, Any]) -> list[DataIssue]:
    try:
        lines = _dump_yaml(data)
        payload = "\n".join(lines) + "\n"
        # Reject unsupported shapes or lossy serialization before any filesystem mutation.
        if not isinstance(data, dict) or not _same_yaml_value(data, parse_yaml_text(payload)):
            return [DataIssue(path, "$", "write failed: YAML round trip would change data or types")]
        path.parent.mkdir(parents=True, exist_ok=True)

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
            tmp.write(payload)
            tmp_name = tmp.name

        os.replace(tmp_name, path)
        return []
    except Exception as exc:
        return [DataIssue(path, "$", f"write failed: {exc}")]


def extract_markdown_frontmatter(path: Path) -> tuple[dict[str, Any] | None, str, list[DataIssue]]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        return None, "", [DataIssue(path, "$", f"read failed: {exc}")]

    if not text.startswith("---\n"):
        return None, text, [DataIssue(path, "frontmatter", "missing YAML frontmatter")]

    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return None, text, [DataIssue(path, "frontmatter", "invalid frontmatter delimiter")]

    fm_data = parse_yaml_text(parts[0][4:])
    if not isinstance(fm_data, dict):
        return None, text, [DataIssue(path, "frontmatter", "invalid frontmatter YAML")]

    return fm_data, parts[1], []
