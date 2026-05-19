import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOESIS = path.join(REPO_ROOT, 'bin', 'noesis');
let counter = 0;


function uniqueName(prefix) {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}


function withTempDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noesis-skill-manager-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}


function makeProjectPamem(t, outputRoot) {
  const binDir = path.join(REPO_ROOT, 'node_modules', '.bin');
  const pamem = path.join(binDir, process.platform === 'win32' ? 'pamem.cmd' : 'pamem');
  fs.mkdirSync(binDir, { recursive: true });
  const previous = fs.existsSync(pamem) ? fs.readFileSync(pamem) : null;
  fs.writeFileSync(
    pamem,
    process.platform === 'win32'
      ? `@echo off\r\necho {"status":"ok","root":"${outputRoot.replaceAll('\\', '\\\\')}","memory_repo":"${path.join(outputRoot, 'memory').replaceAll('\\', '\\\\')}","agent_home":"${outputRoot.replaceAll('\\', '\\\\')}","role":"coder","runtime":"cli"}\r\n`
      : `#!/bin/sh\nprintf '%s\\n' '{"status":"ok","root":"${outputRoot}","memory_repo":"${path.join(outputRoot, 'memory')}","agent_home":"${outputRoot}","role":"coder","runtime":"cli"}'\n`,
  );
  fs.chmodSync(pamem, 0o755);
  t.after(() => {
    if (previous === null) fs.rmSync(pamem, { force: true });
    else fs.writeFileSync(pamem, previous);
  });
}


function makeProjectPamemCommand(t) {
  const binDir = path.join(REPO_ROOT, 'node_modules', '.bin');
  const pamem = path.join(binDir, process.platform === 'win32' ? 'pamem.cmd' : 'pamem');
  fs.mkdirSync(binDir, { recursive: true });
  const previous = fs.existsSync(pamem) ? fs.readFileSync(pamem) : null;
  fs.writeFileSync(
    pamem,
    process.platform === 'win32'
      ? `@echo off\r\nnode "%~dp0\\pamem-fake.mjs" %*\r\n`
      : `#!/bin/sh\nnode "$(dirname "$0")/pamem-fake.mjs" "$@"\n`,
  );
  fs.chmodSync(pamem, 0o755);
  const helper = path.join(binDir, 'pamem-fake.mjs');
  const previousHelper = fs.existsSync(helper) ? fs.readFileSync(helper) : null;
  fs.writeFileSync(
    helper,
    `import fs from 'node:fs';
import path from 'node:path';
const [command, workspace] = process.argv.slice(2);
if (!workspace) process.exit(2);
if (command === 'install') {
  fs.writeFileSync(path.join(workspace, 'pamem-args.json'), JSON.stringify(process.argv.slice(2)) + '\\n');
  fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
  const agentHome = process.argv.includes('--agent-home');
  if (agentHome) {
    fs.writeFileSync(path.join(workspace, 'config.toml'), 'default_profile = "coder"\\n');
    fs.writeFileSync(path.join(workspace, 'current-task.md'), '# Current Task\\n');
    fs.writeFileSync(path.join(workspace, 'work-log.md'), '# Work Log\\n');
  } else {
    fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\\n');
    fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current Task\\n');
    fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work Log\\n');
  }
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\\ncodex_hooks = true\\n');
  fs.writeFileSync(path.join(workspace, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: agentHome ? '/opt/pamem/scripts/memory-session-start.sh' : '.pamem/scripts/memory-session-start.sh' }] }],
    },
  }, null, 2) + '\\n');
  process.exit(0);
}
if (command === 'status') {
  const agentId = process.argv[process.argv.indexOf('--agent-id') + 1];
  const root = process.env.FAKE_PAMEM_AGENT_ROOT;
  if (agentId && root) {
    console.log(JSON.stringify({ status: 'ok', kind: 'agent-home', root }));
    process.exit(0);
  }
}
if (command === 'remove') {
  fs.rmSync(path.join(workspace, '.codex', 'hooks.json'), { force: true });
  process.exit(0);
}
process.exit(2);
`,
  );
  t.after(() => {
    if (previous === null) fs.rmSync(pamem, { force: true });
    else fs.writeFileSync(pamem, previous);
    if (previousHelper === null) fs.rmSync(helper, { force: true });
    else fs.writeFileSync(helper, previousHelper);
  });
}


function makeFakeClaude(t, logFile) {
  const root = withTempDir(t);
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const claude = path.join(binDir, 'claude');
  fs.writeFileSync(
    claude,
    `#!/bin/sh
if [ "$1" = plugin ] && [ "$2" = list ] && [ "$3" = --json ]; then
  printf '%s\\n' "\${FAKE_CLAUDE_PLUGIN_LIST:-[]}"
  exit 0
fi
printf '%s\\n' "$PWD|$*" >> "${logFile}"
`,
  );
  fs.chmodSync(claude, 0o755);
  return binDir;
}


function makeFakeClaudeWithState(t) {
  const root = withTempDir(t);
  const binDir = path.join(root, 'bin');
  const stateFile = path.join(root, 'plugins.json');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(stateFile, '[]\n');
  const claude = path.join(binDir, 'claude');
  fs.writeFileSync(
    claude,
    `#!/bin/sh
node - "$@" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const stateFile = process.env.FAKE_CLAUDE_STATE;
const args = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') {
  console.log(JSON.stringify(entries));
  process.exit(0);
}
if (args[0] === 'plugin' && (args[1] === 'install' || args[1] === 'uninstall')) {
  const key = args[2];
  const scope = args[args.indexOf('-s') + 1] || 'user';
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, process.cwd() + '|' + args.join(' ') + '\\n');
  const existing = entries.find((entry) => entry.id === key && entry.scope === scope && (!entry.projectPath || path.resolve(entry.projectPath) === process.cwd()));
  if (args[1] === 'install') {
    if (existing) existing.enabled = true;
    else entries.push({ id: key, scope, enabled: true, projectPath: scope === 'project' ? process.cwd() : undefined });
  } else if (existing) {
    existing.enabled = false;
  }
  fs.writeFileSync(stateFile, JSON.stringify(entries));
  process.exit(0);
}
process.exit(2);
NODE
`,
  );
  fs.chmodSync(claude, 0o755);
  return { binDir, stateFile };
}


function runNoesis(args, { cwd, home, env = {}, check = true }) {
  const result = spawnSync(process.execPath, [NOESIS, ...args], {
    cwd,
    env: { ...process.env, HOME: home, ...env },
    encoding: 'utf8',
  });
  if (check && result.status !== 0) {
    assert.fail(`noesis failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}


function makeSkill(home, name) {
  const source = path.join(home, 'skills', name);
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill.\n---\n\n# ${name}\n`,
  );
  return source;
}


function makeManagedSkill(t, name) {
  const source = path.join(REPO_ROOT, 'skills', name);
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Managed test skill.\n---\n\n# ${name}\n`,
  );
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  return source;
}


test('top-level help, version, and command help do not touch the workspace', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const top = runNoesis(['--help'], { cwd: workspace, home });
  assert.match(top.stdout, /Usage: noesis <command> \[args\]/);
  assert.match(top.stdout, /noesis help skill add/);

  const skill = runNoesis(['help', 'skill'], { cwd: workspace, home });
  assert.match(skill.stdout, /Usage: noesis skill <command> \[args\]/);
  assert.match(skill.stdout, /Use "noesis skill <command> --help"/);

  const add = runNoesis(['skill', 'add', '--help'], { cwd: workspace, home });
  assert.match(add.stdout, /Usage: noesis skill add <name>/);
  assert.match(add.stdout, /--alias <name>/);

  const verify = runNoesis(['help', 'skill', 'verify'], { cwd: workspace, home });
  assert.match(verify.stdout, /Exits 0 when verification passes/);

  const version = runNoesis(['--version'], { cwd: workspace, home });
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  assert.equal(fs.existsSync(path.join(workspace, '.codex')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.claude')), false);
});


test('add, list, inspect, verify, and remove external skill', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('external-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const source = makeSkill(home, name);

  const add = runNoesis(['skill', 'add', name, '--json'], { cwd: workspace, home });
  const addData = JSON.parse(add.stdout);
  assert.equal(addData.skill.status, 'ok');
  assert.equal(addData.source.kind, 'external');
  assert.equal(addData.source.source_kind, 'external');

  const codexLink = path.join(workspace, '.codex', 'skills', name);
  const claudeLink = path.join(workspace, '.claude', 'skills', name);
  assert.equal(fs.lstatSync(codexLink).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(claudeLink).isSymbolicLink(), true);
  assert.equal(path.isAbsolute(fs.readlinkSync(codexLink)), false);
  assert.equal(fs.realpathSync(codexLink), fs.realpathSync(source));

  const listing = runNoesis(['skill', 'list', '--json'], { cwd: workspace, home });
  const listData = JSON.parse(listing.stdout);
  assert.equal(listData.skills[0].name, name);
  assert.equal(listData.skills[0].status, 'ok');

  const inspect = runNoesis(['skill', 'inspect', name, '--json'], { cwd: workspace, home });
  const inspectData = JSON.parse(inspect.stdout);
  assert.equal(inspectData.source.path, fs.realpathSync(source));
  assert.equal(inspectData.source.root, path.join(home, 'skills'));
  assert.equal(inspectData.skill.type, 'symlink-skill');
  assert.equal(inspectData.skill.status, 'ok');

  const verify = runNoesis(['skill', 'verify', name, '--json'], { cwd: workspace, home });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');

  const remove = runNoesis(['skill', 'remove', name, '--json'], { cwd: workspace, home });
  const removeData = JSON.parse(remove.stdout);
  assert.equal(removeData.skill.status, 'missing');
  assert.equal(fs.existsSync(codexLink), false);
  assert.equal(fs.existsSync(claudeLink), false);
});


test('add refuses non-symlink conflict without partial changes', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('conflict-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  makeSkill(home, name);
  const conflict = path.join(workspace, '.codex', 'skills', name);
  fs.mkdirSync(path.dirname(conflict), { recursive: true });
  fs.writeFileSync(conflict, 'not a symlink\n');

  const result = runNoesis(['skill', 'add', name], { cwd: workspace, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-symlink/);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'skills', name)), false);
});


test('add rejects path alias', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('alias-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  makeSkill(home, name);

  const result = runNoesis(['skill', 'add', name, '--alias', '../demo'], { cwd: workspace, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /basename/);
  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'demo')), false);
});


test('add repairs mismatched symlinks', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('repair-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const source = makeSkill(home, name);
  const wrongSource = makeSkill(home, `${name}-wrong`);
  for (const runtimeDir of [path.join(workspace, '.codex', 'skills'), path.join(workspace, '.claude', 'skills')]) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.symlinkSync(path.relative(runtimeDir, wrongSource), path.join(runtimeDir, name));
  }

  const add = runNoesis(['skill', 'add', name, '--json'], { cwd: workspace, home });
  const data = JSON.parse(add.stdout);

  assert.equal(data.skill.status, 'ok');
  assert.equal(data.actions.every((action) => action.action === 'repaired'), true);
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', name)), fs.realpathSync(source));
  assert.equal(fs.realpathSync(path.join(workspace, '.claude', 'skills', name)), fs.realpathSync(source));
});


test('managed repo skill source is preferred over external compatibility source', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('managed-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const managedSource = makeManagedSkill(t, name);
  makeSkill(home, name);

  const add = runNoesis(['skill', 'add', name, '--json'], { cwd: workspace, home });
  const addData = JSON.parse(add.stdout);

  assert.equal(addData.source.kind, 'managed');
  assert.equal(addData.source.source_kind, 'managed');
  assert.equal(addData.source.path, fs.realpathSync(managedSource));
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', name)), fs.realpathSync(managedSource));
});


test('packaged noesis skill manager entry skill installs as a managed source', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const add = runNoesis(['skill', 'add', 'noesis-skill-manager', '--json'], { cwd: workspace, home });
  const addData = JSON.parse(add.stdout);
  const source = path.join(REPO_ROOT, 'skills', 'noesis-skill-manager');

  assert.equal(addData.source.kind, 'managed');
  assert.equal(addData.source.path, fs.realpathSync(source));
  assert.equal(addData.skill.status, 'ok');
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', 'noesis-skill-manager')), fs.realpathSync(source));
  assert.equal(fs.realpathSync(path.join(workspace, '.claude', 'skills', 'noesis-skill-manager')), fs.realpathSync(source));

  const inspect = runNoesis(['skill', 'inspect', 'noesis-skill-manager', '--json'], { cwd: workspace, home });
  const inspectData = JSON.parse(inspect.stdout);
  assert.equal(inspectData.source.kind, 'managed');
  assert.equal(inspectData.source.has_skill_md, true);
  assert.equal(inspectData.skill.status, 'ok');

  const verify = runNoesis(['skill', 'verify', 'noesis-skill-manager', '--json'], { cwd: workspace, home });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');
});


test('packaged heuristic intake entry skill installs as a managed source', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const add = runNoesis(['skill', 'add', 'heuristic-intake', '--json'], { cwd: workspace, home });
  const addData = JSON.parse(add.stdout);
  const source = path.join(REPO_ROOT, 'skills', 'heuristic-intake');

  assert.equal(addData.source.kind, 'managed');
  assert.equal(addData.source.path, fs.realpathSync(source));
  assert.equal(addData.skill.status, 'ok');
  assert.equal(fs.existsSync(path.join(source, 'references', 'durability-rules.md')), true);
  assert.equal(fs.existsSync(path.join(source, 'references', 'event-template.json')), true);
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', 'heuristic-intake')), fs.realpathSync(source));
  assert.equal(fs.realpathSync(path.join(workspace, '.claude', 'skills', 'heuristic-intake')), fs.realpathSync(source));

  const verify = runNoesis(['skill', 'verify', 'heuristic-intake', '--json'], { cwd: workspace, home });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');
});


test('explicit source can select external when managed source exists', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('dupe-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const managedSource = makeManagedSkill(t, name);
  const externalSource = makeSkill(home, name);

  const defaultResult = runNoesis(['skill', 'inspect', name, '--json'], { cwd: workspace, home });
  const defaultData = JSON.parse(defaultResult.stdout);
  assert.equal(defaultData.source.kind, 'managed');
  assert.equal(defaultData.source.path, fs.realpathSync(managedSource));

  const explicit = runNoesis(['skill', 'inspect', name, '--source', externalSource, '--json'], { cwd: workspace, home });
  const explicitData = JSON.parse(explicit.stdout);

  assert.equal(explicitData.source.kind, 'external');
  assert.equal(explicitData.source.path, fs.realpathSync(externalSource));
  assert.notEqual(explicitData.source.path, fs.realpathSync(managedSource));
});


test('list reports runtime mismatch', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('mismatch-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const source = makeSkill(home, name);
  const codexDir = path.join(workspace, '.codex', 'skills');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.symlinkSync(path.relative(codexDir, source), path.join(codexDir, name));

  const result = runNoesis(['skill', 'list', '--json'], { cwd: workspace, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.skills[0].name, name);
  assert.equal(data.skills[0].status, 'mismatch');
  assert.equal(data.skills[0].runtimes.claude.status, 'missing');
});


test('verify all fails broken link', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('broken-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const codexDir = path.join(workspace, '.codex', 'skills');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.symlinkSync('missing-source', path.join(codexDir, name));

  const result = runNoesis(['skill', 'verify', '--json'], { cwd: workspace, home, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.failures[0].name, name);
  assert.equal(data.failures[0].reason, 'broken');
});


test('remove deletes broken symlinks', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const name = uniqueName('remove-broken-demo');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  for (const runtimeDir of [path.join(workspace, '.codex', 'skills'), path.join(workspace, '.claude', 'skills')]) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.symlinkSync('missing-source', path.join(runtimeDir, name));
  }

  runNoesis(['skill', 'remove', name], { cwd: workspace, home });

  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'skills', name)), false);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'skills', name)), false);
});


test('agent-id resolution uses pamem status JSON', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'agent-home');
  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  fs.mkdirSync(fakeBin);
  const pamem = path.join(fakeBin, 'pamem');
  fs.writeFileSync(
    pamem,
    `#!/bin/sh
if [ "$1" = status ] && [ "$2" = --agent-id ] && [ "$4" = --json ]; then
  printf '%s\\n' '{"status":"ok","root":"${workspace}"}'
  exit 0
fi
echo unexpected pamem args >&2
exit 1
`,
  );
  fs.chmodSync(pamem, 0o755);

  const result = runNoesis(['skill', 'list', '--agent-id', 'agent-1', '--json'], {
    cwd: root,
    home,
    env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}` },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.target.resolver, 'pamem-status');
  assert.equal(data.target.agent_id, 'agent-1');
  assert.equal(data.target.root, path.resolve(workspace));
});


test('agent-id resolution prefers installed pamem dependency bin', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'agent-home');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  makeProjectPamem(t, workspace);

  const result = runNoesis(['skill', 'list', '--agent-id', 'agent-1', '--json'], {
    cwd: root,
    home,
    env: { PATH: root },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.target.resolver, 'pamem-status');
  assert.equal(data.target.root, path.resolve(workspace));
  assert.equal(data.target.memory_repo, path.join(workspace, 'memory'));
  assert.equal(data.target.agent_home, path.resolve(workspace));
  assert.equal(data.target.role, 'coder');
  assert.equal(data.target.runtime, 'cli');
});


test('agent name options are not supported; use pamem agent id instead', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  const agent = runNoesis(['skill', 'list', '--agent', 'developer'], { cwd: root, home, check: false });
  assert.equal(agent.status, 1);
  assert.match(agent.stderr, /unknown option: --agent/);

  const agentName = runNoesis(['skill', 'list', '--agent-name', 'developer'], { cwd: root, home, check: false });
  assert.equal(agentName.status, 1);
  assert.match(agentName.stderr, /unknown option: --agent-name/);
});


test('list and inspect report Claude plugin capabilities from settings', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(workspace, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.claude', 'settings.json'),
    `${JSON.stringify({ enabledPlugins: { 'humanize@humania': true } }, null, 2)}\n`,
  );

  const listing = runNoesis(['skill', 'list', '--json'], { cwd: workspace, home });
  const listData = JSON.parse(listing.stdout);
  assert.deepEqual(listData.skills, []);
  assert.equal(listData.capabilities.length, 1);
  assert.equal(listData.capabilities[0].name, 'humanize');
  assert.equal(listData.capabilities[0].type, 'plugin-capability');
  assert.equal(listData.capabilities[0].status, 'ok');
  assert.equal(listData.capabilities[0].runtimes.claude.key, 'humanize@humania');

  const inspect = runNoesis(['skill', 'inspect', 'humanize', '--json'], { cwd: workspace, home });
  const inspectData = JSON.parse(inspect.stdout);
  assert.equal(inspectData.source.status, 'not-applicable');
  assert.equal(inspectData.skill, null);
  assert.equal(inspectData.capability.name, 'humanize');
  assert.equal(inspectData.capability.status, 'ok');

  const verify = runNoesis(['skill', 'verify', 'humanize', '--json'], { cwd: workspace, home });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');
});


test('list and verify can use Claude plugin list when settings do not show a plugin', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const otherWorkspace = path.join(root, 'other-workspace');
  const logFile = path.join(root, 'claude.log');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const fakeClaudeBin = makeFakeClaude(t, logFile);
  const env = {
    PATH: `${fakeClaudeBin}${path.delimiter}${process.env.PATH || ''}`,
    FAKE_CLAUDE_PLUGIN_LIST: JSON.stringify([
      { id: 'humanize@humania', scope: 'project', enabled: true, version: '1.2.3', installPath: path.join(root, 'humanize'), projectPath: workspace },
      { id: 'superpowers@claude-plugins-official', scope: 'project', enabled: true, projectPath: otherWorkspace },
    ]),
  };

  const listing = runNoesis(['skill', 'list', '--json'], { cwd: workspace, home, env });
  const listData = JSON.parse(listing.stdout);
  assert.equal(listData.capabilities.length, 1);
  assert.equal(listData.capabilities[0].name, 'humanize');
  assert.equal(listData.capabilities[0].runtimes.claude.source, 'claude-cli');
  assert.equal(listData.capabilities[0].runtimes.claude.version, '1.2.3');

  const verify = runNoesis(['skill', 'verify', 'humanize', '--json'], { cwd: workspace, home, env });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');

  const otherVerify = runNoesis(['skill', 'verify', 'superpowers', '--json'], { cwd: workspace, home, env, check: false });
  assert.equal(otherVerify.status, 1);
  assert.equal(JSON.parse(otherVerify.stdout).status, 'failed');
});


test('add and remove manage Claude plugin capabilities in settings', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const add = runNoesis(['skill', 'add', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env: { PATH: '' },
  });
  const addData = JSON.parse(add.stdout);
  assert.equal(addData.capability.status, 'ok');
  assert.equal(addData.actions[0].action, 'enabled');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(workspace, '.claude', 'settings.json'), 'utf8')).enabledPlugins['humanize@humania'],
    true,
  );

  const addAgain = runNoesis(['skill', 'add', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env: { PATH: '' },
  });
  assert.equal(JSON.parse(addAgain.stdout).actions[0].action, 'already-enabled');

  const remove = runNoesis(['skill', 'remove', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env: { PATH: '' },
  });
  const removeData = JSON.parse(remove.stdout);
  assert.equal(removeData.capability.status, 'missing');
  assert.equal(removeData.actions[0].action, 'disabled');
  assert.equal(
    Object.hasOwn(JSON.parse(fs.readFileSync(path.join(workspace, '.claude', 'settings.json'), 'utf8')).enabledPlugins, 'humanize@humania'),
    false,
  );
});


test('plugin capability add and remove use Claude CLI when available', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const logFile = path.join(root, 'claude.log');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const fakeClaude = makeFakeClaudeWithState(t);
  const env = {
    PATH: `${fakeClaude.binDir}${path.delimiter}${process.env.PATH || ''}`,
    FAKE_CLAUDE_LOG: logFile,
    FAKE_CLAUDE_STATE: fakeClaude.stateFile,
  };

  const add = runNoesis(['skill', 'add', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env,
  });
  const addData = JSON.parse(add.stdout);
  assert.equal(addData.capability.status, 'ok');
  assert.equal(addData.actions[0].action, 'enabled');
  assert.equal(addData.actions[0].method, 'claude-cli');
  assert.equal(addData.actions[0].command, 'claude plugin install');
  assert.equal(addData.actions[0].scope, 'project');
  assert.equal(addData.capability.runtimes.claude.source, 'claude-cli');
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);

  const remove = runNoesis(['skill', 'remove', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env,
  });
  const removeData = JSON.parse(remove.stdout);
  assert.equal(removeData.capability.status, 'missing');
  assert.equal(removeData.actions[0].method, 'claude-cli');
  assert.equal(removeData.actions[0].command, 'claude plugin uninstall');

  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /plugin install humanize@humania -s project/);
  assert.match(log, /plugin uninstall humanize@humania -s project/);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);
});


test('plugin capability add fails when Claude CLI does not report the plugin after install', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const logFile = path.join(root, 'claude.log');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const fakeClaudeBin = makeFakeClaude(t, logFile);

  const result = runNoesis(['skill', 'add', 'humanize', '--json'], {
    cwd: workspace,
    home,
    env: { PATH: `${fakeClaudeBin}${path.delimiter}${process.env.PATH || ''}` },
    check: false,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /add verification failed/);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);
});


test('capability add rejects source and alias options', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const source = runNoesis(['skill', 'add', 'humanize', '--source', workspace], { cwd: workspace, home, check: false });
  assert.equal(source.status, 1);
  assert.match(source.stderr, /--source is not supported/);

  const alias = runNoesis(['skill', 'add', 'humanize', '--alias', 'h'], { cwd: workspace, home, check: false });
  assert.equal(alias.status, 1);
  assert.match(alias.stderr, /--alias is not supported/);
});


test('global plugin capability uses home settings only', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const logFile = path.join(root, 'claude.log');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const fakeClaude = makeFakeClaudeWithState(t);

  const add = runNoesis(['skill', 'add', 'superpowers', '--global', '--json'], {
    cwd: workspace,
    home,
    env: {
      PATH: `${fakeClaude.binDir}${path.delimiter}${process.env.PATH || ''}`,
      FAKE_CLAUDE_LOG: logFile,
      FAKE_CLAUDE_STATE: fakeClaude.stateFile,
    },
  });
  const data = JSON.parse(add.stdout);

  assert.equal(data.target.root, path.resolve(home));
  assert.equal(data.capability.status, 'ok');
  assert.equal(data.actions[0].method, 'claude-cli');
  assert.equal(data.actions[0].scope, 'user');
  assert.equal(data.capability.runtimes.claude.source, 'claude-cli');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);
  assert.match(fs.readFileSync(logFile, 'utf8'), /plugin install superpowers@claude-plugins-official -s user/);
});


test('inspect reports pamem runtime capability state', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(workspace, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.claude', 'settings.json'),
    `${JSON.stringify({ enabledPlugins: { 'pamem@phlens': true } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\ncodex_hooks = true\n');
  fs.writeFileSync(
    path.join(workspace, '.codex', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [
              { type: 'command', command: '.pamem/scripts/memory-session-start.sh' },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current Task\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work Log\n');

  const inspect = runNoesis(['skill', 'inspect', 'pamem', '--json'], { cwd: workspace, home });
  const data = JSON.parse(inspect.stdout);

  assert.equal(data.source.status, 'not-applicable');
  assert.equal(data.capability.name, 'pamem');
  assert.equal(data.capability.type, 'runtime-capability');
  assert.equal(data.capability.status, 'ok');
  assert.equal(data.capability.runtimes.claude.status, 'ok');
  assert.equal(data.capability.runtimes.codex.status, 'ok');
  assert.equal(data.capability.runtimes.codex.config.codex_hooks, true);
  assert.equal(data.capability.runtimes.codex.hooks.session_start, true);

  const verify = runNoesis(['skill', 'verify', 'pamem', '--json'], { cwd: workspace, home });
  assert.equal(JSON.parse(verify.stdout).status, 'ok');
});


test('add and remove pamem codex runtime via pamem dependency bin', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  makeProjectPamemCommand(t);

  const add = runNoesis(['skill', 'add', 'pamem', '--runtime', 'codex', '--json'], { cwd: workspace, home });
  const addData = JSON.parse(add.stdout);
  assert.equal(addData.actions[0].type, 'pamem-runtime');
  assert.equal(addData.capability.status, 'ok');
  assert.equal(addData.capability.runtime_mode, 'codex');
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.codex', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command, '.pamem/scripts/memory-session-start.sh');

  const remove = runNoesis(['skill', 'remove', 'pamem', '--runtime', 'codex', '--json'], { cwd: workspace, home });
  const removeData = JSON.parse(remove.stdout);
  assert.equal(removeData.actions[0].action, 'removed');
  assert.equal(removeData.capability.status, 'missing');
  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'hooks.json')), false);
});


test('add and remove pamem Claude runtime via Claude CLI', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const logFile = path.join(root, 'claude.log');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const fakeClaude = makeFakeClaudeWithState(t);
  const env = {
    PATH: `${fakeClaude.binDir}${path.delimiter}${process.env.PATH || ''}`,
    FAKE_CLAUDE_LOG: logFile,
    FAKE_CLAUDE_STATE: fakeClaude.stateFile,
  };

  const add = runNoesis(['skill', 'add', 'pamem', '--runtime', 'claude', '--json'], {
    cwd: workspace,
    home,
    env,
  });
  const addData = JSON.parse(add.stdout);
  assert.equal(addData.actions[0].method, 'claude-cli');
  assert.equal(addData.actions[0].command, 'claude plugin install');
  assert.equal(addData.actions[0].scope, 'project');
  assert.equal(addData.capability.runtimes.claude.status, 'ok');
  assert.equal(addData.capability.runtimes.claude.source, 'claude-cli');
  assert.equal(addData.capability.runtimes.codex.status, 'missing');
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'hooks.json')), false);

  const remove = runNoesis(['skill', 'remove', 'pamem', '--runtime', 'claude', '--json'], {
    cwd: workspace,
    home,
    env,
  });
  const removeData = JSON.parse(remove.stdout);
  assert.equal(removeData.actions[0].method, 'claude-cli');
  assert.equal(removeData.actions[0].command, 'claude plugin uninstall');
  assert.equal(removeData.capability.runtimes.claude.status, 'missing');

  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /plugin install pamem@phlens -s project/);
  assert.match(log, /plugin uninstall pamem@phlens -s project/);
});


test('pamem codex install passes agent-home mode for pamem agent homes', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'agent-home');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  makeProjectPamemCommand(t);

  const result = runNoesis(['skill', 'add', 'pamem', '--agent-id', 'agent-1', '--runtime', 'codex', '--json'], {
    cwd: root,
    home,
    env: { FAKE_PAMEM_AGENT_ROOT: workspace },
  });
  const data = JSON.parse(result.stdout);
  assert.equal(data.target.kind, 'agent-home');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, 'pamem-args.json'), 'utf8')), ['install', workspace, '--agent-home']);
  assert.equal(data.capability.runtimes.codex.status, 'ok');
  assert.equal(data.capability.runtimes.codex.hooks.command, '/opt/pamem/scripts/memory-session-start.sh');
  assert.equal(data.capability.runtimes.codex.hooks.expected_command, null);
  assert.equal(data.capability.runtimes.codex.pamem_config.path, path.join(workspace, 'config.toml'));
  assert.equal(data.capability.runtimes.codex.current_task.path, path.join(workspace, 'current-task.md'));
  assert.equal(data.capability.runtimes.codex.work_log.path, path.join(workspace, 'work-log.md'));
  assert.equal(data.capability.runtimes.codex.foundation, undefined);
  assert.equal(data.capability.runtimes.codex.memory, undefined);
});


test('pamem codex install does not force agent-home mode for agent target with workspace config', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace-memory');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.pamem', 'config.toml'), 'default_profile = "coder"\n');
  makeProjectPamemCommand(t);

  const result = runNoesis(['skill', 'add', 'pamem', '--agent-id', 'agent-1', '--runtime', 'codex', '--json'], {
    cwd: root,
    home,
    env: { FAKE_PAMEM_AGENT_ROOT: workspace },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.target.kind, 'agent-home');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, 'pamem-args.json'), 'utf8')), ['install', workspace]);
  assert.equal(data.capability.runtimes.codex.status, 'ok');
  assert.equal(data.capability.runtimes.codex.hooks.command, '.pamem/scripts/memory-session-start.sh');
  assert.equal(data.capability.runtimes.codex.foundation.path, path.join(workspace, '.pamem'));
  assert.equal(data.capability.runtimes.codex.memory.path, path.join(workspace, 'MEMORY.md'));
  assert.equal(data.capability.runtimes.codex.pamem_config, undefined);
});


test('pamem add requires runtime when target type is ambiguous', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const result = runNoesis(['skill', 'add', 'pamem'], { cwd: workspace, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --runtime/);
});


test('pamem codex verification rejects wrong workspace SessionStart hook command', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\ncodex_hooks = true\n');
  fs.writeFileSync(
    path.join(workspace, '.codex', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [
              { type: 'command', command: '/opt/pamem/scripts/memory-session-start.sh' },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current Task\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work Log\n');

  const result = runNoesis(['skill', 'verify', 'pamem', '--json'], { cwd: workspace, home, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.capabilities[0].runtimes.codex.status, 'missing');
  assert.equal(data.capabilities[0].runtimes.codex.hooks.status, 'missing');
  assert.equal(data.capabilities[0].runtimes.codex.hooks.expected_command, '.pamem/scripts/memory-session-start.sh');
});


test('pamem runtime is ok for codex-only bootstrap state', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\ncodex_hooks = true\n');
  fs.writeFileSync(
    path.join(workspace, '.codex', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [
              { type: 'command', command: '.pamem/scripts/memory-session-start.sh' },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current Task\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work Log\n');

  const inspect = runNoesis(['skill', 'inspect', 'pamem', '--json'], { cwd: workspace, home });
  const data = JSON.parse(inspect.stdout);

  assert.equal(data.capability.status, 'ok');
  assert.equal(data.capability.runtime_mode, 'codex');
  assert.equal(data.capability.runtimes.claude.status, 'missing');
  assert.equal(data.capability.runtimes.codex.status, 'ok');
});


test('protected pamem-provided skills are not standalone symlink skills', (t) => {
  const root = withTempDir(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const inspect = runNoesis(['skill', 'inspect', 'memory-lint'], { cwd: workspace, home, check: false });
  assert.equal(inspect.status, 1);
  assert.match(inspect.stderr, /provided by pamem/);

  const verify = runNoesis(['skill', 'verify', 'memory-lint'], { cwd: workspace, home, check: false });
  assert.equal(verify.status, 1);
  assert.match(verify.stderr, /provided by pamem/);

  const add = runNoesis(['skill', 'add', 'memory-rule'], { cwd: workspace, home, check: false });
  assert.equal(add.status, 1);
  assert.match(add.stderr, /provided by pamem/);

  const remove = runNoesis(['skill', 'remove', 'sync-request'], { cwd: workspace, home, check: false });
  assert.equal(remove.status, 1);
  assert.match(remove.stderr, /provided by pamem/);
});
