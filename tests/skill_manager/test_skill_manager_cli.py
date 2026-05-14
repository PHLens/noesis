import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
NOESIS = REPO_ROOT / "bin" / "noesis"


class SkillManagerCliTest(unittest.TestCase):
    def run_noesis(self, *args, cwd, home, env=None, check=True):
        command_env = os.environ.copy()
        command_env["HOME"] = str(home)
        if env:
            command_env.update(env)
        result = subprocess.run(
            [sys.executable, str(NOESIS), *args],
            cwd=cwd,
            env=command_env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"noesis failed with {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        return result

    def make_skill(self, home, name):
        source = home / "skills" / name
        source.mkdir(parents=True)
        (source / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: Test skill.\n---\n\n# {name}\n",
            encoding="utf-8",
        )
        return source

    def test_add_list_inspect_verify_and_remove(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            source = self.make_skill(home, "demo")

            add = self.run_noesis("skill", "add", "demo", "--json", cwd=workspace, home=home)
            add_data = json.loads(add.stdout)
            self.assertEqual(add_data["skill"]["status"], "ok")

            codex_link = workspace / ".codex" / "skills" / "demo"
            claude_link = workspace / ".claude" / "skills" / "demo"
            self.assertTrue(codex_link.is_symlink())
            self.assertTrue(claude_link.is_symlink())
            self.assertFalse(os.path.isabs(os.readlink(codex_link)))
            self.assertEqual(codex_link.resolve(), source.resolve())

            listing = self.run_noesis("skill", "list", "--json", cwd=workspace, home=home)
            list_data = json.loads(listing.stdout)
            self.assertEqual(list_data["skills"][0]["name"], "demo")
            self.assertEqual(list_data["skills"][0]["status"], "ok")

            inspect = self.run_noesis("skill", "inspect", "demo", "--json", cwd=workspace, home=home)
            inspect_data = json.loads(inspect.stdout)
            self.assertEqual(inspect_data["source"]["path"], str(source.resolve()))
            self.assertEqual(inspect_data["skill"]["status"], "ok")

            verify = self.run_noesis("skill", "verify", "demo", "--json", cwd=workspace, home=home)
            self.assertEqual(json.loads(verify.stdout)["status"], "ok")

            remove = self.run_noesis("skill", "remove", "demo", "--json", cwd=workspace, home=home)
            remove_data = json.loads(remove.stdout)
            self.assertEqual(remove_data["skill"]["status"], "missing")
            self.assertFalse(os.path.lexists(codex_link))
            self.assertFalse(os.path.lexists(claude_link))

    def test_add_refuses_non_symlink_conflict_without_partial_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            self.make_skill(home, "demo")
            conflict = workspace / ".codex" / "skills" / "demo"
            conflict.parent.mkdir(parents=True)
            conflict.write_text("not a symlink\n", encoding="utf-8")

            result = self.run_noesis("skill", "add", "demo", cwd=workspace, home=home, check=False)

            self.assertEqual(result.returncode, 1)
            self.assertIn("non-symlink", result.stderr)
            self.assertFalse(os.path.lexists(workspace / ".claude" / "skills" / "demo"))

    def test_add_rejects_path_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            self.make_skill(home, "demo")

            result = self.run_noesis("skill", "add", "demo", "--alias", "../demo", cwd=workspace, home=home, check=False)

            self.assertEqual(result.returncode, 1)
            self.assertIn("basename", result.stderr)
            self.assertFalse(os.path.lexists(workspace / ".codex" / "demo"))

    def test_list_reports_runtime_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            source = self.make_skill(home, "demo")
            codex_dir = workspace / ".codex" / "skills"
            codex_dir.mkdir(parents=True)
            os.symlink(os.path.relpath(source, codex_dir), codex_dir / "demo")

            result = self.run_noesis("skill", "list", "--json", cwd=workspace, home=home)
            data = json.loads(result.stdout)

            self.assertEqual(data["skills"][0]["name"], "demo")
            self.assertEqual(data["skills"][0]["status"], "mismatch")
            self.assertEqual(data["skills"][0]["runtimes"]["claude"]["status"], "missing")

    def test_verify_all_fails_broken_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            codex_dir = workspace / ".codex" / "skills"
            codex_dir.mkdir(parents=True)
            os.symlink("missing-source", codex_dir / "broken")

            result = self.run_noesis("skill", "verify", "--json", cwd=workspace, home=home, check=False)
            data = json.loads(result.stdout)

            self.assertEqual(result.returncode, 1)
            self.assertEqual(data["status"], "failed")
            self.assertEqual(data["failures"][0]["name"], "broken")
            self.assertEqual(data["failures"][0]["reason"], "broken")

    def test_remove_deletes_broken_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "workspace"
            home.mkdir()
            workspace.mkdir()
            for runtime_dir in (workspace / ".codex" / "skills", workspace / ".claude" / "skills"):
                runtime_dir.mkdir(parents=True)
                os.symlink("missing-source", runtime_dir / "demo")

            self.run_noesis("skill", "remove", "demo", cwd=workspace, home=home)

            self.assertFalse(os.path.lexists(workspace / ".codex" / "skills" / "demo"))
            self.assertFalse(os.path.lexists(workspace / ".claude" / "skills" / "demo"))

    def test_agent_id_resolution_uses_pamem_status_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            workspace = root / "agent-home"
            fake_bin = root / "bin"
            home.mkdir()
            workspace.mkdir()
            fake_bin.mkdir()
            pamem = fake_bin / "pamem"
            pamem.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = status ] && [ \"$2\" = --agent-id ] && [ \"$4\" = --json ]; then\n"
                f"  printf '%s\\n' '{{\"status\":\"ok\",\"root\":\"{workspace}\"}}'\n"
                "  exit 0\n"
                "fi\n"
                "echo unexpected pamem args >&2\n"
                "exit 1\n",
                encoding="utf-8",
            )
            pamem.chmod(0o755)
            env = {"PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"}

            result = self.run_noesis("skill", "list", "--agent-id", "agent-1", "--json", cwd=root, home=home, env=env)
            data = json.loads(result.stdout)

            self.assertEqual(data["target"]["resolver"], "pamem-status")
            self.assertEqual(data["target"]["agent_id"], "agent-1")
            self.assertEqual(data["target"]["root"], str(workspace.resolve()))


if __name__ == "__main__":
    unittest.main()
