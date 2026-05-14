import argparse
import sys

from noesis.skill_manager import SkillManagerError, run_skill_command


def build_parser():
    parser = argparse.ArgumentParser(
        prog="noesis",
        description="Noesis learning control plane utilities.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    skill = subcommands.add_parser(
        "skill",
        help="Manage agent skill visibility.",
        description="Manage symlink-based skill visibility for agent workspaces.",
    )
    skill_subcommands = skill.add_subparsers(dest="skill_command", required=True)

    target_options = argparse.ArgumentParser(add_help=False)
    target_options.add_argument("--workspace", help="Workspace root to manage. Defaults to the current directory.")
    target_options.add_argument("--agent-id", help="Resolve a pamem agent workspace via 'pamem status --json'.")
    target_options.add_argument(
        "--global",
        action="store_true",
        dest="global_scope",
        help="Manage global ~/.codex/skills and ~/.claude/skills visibility.",
    )
    target_options.add_argument("--json", action="store_true", help="Print machine-readable JSON.")

    skill_subcommands.add_parser("list", parents=[target_options], help="List visible skills.")

    inspect = skill_subcommands.add_parser("inspect", parents=[target_options], help="Inspect one skill.")
    inspect.add_argument("name", help="Skill name or alias.")
    inspect.add_argument("--source", help="Explicit source directory under ~/skills.")

    verify = skill_subcommands.add_parser("verify", parents=[target_options], help="Verify visible skill links.")
    verify.add_argument("name", nargs="?", help="Optional skill name or alias. Omit to verify all visible skills.")
    verify.add_argument("--source", help="Explicit source directory under ~/skills for a named verification.")

    add = skill_subcommands.add_parser("add", parents=[target_options], help="Add a skill to Claude and Codex.")
    add.add_argument("name", help="Skill source basename to resolve under ~/skills.")
    add.add_argument("--source", help="Explicit source directory under ~/skills.")
    add.add_argument("--alias", help="Link name to expose. Defaults to the source directory basename.")

    remove = skill_subcommands.add_parser("remove", parents=[target_options], help="Remove visible skill links.")
    remove.add_argument("name", help="Skill name or alias to remove.")

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "skill":
            return run_skill_command(args)
        parser.error(f"unknown command: {args.command}")
    except SkillManagerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
