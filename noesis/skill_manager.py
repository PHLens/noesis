from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


RUNTIME_SKILL_DIRS = {
    "codex": Path(".codex") / "skills",
    "claude": Path(".claude") / "skills",
}


class SkillManagerError(Exception):
    pass


@dataclass(frozen=True)
class Target:
    scope: str
    kind: str
    root: Path
    resolver: str
    agent_id: Optional[str] = None

    def to_json(self):
        data = {
            "scope": self.scope,
            "kind": self.kind,
            "root": str(self.root),
            "resolver": self.resolver,
        }
        if self.agent_id:
            data["agent_id"] = self.agent_id
        return data


def run_skill_command(args):
    command = args.skill_command
    target = resolve_target(args)

    if command == "list":
        result = list_skills(target)
        return emit(result, format_list(result), args.json)

    if command == "inspect":
        result = inspect_skill(target, args.name, source_arg=args.source)
        return emit(result, format_inspect(result), args.json)

    if command == "verify":
        result = verify_skills(target, name=args.name, source_arg=args.source)
        return emit(result, format_verify(result), args.json, exit_code=0 if result["status"] == "ok" else 1)

    if command == "add":
        result = add_skill(target, args.name, source_arg=args.source, alias=args.alias)
        return emit(result, format_add(result), args.json)

    if command == "remove":
        result = remove_skill(target, args.name)
        return emit(result, format_remove(result), args.json)

    raise SkillManagerError(f"unknown skill command: {command}")


def emit(data, human_text, json_output, exit_code=0):
    if json_output:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        print(human_text)
    return exit_code


def resolve_target(args):
    selected = [bool(args.workspace), bool(args.agent_id), bool(args.global_scope)]
    if sum(selected) > 1:
        raise SkillManagerError("--workspace, --agent-id, and --global are mutually exclusive")

    if args.global_scope:
        root = user_home()
        return Target(scope="global", kind="global", root=root, resolver="home")

    if args.agent_id:
        root = resolve_agent_root(args.agent_id)
        require_directory(root, f"pamem root for agent {args.agent_id}")
        return Target(scope="workspace", kind="agent-home", root=root, resolver="pamem-status", agent_id=args.agent_id)

    if args.workspace:
        root = expand_path(args.workspace)
        require_directory(root, "workspace")
        return Target(scope="workspace", kind="workspace", root=root, resolver="explicit-workspace")

    root = Path.cwd().resolve(strict=False)
    require_directory(root, "workspace")
    return Target(scope="workspace", kind="workspace", root=root, resolver="cwd")


def resolve_agent_root(agent_id):
    command = ["pamem", "status", "--agent-id", agent_id, "--json"]
    try:
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError as exc:
        raise SkillManagerError("pamem executable not found; --agent-id requires pamem on PATH") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        suffix = f": {detail}" if detail else ""
        raise SkillManagerError(f"pamem status failed for agent {agent_id}{suffix}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SkillManagerError(f"pamem status returned invalid JSON for agent {agent_id}: {exc}") from exc

    root = data.get("root")
    if not isinstance(root, str) or not root.strip():
        raise SkillManagerError(f"pamem status JSON did not include root for agent {agent_id}")
    return expand_path(root)


def list_skills(target):
    names = visible_skill_names(target)
    skills = [skill_record(target, name) for name in sorted(names)]
    return {
        "command": "skill list",
        "target": target.to_json(),
        "skill_dirs": skill_dirs_json(target),
        "skills": skills,
    }


def inspect_skill(target, name, source_arg=None):
    require_link_name(name, "skill name")
    source = source_report(name, source_arg)
    expected_source = Path(source["path"]) if source["status"] == "ok" else None
    record = skill_record(target, name, expected_source=expected_source)
    if source["status"] != "ok" and record["status"] == "ok":
        record["status"] = "source-unresolved"
    return {
        "command": "skill inspect",
        "target": target.to_json(),
        "skill_dirs": skill_dirs_json(target),
        "source": source,
        "skill": record,
    }


def verify_skills(target, name=None, source_arg=None):
    if name:
        require_link_name(name, "skill name")
        inspected = inspect_skill(target, name, source_arg=source_arg)
        skill = inspected["skill"]
        failures = []
        if inspected["source"]["status"] != "ok":
            failures.append({"name": name, "reason": inspected["source"]["status"], "detail": inspected["source"].get("error")})
        if skill["status"] != "ok":
            failures.append({"name": name, "reason": skill["status"]})
        status = "ok" if not failures else "failed"
        return {
            "command": "skill verify",
            "status": status,
            "target": inspected["target"],
            "skill_dirs": inspected["skill_dirs"],
            "source": inspected["source"],
            "skills": [skill],
            "failures": failures,
        }

    listed = list_skills(target)
    failures = [
        {"name": skill["name"], "reason": skill["status"]}
        for skill in listed["skills"]
        if skill["status"] != "ok"
    ]
    return {
        "command": "skill verify",
        "status": "ok" if not failures else "failed",
        "target": listed["target"],
        "skill_dirs": listed["skill_dirs"],
        "skills": listed["skills"],
        "failures": failures,
    }


def add_skill(target, name, source_arg=None, alias=None):
    require_link_name(name, "skill name")
    source = resolve_source(name, source_arg=source_arg)
    validate_source(source)
    link_name = alias or source.name
    require_link_name(link_name, "skill alias")
    links = {runtime: skill_dir / link_name for runtime, skill_dir in target_skill_dirs(target).items()}

    problems = []
    for runtime, link in links.items():
        if not lexists(link):
            continue
        if not link.is_symlink():
            problems.append(f"{runtime}: non-symlink already exists at {link}")
            continue
        if not same_path(link.resolve(strict=False), source):
            problems.append(f"{runtime}: symlink already points to {os.readlink(link)} at {link}")
    if problems:
        raise SkillManagerError("cannot add skill because target paths are occupied: " + "; ".join(problems))

    actions = []
    for runtime, link in links.items():
        skill_dir = link.parent
        skill_dir.mkdir(parents=True, exist_ok=True)
        if lexists(link):
            actions.append({"runtime": runtime, "path": str(link), "action": "already-present"})
            continue
        relative_target = os.path.relpath(source, skill_dir)
        os.symlink(relative_target, link)
        if not same_path(link.resolve(strict=False), source):
            raise SkillManagerError(f"created symlink did not resolve to expected source: {link}")
        actions.append({"runtime": runtime, "path": str(link), "action": "created", "target": relative_target})

    inspected = inspect_skill(target, link_name, source_arg=str(source))
    if inspected["skill"]["status"] != "ok":
        raise SkillManagerError(f"skill was added but verification failed with status {inspected['skill']['status']}")

    return {
        "command": "skill add",
        "target": target.to_json(),
        "skill_dirs": skill_dirs_json(target),
        "source": inspected["source"],
        "skill": inspected["skill"],
        "actions": actions,
    }


def remove_skill(target, name):
    require_link_name(name, "skill name")
    links = {runtime: skill_dir / name for runtime, skill_dir in target_skill_dirs(target).items()}
    problems = []
    for runtime, link in links.items():
        if lexists(link) and not link.is_symlink():
            problems.append(f"{runtime}: non-symlink exists at {link}")
    if problems:
        raise SkillManagerError("refusing to remove non-symlink paths: " + "; ".join(problems))

    actions = []
    for runtime, link in links.items():
        if link.is_symlink():
            target_text = os.readlink(link)
            link.unlink()
            actions.append({"runtime": runtime, "path": str(link), "action": "removed", "target": target_text})
        else:
            actions.append({"runtime": runtime, "path": str(link), "action": "missing"})

    inspected = inspect_skill(target, name)
    return {
        "command": "skill remove",
        "target": target.to_json(),
        "skill_dirs": skill_dirs_json(target),
        "skill": inspected["skill"],
        "actions": actions,
    }


def skill_record(target, name, expected_source=None):
    runtimes = {
        runtime: link_info(skill_dir / name, expected_source=expected_source)
        for runtime, skill_dir in target_skill_dirs(target).items()
    }
    return {
        "name": name,
        "status": aggregate_status(runtimes),
        "runtimes": runtimes,
    }


def visible_skill_names(target):
    names = set()
    for skill_dir in target_skill_dirs(target).values():
        if not skill_dir.is_dir():
            continue
        for child in skill_dir.iterdir():
            names.add(child.name)
    return names


def target_skill_dirs(target):
    return {runtime: target.root / relative for runtime, relative in RUNTIME_SKILL_DIRS.items()}


def skill_dirs_json(target):
    return {runtime: str(path) for runtime, path in target_skill_dirs(target).items()}


def link_info(path, expected_source=None):
    data = {
        "path": str(path),
        "status": "missing",
        "kind": "missing",
        "target": None,
        "resolved": None,
        "matches_source": None,
        "relative_target": None,
    }

    if not lexists(path):
        data["matches_source"] = expected_source is None
        return data

    if not path.is_symlink():
        data["status"] = "conflict"
        data["kind"] = "directory" if path.is_dir() else "file"
        data["matches_source"] = False
        return data

    target_text = os.readlink(path)
    resolved = path.resolve(strict=False)
    data.update(
        {
            "kind": "symlink",
            "target": target_text,
            "resolved": str(resolved),
            "relative_target": not os.path.isabs(target_text),
        }
    )

    if expected_source is not None:
        data["matches_source"] = same_path(resolved, expected_source)
    else:
        data["matches_source"] = None

    if not resolved.exists():
        data["status"] = "broken"
    elif not resolved.is_dir() or not (resolved / "SKILL.md").is_file():
        data["status"] = "invalid-source"
    elif expected_source is not None and not same_path(resolved, expected_source):
        data["status"] = "mismatch"
    else:
        data["status"] = "ok"
    return data


def aggregate_status(runtimes):
    statuses = [info["status"] for info in runtimes.values()]
    if all(status == "missing" for status in statuses):
        return "missing"
    for status in ("conflict", "broken", "invalid-source", "mismatch"):
        if status in statuses:
            return status
    if "missing" in statuses:
        return "mismatch"
    resolved = {
        info["resolved"]
        for info in runtimes.values()
        if info["status"] == "ok" and isinstance(info.get("resolved"), str)
    }
    if len(resolved) > 1:
        return "mismatch"
    if all(status == "ok" for status in statuses):
        return "ok"
    return "unknown"


def source_report(name, source_arg=None):
    try:
        source = resolve_source(name, source_arg=source_arg)
        has_skill_md = (source / "SKILL.md").is_file()
        return {
            "status": "ok" if has_skill_md else "invalid-source",
            "path": str(source),
            "skill_md": str(source / "SKILL.md"),
            "has_skill_md": has_skill_md,
            **({} if has_skill_md else {"error": f"missing SKILL.md at {source / 'SKILL.md'}"}),
        }
    except SkillManagerError as exc:
        return {
            "status": "unresolved",
            "path": None,
            "skill_md": None,
            "has_skill_md": False,
            "error": str(exc),
        }


def resolve_source(name, source_arg=None):
    skills_root = user_skills_root()
    if source_arg:
        source = expand_path(source_arg)
        if not is_relative_to(source, skills_root):
            raise SkillManagerError(f"explicit source must be under {skills_root}: {source}")
        if not source.is_dir():
            raise SkillManagerError(f"skill source directory not found: {source}")
        return source

    require_link_name(name, "skill name")

    if not skills_root.is_dir():
        raise SkillManagerError(f"skill source root not found: {skills_root}")

    matches = sorted(
        {path.resolve(strict=False) for path in skills_root.rglob(name) if path.is_dir() and path.name == name},
        key=lambda path: str(path),
    )
    if not matches:
        raise SkillManagerError(f"skill source not found under {skills_root}: {name}")
    if len(matches) > 1:
        joined = ", ".join(str(path) for path in matches)
        raise SkillManagerError(f"multiple skill sources named {name}; pass --source explicitly: {joined}")
    return matches[0]


def validate_source(source):
    if not source.is_dir():
        raise SkillManagerError(f"skill source directory not found: {source}")
    skill_md = source / "SKILL.md"
    if not skill_md.is_file():
        raise SkillManagerError(f"skill source is missing SKILL.md: {skill_md}")


def require_link_name(name, label):
    if not isinstance(name, str) or not name.strip():
        raise SkillManagerError(f"{label} must be a non-empty basename")
    candidate = Path(name)
    if candidate.name != name or candidate.is_absolute() or name in {".", ".."}:
        raise SkillManagerError(f"{label} must be a basename without path separators: {name}")


def format_list(result):
    lines = target_header(result)
    if not result["skills"]:
        lines.append("No visible skills.")
        return "\n".join(lines)
    for skill in result["skills"]:
        lines.append(format_skill_summary(skill))
    return "\n".join(lines)


def format_inspect(result):
    lines = target_header(result)
    source = result["source"]
    if source["status"] == "ok":
        lines.append(f"Source: {source['path']}")
    else:
        lines.append(f"Source: {source['status']} ({source.get('error')})")
    lines.append(format_skill_summary(result["skill"], include_links=True))
    return "\n".join(lines)


def format_verify(result):
    lines = target_header(result)
    if result["status"] == "ok":
        lines.append("Verification: ok")
    else:
        lines.append("Verification: failed")
        for failure in result["failures"]:
            detail = f" - {failure.get('detail')}" if failure.get("detail") else ""
            lines.append(f"  {failure['name']}: {failure['reason']}{detail}")
    for skill in result["skills"]:
        lines.append(format_skill_summary(skill))
    return "\n".join(lines)


def format_add(result):
    lines = target_header(result)
    lines.append(f"Added skill: {result['skill']['name']}")
    lines.append(f"Source: {result['source']['path']}")
    for action in result["actions"]:
        target = f" -> {action['target']}" if "target" in action else ""
        lines.append(f"  {action['runtime']}: {action['action']} {action['path']}{target}")
    return "\n".join(lines)


def format_remove(result):
    lines = target_header(result)
    lines.append(f"Removed skill visibility: {result['skill']['name']}")
    for action in result["actions"]:
        lines.append(f"  {action['runtime']}: {action['action']} {action['path']}")
    return "\n".join(lines)


def target_header(result):
    target = result["target"]
    lines = [f"Target: {target['scope']} {target['root']} ({target['resolver']})"]
    lines.append("Skill dirs:")
    for runtime, path in result["skill_dirs"].items():
        lines.append(f"  {runtime}: {path}")
    return lines


def format_skill_summary(skill, include_links=False):
    lines = [f"{skill['name']}: {skill['status']}"]
    if include_links:
        for runtime, info in skill["runtimes"].items():
            target = f" -> {info['target']}" if info["target"] else ""
            resolved = f" ({info['resolved']})" if info["resolved"] else ""
            lines.append(f"  {runtime}: {info['status']} {info['path']}{target}{resolved}")
    return "\n".join(lines)


def expand_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve(strict=False)


def user_home():
    return Path(os.path.expanduser("~")).resolve(strict=False)


def user_skills_root():
    return user_home() / "skills"


def require_directory(path, label):
    if not path.exists():
        raise SkillManagerError(f"{label} does not exist: {path}")
    if not path.is_dir():
        raise SkillManagerError(f"{label} is not a directory: {path}")


def lexists(path):
    return os.path.lexists(path)


def same_path(first, second):
    return os.path.normcase(str(Path(first).resolve(strict=False))) == os.path.normcase(
        str(Path(second).resolve(strict=False))
    )


def is_relative_to(path, parent):
    try:
        Path(path).resolve(strict=False).relative_to(Path(parent).resolve(strict=False))
        return True
    except ValueError:
        return False
