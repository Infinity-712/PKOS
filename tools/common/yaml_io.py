from __future__ import annotations

from dataclasses import dataclass
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
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
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
            node: dict[str, Any] = {}
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
            next_non_empty = None
            j = i
            while j < len(lines):
                cand = lines[j]
                if cand.strip() and not cand.lstrip().startswith("#"):
                    next_non_empty = cand
                    break
                j += 1

            if next_non_empty is not None:
                next_indent = len(next_non_empty) - len(next_non_empty.lstrip(" "))
                next_line = next_non_empty.strip()
                if next_indent > indent and next_line.startswith("- "):
                    container[key] = []
                elif next_indent > indent:
                    container[key] = {}
                else:
                    container[key] = ""
            else:
                container[key] = ""

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
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    if s == "" or any(ch in s for ch in [":", "#", "[", "]", "{", "}"]):
        return f'"{s}"'
    return s


def _dump_yaml(value: Any, indent: int = 0) -> list[str]:
    lines: list[str] = []
    space = " " * indent

    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{space}{k}:")
                lines.extend(_dump_yaml(v, indent + 2))
            else:
                lines.append(f"{space}{k}: {_dump_scalar(v)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
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


def save_yaml(path: Path, data: dict[str, Any]) -> list[DataIssue]:
    try:
        lines = _dump_yaml(data)
        payload = "\n".join(lines) + "\n"
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
