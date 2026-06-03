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


function tempRoot(t) {
  counter += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-launch-${process.pid}-${counter}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}


function runNoesis(args, { cwd, home, env = {}, check = true }) {
  const result = spawnSync(process.execPath, [NOESIS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      ...env,
    },
    encoding: 'utf8',
  });
  if (check && result.status !== 0) {
    assert.fail(`noesis failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}


function makePamemComponent(root) {
  const source = path.join(root, 'pamem');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bin', 'pamem.mjs'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [command, ...args] = process.argv.slice(2);
const workspace = args[0] || process.cwd();
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function value(name) {
  const index = args.indexOf(name);
  return index === -1 ? '' : args[index + 1];
}
function writeConfig(root, agentHome) {
  const config = agentHome ? path.join(root, 'config.toml') : path.join(root, '.pamem', 'config.toml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, 'default_profile = "' + value('--profile') + '"\\n[memory_repo]\\npath = "' + (value('--memory-repo') || path.join(root, 'memory')) + '"\\n[runtime]\\nmode = "' + value('--runtime') + '"\\nagent_id = "' + value('--agent-id') + '"\\n');
}
function install(root, agentHome) {
  const profile = value('--profile') || 'onboarding';
  const memoryRepo = value('--memory-repo') || path.join(root, 'memory');
  fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.mkdirSync(memoryRepo, { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), '[features]\\nhooks = true\\n');
  fs.writeFileSync(path.join(root, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [
    { type: 'command', command: agentHome ? repoRoot + '/scripts/memory-session-start.sh' : '.pamem/scripts/memory-session-start.sh' },
    { type: 'command', command: '/custom/tools/memory-session-start.sh' }
  ] }] } }, null, 2));
  fs.mkdirSync(agentHome ? root : path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(agentHome ? path.join(root, 'current-task.md') : path.join(root, 'notes', 'current-task.md'), '# Current\\n');
  fs.writeFileSync(agentHome ? path.join(root, 'work-log.md') : path.join(root, 'notes', 'work-log.md'), '# Work\\n');
  fs.writeFileSync(path.join(memoryRepo, 'MEMORY.md'), 'Role guide: roles/' + profile + '/' + profile + '.md\\n');
  fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  for (const name of ['memory-lint', 'memory-rule']) {
    const link = path.join(root, '.codex', 'skills', name);
    try { fs.symlinkSync(path.relative(path.dirname(link), path.join(repoRoot, 'skills', name)), link); } catch {}
  }
}
if (command === 'setup') {
  const agentHome = args.includes('--agent-home');
  writeConfig(workspace, agentHome);
  install(workspace, agentHome);
  console.log(JSON.stringify({ status: 'ok', command: 'setup', profile: value('--profile'), runtime: value('--runtime'), agent_id: value('--agent-id') }));
  process.exit(0);
}
if (command === 'install') {
  install(workspace, args.includes('--agent-home'));
  process.exit(0);
}
if (command === 'status') {
  const root = value('--workspace') || workspace;
  const config = fs.existsSync(path.join(root, 'config.toml')) ? path.join(root, 'config.toml') : path.join(root, '.pamem', 'config.toml');
  const text = fs.readFileSync(config, 'utf8');
  const runtime = text.match(/mode = "([^"]+)"/)?.[1] || 'cli';
  const agentId = text.match(/agent_id = "([^"]*)"/)?.[1] || 'workspace-agent';
  const memoryRepo = text.match(/path = "([^"]+)"/)?.[1] || path.join(workspace, 'memory');
  console.log(JSON.stringify({ status: 'ok', root, runtime, role: 'coder', agent_id: agentId, config, memory_repo: memoryRepo, memory_entry: path.join(memoryRepo, 'MEMORY.md'), current_task: path.join(root, 'current-task.md'), work_log: path.join(root, 'work-log.md') }));
  process.exit(0);
}
if (command === 'lint') {
  console.log(JSON.stringify({ status: 'ok', error_count: 0, warning_count: 0 }));
  process.exit(0);
}
if (command === 'remove') {
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(path.join(source, 'bin', 'pamem.mjs'), 0o755);
  for (const name of ['memory-lint', 'memory-rule']) {
    fs.mkdirSync(path.join(source, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
  }
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'scripts', 'memory-session-start.sh'), '#!/bin/sh\nexit 0\n');
  return source;
}


function makeFailingPamemComponent(root) {
  const source = path.join(root, 'failing-pamem');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bin', 'pamem.mjs'),
    `#!/usr/bin/env node
const [command] = process.argv.slice(2);
if (command === 'setup') {
  console.error('intentional setup failure');
  process.exit(7);
}
if (command === 'status' || command === 'lint') {
  console.log(JSON.stringify({ status: 'ok' }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(path.join(source, 'bin', 'pamem.mjs'), 0o755);
  return source;
}


function makeLoreForgeComponent(root) {
  const source = path.join(root, 'LoreForge');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(source, 'skills', 'loreforge'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'loreforge', 'SKILL.md'), '---\nname: loreforge\ndescription: test\n---\n');
  fs.writeFileSync(
    path.join(source, 'bin', 'loreforge'),
    `#!/usr/bin/env node
const [command] = process.argv.slice(2);
if (command === 'status' || command === 'validate') {
  console.log(JSON.stringify({ status: 'ok' }));
  process.exit(0);
}
process.exit(0);
`,
  );
  fs.chmodSync(path.join(source, 'bin', 'loreforge'), 0o755);
  return source;
}


function ensureBundledPamem(t) {
  const source = path.join(REPO_ROOT, 'node_modules', '@phlens', 'pamem');
  if (fs.existsSync(source)) return source;

  const created = makePamemComponent(path.dirname(source));
  t.after(() => fs.rmSync(created, { recursive: true, force: true }));
  return created;
}


function makeGitRemote(source, remote) {
  runGit(['init'], source);
  runGit(['config', 'user.name', 'Noesis Test'], source);
  runGit(['config', 'user.email', 'noesis-test@example.com'], source);
  runGit(['add', '.'], source);
  runGit(['commit', '-m', 'initial'], source);
  runGit(['init', '--bare', remote], path.dirname(remote));
  runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
  runGit(['remote', 'add', 'origin', remote], source);
  runGit(['push', 'origin', 'HEAD:main'], source);
  return remote;
}


function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    assert.fail(`git ${args.join(' ')} failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}


function makeFakeClaude(t, root) {
  const binDir = path.join(root, 'fake-bin');
  const stateFile = path.join(root, 'claude-plugins.json');
  const logFile = path.join(root, 'claude.log');
  const installPath = path.join(root, 'fake-claude-cache', 'phlens', 'pamem', '0.9.2');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(installPath, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(installPath, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/memory-session-start.sh' }],
      }],
    },
  }, null, 2));
  fs.writeFileSync(stateFile, '[]\n');
  const claude = path.join(binDir, 'claude');
  fs.writeFileSync(
    claude,
    `#!/bin/sh
node - "$@" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const stateFile = process.env.FAKE_CLAUDE_STATE;
const installPath = process.env.FAKE_CLAUDE_INSTALL_PATH;
const version = process.env.FAKE_CLAUDE_PLUGIN_VERSION || '0.9.2';
const args = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') {
  console.log(JSON.stringify(entries));
  process.exit(0);
}
if (args[0] === 'plugin' && (args[1] === 'install' || args[1] === 'uninstall' || args[1] === 'update')) {
  const key = args[2];
  const scope = args[args.indexOf('-s') + 1] || 'user';
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, process.cwd() + '|' + args.join(' ') + '\\n');
  const existing = entries.find((entry) => entry.id === key && entry.scope === scope && (!entry.projectPath || path.resolve(entry.projectPath) === process.cwd()));
  if (args[1] === 'install') {
    if (existing) {
      existing.enabled = true;
      existing.version = existing.version || version;
      existing.installPath = existing.installPath || installPath;
    } else {
      entries.push({ id: key, scope, enabled: true, version, installPath, projectPath: scope === 'project' ? process.cwd() : undefined });
    }
  } else if (args[1] === 'update') {
    if (existing) {
      existing.enabled = true;
      existing.version = version;
      existing.installPath = installPath;
      delete existing.errors;
    } else {
      entries.push({ id: key, scope, enabled: true, version, installPath, projectPath: scope === 'project' ? process.cwd() : undefined });
    }
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
  return { binDir, logFile, stateFile, installPath, version: '0.9.2' };
}


test('launch prepares an agent home and reports runtime command without starting when --json is set', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  fs.mkdirSync(home);
  const pamem = makePamemComponent(root);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'codex',
    '--agent-id', 'coder-local',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    '--help',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'runtime-not-run');
  assert.deepEqual(data.launch_command, ['codex', '--dangerously-bypass-approvals-and-sandbox', '--help']);
  assert.equal(data.runtime_state.agent_id, 'coder-local');
  assert.equal(data.runtime_state.memory_repo, memory);
  assert.match(fs.readFileSync(path.join(memory, 'MEMORY.md'), 'utf8'), /roles\/coder\/coder\.md/);
  assert.doesNotMatch(fs.readFileSync(path.join(memory, 'MEMORY.md'), 'utf8'), /roles\/<role>\//);
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', '.noesis', 'config.toml')), true);
});


test('launch creates and resumes a named task instance without role-local state reuse', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  fs.mkdirSync(home);

  const created = runNoesis([
    'launch',
    '--name', 'task52-noesis-role-startup',
    '--role', 'planner',
    '--runtime', 'codex',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    '--help',
  ], { cwd: root, home });
  const first = JSON.parse(created.stdout);
  const state = first.runtime_state;

  assert.equal(first.status, 'ok');
  assert.equal(state.kind, 'task-instance');
  assert.equal(state.name, 'task52-noesis-role-startup');
  assert.equal(state.role, 'planner');
  assert.notEqual(state.internal_instance_id, 'task52-noesis-role-startup');
  assert.equal(state.agent_id, state.internal_instance_id);
  assert.equal(state.memory_repo, memory);
  assert.equal(state.task_dir, path.join(state.root, 'tasks', 'task52-noesis-role-startup'));
  assert.equal(fs.existsSync(path.join(state.root, '.noesis', 'instance.json')), true);
  assert.equal(fs.existsSync(path.join(state.root, 'notes', 'current-task.md')), true);
  assert.equal(fs.existsSync(path.join(state.root, 'notes', 'work-log.md')), true);
  assert.equal(fs.existsSync(path.join(state.task_dir, 'plan')), true);
  assert.equal(fs.existsSync(path.join(state.root, '.codex', 'skills', 'doc-review')), true);
  assert.equal(fs.existsSync(path.join(state.root, '.codex', 'skills', 'noesis-skill-manager')), false);

  const doctor = JSON.parse(runNoesis(['doctor', '--workspace', state.root, '--json'], { cwd: root, home }).stdout);
  assert.equal(doctor.summary.error_count, 0);
  assert.equal(doctor.checks.some((check) => check.id === 'entry_skill.component.skill_manager' && check.status === 'warning'), false);

  const resumed = runNoesis([
    'launch',
    '--name', 'task52-noesis-role-startup',
    '--runtime', 'codex',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
    '--',
    '--help',
  ], { cwd: root, home });
  const second = JSON.parse(resumed.stdout);

  assert.equal(second.runtime_state.root, state.root);
  assert.equal(second.runtime_state.internal_instance_id, state.internal_instance_id);
  assert.equal(second.runtime_state.role, 'planner');
  assert.equal(second.runtime_state.memory_repo, memory);

  const printed = runNoesis([
    'launch',
    '--name', 'task52-noesis-role-startup',
    '--runtime', 'codex',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--print-env',
  ], { cwd: root, home }).stdout;

  assert.match(printed, /task_state=task-instance/);
  assert.match(printed, /role=planner/);
  assert.match(printed, /PAMEM_CURRENT_TASK=.*notes.*current-task\.md/);

  const roleMismatch = runNoesis([
    'launch',
    '--name', 'task52-noesis-role-startup',
    '--role', 'coder',
    '--runtime', 'codex',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
    '--',
    '--help',
  ], { cwd: root, home, check: false });
  assert.equal(roleMismatch.status, 1);
  assert.match(roleMismatch.stderr, /existing task instance .* role=planner/);

  const memoryMismatch = runNoesis([
    'launch',
    '--name', 'task52-noesis-role-startup',
    '--runtime', 'codex',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', path.join(root, 'other-memory'),
    '--json',
    '--',
    '--help',
  ], { cwd: root, home, check: false });
  assert.equal(memoryMismatch.status, 1);
  assert.match(memoryMismatch.stderr, /memory repo mismatch/);
});


test('launch can generate a persistent task instance and list instance metadata', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  fs.mkdirSync(home);

  const launched = runNoesis([
    'launch',
    '--role', 'coder',
    '--runtime', 'cli',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });
  const data = JSON.parse(launched.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.runtime_state.kind, 'task-instance');
  assert.match(data.runtime_state.name, /^coder-\d{8}T\d{6}-[a-f0-9]{8}$/);
  assert.equal(data.runtime_state.role, 'coder');
  assert.equal(data.runtime_state.task_dir, path.join(data.runtime_state.root, 'tasks', data.runtime_state.name));

  const listed = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  const instance = listed.agents.find((agent) => agent.internal_instance_id === data.runtime_state.internal_instance_id);

  assert.equal(instance?.kind, 'task-instance');
  assert.equal(instance.name, data.runtime_state.name);
  assert.equal(instance.role, 'coder');
  assert.equal(instance.runtime, 'cli');
  assert.equal(instance.state_root, data.runtime_state.root);
  assert.equal(instance.task_dir, data.runtime_state.task_dir);
});


test('launch --rm creates a disposable task instance and removes successful transient state', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const pamem = makePamemComponent(root);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--role', 'reviewer',
    '--runtime', 'cli',
    '--rm',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.runtime_state.kind, 'task-instance');
  assert.equal(data.runtime_state.disposable, true);
  assert.equal(data.disposable_cleanup.status, 'removed');
  assert.equal(fs.existsSync(data.runtime_state.root), false);

  const listed = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  assert.equal(listed.agents.some((agent) => agent.internal_instance_id === data.runtime_state.internal_instance_id), false);

  const invalid = runNoesis([
    'launch',
    '--role', 'reviewer',
    '--runtime', 'cli',
    '--rm',
    '--resume',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home, check: false });

  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--resume cannot be used with --rm/);

  const printEnvInvalid = runNoesis([
    'launch',
    '--role', 'reviewer',
    '--runtime', 'cli',
    '--rm',
    '--print-env',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
  ], { cwd: root, home, check: false });

  assert.equal(printEnvInvalid.status, 1);
  assert.match(printEnvInvalid.stderr, /--print-env cannot be used with --rm/);

  const failed = runNoesis([
    'launch',
    '--role', 'reviewer',
    '--runtime', 'cli',
    '--rm',
    '--with', 'none',
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home, check: false });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pamem config not found/);

  const afterFailure = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  const failedDisposable = afterFailure.agents.find((agent) => agent.status === 'failed-disposable');
  assert.equal(Boolean(failedDisposable), true);
  assert.equal(failedDisposable.role, 'reviewer');
  assert.equal(failedDisposable.disposable, true);
  assert.equal(fs.existsSync(path.join(failedDisposable.state_root, '.noesis', 'instance.json')), true);
});


test('launch --rm marks setup exceptions as failed disposable instances', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const pamem = makeFailingPamemComponent(root);
  fs.mkdirSync(home);

  const failed = runNoesis([
    'launch',
    '--role', 'reviewer',
    '--runtime', 'cli',
    '--rm',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home, check: false });

  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /intentional setup failure/);

  const listed = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  const failedDisposable = listed.agents.find((agent) => agent.status === 'failed-disposable');

  assert.equal(Boolean(failedDisposable), true);
  assert.equal(failedDisposable.role, 'reviewer');
  assert.equal(failedDisposable.disposable, true);
  assert.equal(fs.existsSync(path.join(failedDisposable.state_root, '.noesis', 'instance.json')), true);
});


test('task instance sessions are recorded without injecting session history into startup notes', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--name', 'session-cleanup',
    '--role', 'coder',
    '--runtime', 'cli',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });

  assert.equal(result.stdout.includes('ok'), true);

  const listed = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  const instance = listed.agents.find((agent) => agent.name === 'session-cleanup');
  assert.equal(Boolean(instance), true);

  const currentTask = fs.readFileSync(path.join(instance.state_root, 'notes', 'current-task.md'), 'utf8');
  const workLog = fs.readFileSync(path.join(instance.state_root, 'notes', 'work-log.md'), 'utf8');
  const latestSession = JSON.parse(fs.readFileSync(path.join(instance.state_root, 'sessions', 'latest.json'), 'utf8'));

  assert.equal(currentTask.includes('session_id'), false);
  assert.equal(workLog.includes('session_id'), false);
  assert.equal(typeof latestSession.session_id, 'string');
  assert.equal(fs.existsSync(path.join(instance.state_root, 'sessions', `${latestSession.session_id}.json`)), true);

  const resumed = JSON.parse(runNoesis([
    'launch',
    '--name', 'session-cleanup',
    '--resume',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
  ], { cwd: root, home }).stdout);

  assert.equal(resumed.runtime, 'cli');
  assert.equal(resumed.runtime_state.root, instance.state_root);
  assert.deepEqual(resumed.launch_command, ['echo', 'ok']);
});


test('compatibility agent sessions are recorded without injecting session history into startup notes', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  fs.mkdirSync(home);

  runNoesis([
    'launch',
    '--agent-id', 'compat-session-cleanup',
    '--role', 'coder',
    '--runtime', 'cli',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });

  const agentHome = path.join(home, '.local', 'share', 'pamem', 'agents', 'compat-session-cleanup');
  fs.writeFileSync(path.join(agentHome, 'current-task.md'), [
    '# Current Task',
    '',
    '<!-- pamem-session:start -->',
    '## Runtime Session',
    '- Latest CLI session_id: `11111111-1111-4111-8111-111111111111`',
    '- Action: resume',
    '- Updated at: 2026-01-01T00:00:00Z',
    '<!-- pamem-session:end -->',
    '',
    '## Active Task',
    '- Keep this line',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(agentHome, 'work-log.md'), [
    '# Work Log',
    '',
    '## Runtime Sessions',
    '- 2026-01-01T00:00:00Z session_id=11111111-1111-4111-8111-111111111111 action=resume session_file=/tmp/session.json',
    '',
    '- Manual session_id=keep-for-user-note',
    '- Keep this entry',
    '',
  ].join('\n'));

  const result = runNoesis([
    'launch',
    '--agent-id', 'compat-session-cleanup',
    '--role', 'coder',
    '--runtime', 'cli',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });

  assert.equal(result.stdout.includes('ok'), true);

  const currentTask = fs.readFileSync(path.join(agentHome, 'current-task.md'), 'utf8');
  const workLog = fs.readFileSync(path.join(agentHome, 'work-log.md'), 'utf8');
  const latestSession = JSON.parse(fs.readFileSync(path.join(agentHome, 'session.json'), 'utf8'));

  assert.equal(currentTask.includes('session_id'), false);
  assert.equal(currentTask.includes('Keep this line'), true);
  assert.equal(workLog.includes('11111111-1111-4111-8111-111111111111'), false);
  assert.equal(workLog.includes('session_id=keep-for-user-note'), true);
  assert.equal(workLog.includes('Keep this entry'), true);
  assert.equal(typeof latestSession.session_id, 'string');
});


test('launch enables pamem Claude runtime capability', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  const fakeClaude = makeFakeClaude(t, root);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'claude',
    '--agent-id', 'claude-local',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    '--help',
  ], {
    cwd: root,
    home,
    env: {
      PATH: `${fakeClaude.binDir}${path.delimiter}${process.env.PATH || ''}`,
      FAKE_CLAUDE_LOG: fakeClaude.logFile,
      FAKE_CLAUDE_STATE: fakeClaude.stateFile,
      FAKE_CLAUDE_INSTALL_PATH: fakeClaude.installPath,
      FAKE_CLAUDE_PLUGIN_VERSION: fakeClaude.version,
    },
  });
  const data = JSON.parse(result.stdout);
  const action = data.setup.actions.find((item) => item.phase === 'skill' && item.name === 'pamem');
  const agentHome = path.join(home, '.local', 'share', 'pamem', 'agents', 'claude-local');
  const pluginState = JSON.parse(fs.readFileSync(fakeClaude.stateFile, 'utf8'))[0];

  assert.equal(data.status, 'ok');
  assert.deepEqual(data.launch_command, ['claude', '--dangerously-skip-permissions', '--help']);
  assert.equal(action?.status, 'ok');
  assert.equal(action.report.capability.runtimes.claude.status, 'ok');
  assert.equal(action.report.capability.runtimes.claude.source, 'claude-cli');
  assert.equal(action.report.capability.runtimes.claude.scope, 'project');
  assert.equal(action.report.capability.runtimes.claude.version, '0.9.2');
  assert.equal(action.report.capability.runtimes.claude.install_path, fakeClaude.installPath);
  assert.equal(action.report.capability.runtimes.claude.project_path, agentHome);
  assert.equal(action.report.capability.runtimes.claude.standard_hook.status, 'ok');
  assert.equal(action.report.capability.runtimes.claude.standard_hook.command, '"${CLAUDE_PLUGIN_ROOT}"/scripts/memory-session-start.sh');
  assert.equal(action.report.capability.runtimes.codex.status, 'ok');
  assert.equal(pluginState.scope, 'project');
  assert.equal(pluginState.version, '0.9.2');
  assert.equal(pluginState.installPath, fakeClaude.installPath);
  assert.equal(pluginState.projectPath, agentHome);
  assert.equal(fs.existsSync(path.join(agentHome, '.claude', 'settings.json')), false);
  assert.match(fs.readFileSync(fakeClaude.logFile, 'utf8'), /plugin install pamem@phlens -s project/);
});


test('launch refreshes an already-enabled Claude pamem plugin when hook validation fails', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  const fakeClaude = makeFakeClaude(t, root);
  const agentHome = path.join(home, '.local', 'share', 'pamem', 'agents', 'claude-local');
  fs.mkdirSync(path.join(agentHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(agentHome, '.claude', 'settings.json'), JSON.stringify({
    enabledPlugins: { 'pamem@phlens': true },
  }, null, 2));
  fs.writeFileSync(fakeClaude.stateFile, JSON.stringify([{
    id: 'pamem@phlens',
    scope: 'project',
    enabled: true,
    version: '0.9.1',
    installPath: fakeClaude.installPath,
    projectPath: agentHome,
    errors: ['Hook load failed: Duplicate hooks file detected'],
  }], null, 2));
  fs.mkdirSync(home, { recursive: true });

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'claude',
    '--agent-id', 'claude-local',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--json',
    '--',
    '--help',
  ], {
    cwd: root,
    home,
    env: {
      PATH: `${fakeClaude.binDir}${path.delimiter}${process.env.PATH || ''}`,
      FAKE_CLAUDE_LOG: fakeClaude.logFile,
      FAKE_CLAUDE_STATE: fakeClaude.stateFile,
      FAKE_CLAUDE_INSTALL_PATH: fakeClaude.installPath,
      FAKE_CLAUDE_PLUGIN_VERSION: fakeClaude.version,
    },
  });
  const data = JSON.parse(result.stdout);
  const action = data.setup.actions.find((item) => item.phase === 'skill' && item.name === 'pamem');
  const pluginState = JSON.parse(fs.readFileSync(fakeClaude.stateFile, 'utf8'))[0];

  assert.equal(data.status, 'ok');
  assert.equal(action?.status, 'ok');
  assert.equal(action.report.actions[0].action, 'refreshed');
  assert.equal(action.report.actions[0].command, 'claude plugin update');
  assert.equal(action.report.capability.runtimes.claude.status, 'ok');
  assert.equal(action.report.capability.runtimes.claude.scope, 'project');
  assert.equal(action.report.capability.runtimes.claude.version, '0.9.2');
  assert.equal(action.report.capability.runtimes.claude.install_path, fakeClaude.installPath);
  assert.equal(action.report.capability.runtimes.claude.project_path, agentHome);
  assert.equal(action.report.capability.runtimes.claude.standard_hook.status, 'ok');
  assert.equal(pluginState.version, '0.9.2');
  assert.equal(pluginState.installPath, fakeClaude.installPath);
  assert.equal(pluginState.projectPath, agentHome);
  assert.equal(pluginState.errors, undefined);
  assert.match(fs.readFileSync(fakeClaude.logFile, 'utf8'), /plugin update pamem@phlens -s project/);
});


test('launch prefers bundled pamem over cloning a managed component', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const componentDir = path.join(root, 'components');
  const bundled = ensureBundledPamem(t);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'cli',
    '--agent-id', 'coder-local',
    '--with', 'pamem',
    '--component-dir', componentDir,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], {
    cwd: root,
    home,
    env: {
      NOESIS_PAMEM_REPO: path.join(root, 'missing-pamem.git'),
      NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search'),
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'bundled'), true);
  assert.equal(data.setup.components.pamem.component_source, bundled);
  assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'installed'), false);
  assert.equal(fs.existsSync(componentDir), false);
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', 'config.toml')), true);
});


test('plain launch does not require LoreForge component resolution', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const componentDir = path.join(root, 'components');
  ensureBundledPamem(t);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'cli',
    '--agent-id', 'plain-default',
    '--component-dir', componentDir,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], {
    cwd: root,
    home,
    env: {
      NOESIS_PAMEM_REPO: path.join(root, 'missing-pamem.git'),
      NOESIS_LOREFORGE_REPO: path.join(root, 'missing-LoreForge.git'),
      NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search'),
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem'), true);
  assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'loreforge'), false);
  assert.equal(data.setup.components.loreforge.enabled, false);
  assert.equal(fs.existsSync(componentDir), false);
});


test('launch --with loreforge keeps pamem enabled', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const pamem = makePamemComponent(root);
  const loreforge = makeLoreForgeComponent(root);
  fs.mkdirSync(home);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'cli',
    '--agent-id', 'coder-loreforge',
    '--with', 'loreforge',
    '--component', `pamem=${pamem}`,
    '--component', `loreforge=${loreforge}`,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.setup.components.pamem.enabled, true);
  assert.equal(data.setup.components.loreforge.enabled, true);
  assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'init'), true);
  assert.equal(data.setup.actions.some((action) => action.phase === 'skill' && action.name === 'loreforge'), true);
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-loreforge', 'config.toml')), true);
  assert.equal(fs.realpathSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-loreforge', '.codex', 'skills', 'loreforge')), path.join(loreforge, 'skills', 'loreforge'));
});


test('launch installs missing enabled components before setup', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const memory = path.join(root, 'memory');
  const componentDir = path.join(root, 'components');
  const remoteRoot = path.join(root, 'remotes');
  const pamemRemote = path.join(remoteRoot, 'pamem.git');
  fs.mkdirSync(home);
  fs.mkdirSync(remoteRoot, { recursive: true });
  const pamemSource = makePamemComponent(path.join(root, 'sources'));
  makeGitRemote(pamemSource, pamemRemote);

  const result = runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'cli',
    '--agent-id', 'coder-local',
    '--with', 'pamem',
    '--component-dir', componentDir,
    '--memory-repo', memory,
    '--json',
    '--',
    'echo',
    'ok',
  ], {
    cwd: root,
    home,
    env: {
      NOESIS_PAMEM_REPO: pamemRemote,
      NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search'),
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'runtime-not-run');
  if (fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@phlens', 'pamem', 'bin', 'pamem.mjs'))) {
    assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'bundled'), true);
    assert.equal(fs.existsSync(path.join(componentDir, 'pamem', 'bin', 'pamem.mjs')), false);
  } else {
    assert.equal(data.setup.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'installed'), true);
    assert.equal(fs.existsSync(path.join(componentDir, 'pamem', 'bin', 'pamem.mjs')), true);
  }
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', 'config.toml')), true);
});


test('launch can bind an existing Slock workspace without starting a process', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'slock-workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const pamem = makePamemComponent(root);

  const result = runNoesis([
    'launch',
    '--profile', 'researcher',
    '--runtime', 'slock',
    '--workspace', workspace,
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'warning');
  assert.equal(data.downstream_execution, 'slock-bind');
  assert.equal(data.runtime_state.runtime, 'slock');
  assert.equal(data.setup.doctor.summary.error_count, 0);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem', 'config.toml')), true);
});


test('invalid slock-only launch options fail before setup side effects', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'slock-workspace');
  const memory = path.join(root, 'memory');
  fs.mkdirSync(home);
  const pamem = makePamemComponent(root);

  const result = runNoesis([
    'launch',
    '--profile', 'researcher',
    '--runtime', 'slock',
    '--workspace', workspace,
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--memory-repo', memory,
    '--print-env',
  ], { cwd: root, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime slock does not emit CLI launcher environment/);
  assert.equal(fs.existsSync(workspace), false);
  assert.equal(fs.existsSync(memory), false);
});


test('list and remove expose Noesis runtime management surface', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const pamem = makePamemComponent(root);

  runNoesis([
    'launch',
    '--profile', 'coder',
    '--runtime', 'codex',
    '--agent-id', 'coder-local',
    '--with', 'pamem',
    '--component', `pamem=${pamem}`,
    '--json',
  ], { cwd: root, home });

  const listed = JSON.parse(runNoesis(['list', '--json'], { cwd: root, home }).stdout);
  assert.equal(listed.agents.length, 1);
  assert.equal(listed.agents[0].agent_id, 'coder-local');

  const removed = JSON.parse(runNoesis(['remove', '--agent-id', 'coder-local', '--json'], { cwd: root, home }).stdout);
  assert.equal(removed.status, 'ok');
  const agentHome = path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local');
  assert.equal(removed.actions.find((action) => action.action === 'remove-codex-hooks')?.removed, 1);
  assert.equal(removed.actions.find((action) => action.action === 'remove-codex-skill-links')?.removed.length, 2);
  assert.equal(fs.existsSync(path.join(agentHome, 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(agentHome, '.codex', 'skills', 'memory-lint')), false);
  assert.equal(fs.existsSync(path.join(agentHome, '.codex', 'skills', 'memory-rule')), false);
  const hooks = JSON.parse(fs.readFileSync(path.join(agentHome, '.codex', 'hooks.json'), 'utf8'));
  assert.deepEqual(hooks.hooks.SessionStart[0].hooks.map((hook) => hook.command), ['/custom/tools/memory-session-start.sh']);
});


test('remove is a no-op when the resolved agent home is missing', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  const removed = JSON.parse(runNoesis([
    'remove',
    '--agent-id', 'already-gone',
    '--json',
  ], { cwd: root, home }).stdout);
  const expectedHome = path.join(home, '.local', 'share', 'pamem', 'agents', 'already-gone');

  assert.equal(removed.status, 'ok');
  assert.equal(removed.workspace, expectedHome);
  assert.deepEqual(removed.actions, [{
    action: 'workspace-missing',
    status: 'skipped',
    path: expectedHome,
    reason: 'not-found',
  }]);
  assert.equal(fs.existsSync(expectedHome), false);
});


test('launch command help is available from top-level help', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  assert.match(runNoesis(['help', 'launch'], { cwd: root, home }).stdout, /Usage: noesis launch/);
  assert.match(runNoesis(['help', 'update'], { cwd: root, home }).stdout, /Usage: noesis update/);
  assert.match(runNoesis(['help', 'list'], { cwd: root, home }).stdout, /Usage: noesis list/);
  assert.match(runNoesis(['help', 'remove'], { cwd: root, home }).stdout, /Usage: noesis remove/);
  assert.match(runNoesis(['--help'], { cwd: root, home }).stdout, /noesis launch --name .* --role/);
  assert.match(runNoesis(['--help'], { cwd: root, home }).stdout, /noesis update/);
});
