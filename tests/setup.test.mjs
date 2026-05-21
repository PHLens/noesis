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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-setup-${process.pid}-${counter}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}


function runNoesis(args, { cwd, home, env = {}, check = true }) {
  const result = spawnSync(process.execPath, [NOESIS, ...args], {
    cwd,
    env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, '.local', 'share'), ...env },
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
const [command, ...args] = process.argv.slice(2);
const workspace = args[0] || process.cwd();
if (command === 'install') {
  fs.mkdirSync(path.join(workspace, '.codex', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.pamem', 'config.toml'), 'default_profile = "coder"\\n');
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current\\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work\\n');
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\\nhooks = true\\n');
  fs.writeFileSync(path.join(workspace, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: '.pamem/scripts/memory-session-start.sh' }] }] } }, null, 2));
  fs.symlinkSync(path.relative(path.join(workspace, '.codex', 'skills'), path.join(process.cwd(), 'skills', 'memory-lint')), path.join(workspace, '.codex', 'skills', 'memory-lint'));
  fs.symlinkSync(path.relative(path.join(workspace, '.codex', 'skills'), path.join(process.cwd(), 'skills', 'memory-rule')), path.join(workspace, '.codex', 'skills', 'memory-rule'));
  process.exit(0);
}
if (command === 'setup') {
  const profileIndex = args.indexOf('--profile');
  const runtimeIndex = args.indexOf('--runtime');
  if (profileIndex === -1 || runtimeIndex === -1) process.exit(3);
  fs.mkdirSync(path.join(workspace, '.codex', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.pamem'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.pamem', 'config.toml'), 'default_profile = "' + args[profileIndex + 1] + '"\\n[runtime]\\nmode = "' + args[runtimeIndex + 1] + '"\\n');
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), '# Memory\\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'current-task.md'), '# Current\\n');
  fs.writeFileSync(path.join(workspace, 'notes', 'work-log.md'), '# Work\\n');
  fs.writeFileSync(path.join(workspace, '.codex', 'config.toml'), '[features]\\nhooks = true\\n');
  fs.writeFileSync(path.join(workspace, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: '.pamem/scripts/memory-session-start.sh' }] }] } }, null, 2));
  fs.symlinkSync(path.relative(path.join(workspace, '.codex', 'skills'), path.join(process.cwd(), 'skills', 'memory-lint')), path.join(workspace, '.codex', 'skills', 'memory-lint'));
  fs.symlinkSync(path.relative(path.join(workspace, '.codex', 'skills'), path.join(process.cwd(), 'skills', 'memory-rule')), path.join(workspace, '.codex', 'skills', 'memory-rule'));
  if (args.includes('--json')) {
    console.log(JSON.stringify({ status: 'ok', command: 'setup', downstream_execution: 'pamem-onboard', profile: args[profileIndex + 1], runtime: args[runtimeIndex + 1] }));
  }
  process.exit(0);
}
if (command === 'status') {
  console.log(JSON.stringify({ status: 'ok', root: workspace, runtime: 'cli' }));
  process.exit(0);
}
if (command === 'lint') {
  console.log(JSON.stringify({ status: 'ok', error_count: 0, warning_count: 0 }));
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
import fs from 'node:fs';
import path from 'node:path';
const [command, ...args] = process.argv.slice(2);
function value(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}
if (command === 'setup') {
  const wiki = value('--wiki');
  const domain = value('--domain');
  const registry = value('--registry');
  if (!wiki || !domain) process.exit(3);
  fs.mkdirSync(path.join(wiki, 'Domains', domain), { recursive: true });
  fs.writeFileSync(path.join(wiki, 'Domains', domain, 'index.md'), '# Domain\\n');
  if (registry) {
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(registry, 'default = "main"\\n');
  }
  console.log(JSON.stringify({
    component: 'loreforge',
    operation: 'setup',
    ok: true,
    selected_wiki: { name: 'main', path: wiki, default_domain: domain },
    domain: { name: domain, path: path.join(wiki, 'Domains', domain) },
    writes: [{ kind: 'directory', path: wiki }],
    preserved: [],
    sync: { executed: false },
    validation: { ok: true, issues: [] },
  }));
  process.exit(0);
}
if (command === 'status' || command === 'validate' || command === 'init') {
  console.log(JSON.stringify({ status: 'ok', ok: true, operation: command }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(path.join(source, 'bin', 'loreforge'), 0o755);
  return source;
}


test('setup bootstraps Noesis skills and local owner components', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const pamem = makePamemComponent(root);
  const loreforge = makeLoreForgeComponent(root);

  const result = runNoesis([
    'setup',
    '--workspace', workspace,
    '--profile', 'coder',
    '--component', `pamem=${pamem}`,
    '--component', `loreforge=${loreforge}`,
    '--json',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.doctor.status, 'ok');
  assert.equal(data.doctor.summary.warning_count, 0);
  assert.equal(data.doctor.readiness.status, 'ok');
  assert.equal(data.doctor.readiness.sections.noesis.status, 'ok');
  assert.equal(data.doctor.readiness.sections.entry_skills.status, 'ok');
  assert.equal(data.doctor.readiness.sections.pamem.status, 'ok');
  assert.equal(data.doctor.readiness.sections.loreforge.status, 'ok');
  assert.equal(data.doctor.readiness.sections.skill_manager.status, 'ok');
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'skills', 'heuristic-intake')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'skills', 'noesis-skill-manager')), true);
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', 'loreforge')), path.join(loreforge, 'skills', 'loreforge'));
  assert.equal(fs.existsSync(path.join(workspace, '.pamem', 'config.toml')), true);

  const config = fs.readFileSync(path.join(workspace, '.noesis', 'config.toml'), 'utf8');
  assert.match(config, /component_source = ".*pamem/);
  assert.match(config, /init_command = ".*pamem\.mjs/);
  assert.equal(config.includes("setup ${workspace} --profile 'coder' --runtime 'cli' --json"), true);
  assert.match(config, /required_entry_skill_source = ".*LoreForge.*skills.*loreforge/);
});


test('setup can run LoreForge owner setup when wiki and domain are provided', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const wiki = path.join(root, 'wiki');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const loreforge = makeLoreForgeComponent(root);

  const result = runNoesis([
    'setup',
    '--workspace', workspace,
    '--with', 'loreforge',
    '--component', `loreforge=${loreforge}`,
    '--loreforge-wiki', wiki,
    '--loreforge-domain', 'research',
    '--json',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.doctor.status, 'ok');
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', 'loreforge')), path.join(loreforge, 'skills', 'loreforge'));
  assert.equal(fs.existsSync(path.join(wiki, 'Domains', 'research', 'index.md')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'loreforge', 'registry.toml')), true);
  assert.equal(fs.existsSync(path.join(home, '.config', 'loreforge', 'registry.toml')), false);

  const config = fs.readFileSync(path.join(workspace, '.noesis', 'config.toml'), 'utf8');
  const registry = path.join(workspace, '.noesis', 'loreforge', 'registry.toml');
  assert.equal(config.includes(`setup --wiki '${wiki}' --domain 'research' --registry '${registry}' --json`), true);
  assert.equal(config.includes(`status --registry '${registry}' --wiki-name 'main' --json`), true);
  assert.equal(config.includes(`validate --registry '${registry}' --wiki '${wiki}' --all-domains --json`), true);
  assert.equal(data.actions.some((action) => action.phase === 'component' && action.name === 'loreforge'), true);
});


test('setup can use an explicit LoreForge registry path', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const wiki = path.join(root, 'wiki');
  const registry = path.join(root, 'registries', 'loreforge.toml');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const loreforge = makeLoreForgeComponent(root);

  const result = runNoesis([
    'setup',
    '--workspace', workspace,
    '--with', 'loreforge',
    '--component', `loreforge=${loreforge}`,
    '--loreforge-wiki', wiki,
    '--loreforge-domain', 'research',
    '--loreforge-registry', registry,
    '--json',
  ], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(fs.existsSync(registry), true);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'loreforge', 'registry.toml')), false);

  const config = fs.readFileSync(path.join(workspace, '.noesis', 'config.toml'), 'utf8');
  assert.equal(config.includes(`setup --wiki '${wiki}' --domain 'research' --registry '${registry}' --json`), true);
  assert.equal(config.includes(`status --registry '${registry}' --wiki-name 'main' --json`), true);
  assert.equal(config.includes(`validate --registry '${registry}' --wiki '${wiki}' --all-domains --json`), true);
});


test('setup requires explicit LoreForge component source for LoreForge bootstrap', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const result = runNoesis([
    'setup',
    '--workspace', workspace,
    '--with', 'loreforge',
    '--loreforge-wiki', path.join(root, 'wiki'),
    '--loreforge-domain', 'research',
    '--json',
  ], { cwd: root, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /LoreForge setup requires --component loreforge=/);
});


test('setup requires explicit profile when pamem is enabled', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const result = runNoesis(['setup', '--workspace', workspace, '--json'], { cwd: root, home, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /setup with pamem requires --profile/);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
});


test('setup can bootstrap only Noesis entry skills', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);

  const result = runNoesis(['setup', '--workspace', workspace, '--with', 'none', '--json'], { cwd: root, home });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.doctor.status, 'ok');
  assert.equal(fs.existsSync(path.join(workspace, '.codex', 'skills', 'heuristic-intake')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.claude', 'skills', 'noesis-skill-manager')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
});


test('setup command help is available at command position', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  const result = runNoesis(['setup', '--help'], { cwd: root, home });

  assert.match(result.stdout, /Usage: noesis setup/);
  assert.match(result.stdout, /--profile <role>/);
});
