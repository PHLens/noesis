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
  fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), '[features]\\nhooks = true\\n');
  fs.writeFileSync(path.join(root, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [
    { type: 'command', command: agentHome ? repoRoot + '/scripts/memory-session-start.sh' : '.pamem/scripts/memory-session-start.sh' },
    { type: 'command', command: '/custom/tools/memory-session-start.sh' }
  ] }] } }, null, 2));
  fs.mkdirSync(agentHome ? root : path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(agentHome ? path.join(root, 'current-task.md') : path.join(root, 'notes', 'current-task.md'), '# Current\\n');
  fs.writeFileSync(agentHome ? path.join(root, 'work-log.md') : path.join(root, 'notes', 'work-log.md'), '# Work\\n');
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
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'pamem', 'agents', 'coder-local', '.noesis', 'config.toml')), true);
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


test('launch command help is available from top-level help', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  assert.match(runNoesis(['help', 'launch'], { cwd: root, home }).stdout, /Usage: noesis launch/);
  assert.match(runNoesis(['help', 'list'], { cwd: root, home }).stdout, /Usage: noesis list/);
  assert.match(runNoesis(['help', 'remove'], { cwd: root, home }).stdout, /Usage: noesis remove/);
  assert.match(runNoesis(['--help'], { cwd: root, home }).stdout, /noesis launch --profile/);
});
