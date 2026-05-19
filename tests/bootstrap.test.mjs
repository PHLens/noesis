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


function tempWorkspace(t) {
  counter += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-bootstrap-${process.pid}-${counter}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}


function runNoesis(args, { cwd, check = true, env = {} }) {
  const result = spawnSync(process.execPath, [NOESIS, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (check && result.status !== 0) {
    assert.fail(`noesis failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}


function commandExists(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [command] : ['-v', command], {
    shell: process.platform !== 'win32',
    stdio: 'ignore',
  });
  return result.status === 0;
}


test('init creates only Noesis-owned bootstrap state and manifest', (t) => {
  const workspace = tempWorkspace(t);

  const result = runNoesis(['init', '--workspace', workspace, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.workspace, workspace);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'config.toml')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'promote-requests')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'proposals')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'reports')), true);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
  assert.equal(data.manifest.components.pamem.enabled, true);
  assert.equal(data.manifest.components.loreforge.enabled, commandExists('loreforge'));
  assert.equal(data.manifest.components.loreforge.required_cli, 'loreforge');
  assert.equal(data.manifest.components.loreforge.status_command, 'loreforge status --json');
  assert.equal(data.manifest.components.loreforge.validate_command, 'loreforge validate --all-domains --json');
  assert.equal(data.manifest.components.loreforge.init_command, 'loreforge init --wiki ${workspace} --domain ai-research --json');
  assert.equal(data.manifest.components.skill_manager.enabled, true);
});


test('init can disable downstream component contracts', (t) => {
  const workspace = tempWorkspace(t);

  const result = runNoesis(['init', '--workspace', workspace, '--with', 'none', '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.manifest.components.pamem.enabled, false);
  assert.equal(data.manifest.components.loreforge.enabled, false);
  assert.equal(data.manifest.components.skill_manager.enabled, true);
});


test('loreforge component stays declared but disabled when CLI is unavailable', (t) => {
  const workspace = tempWorkspace(t);

  const result = runNoesis(['init', '--workspace', workspace, '--json'], {
    cwd: workspace,
    env: { PATH: '' },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.manifest.components.loreforge.enabled, false);
  assert.equal(data.manifest.components.loreforge.required_cli, 'loreforge');
  assert.equal(data.manifest.components.loreforge.status_command, 'loreforge status --json');
  assert.equal(data.manifest.components.loreforge.validate_command, 'loreforge validate --all-domains --json');
});


test('init keeps existing manifest unless forced', (t) => {
  const workspace = tempWorkspace(t);
  runNoesis(['init', '--workspace', workspace], { cwd: workspace });
  const manifestPath = path.join(workspace, '.noesis', 'config.toml');
  fs.writeFileSync(manifestPath, '[noesis]\nschema_version = "custom"\n');

  const kept = runNoesis(['init', '--workspace', workspace, '--with', 'none', '--json'], { cwd: workspace });
  assert.equal(JSON.parse(kept.stdout).manifest.noesis.schema_version, 'custom');

  const forced = runNoesis(['init', '--workspace', workspace, '--with', 'none', '--force', '--json'], { cwd: workspace });
  assert.equal(JSON.parse(forced.stdout).manifest.noesis.schema_version, '0.1');
});


test('config show emits raw TOML or parsed JSON', (t) => {
  const workspace = tempWorkspace(t);
  runNoesis(['init', '--workspace', workspace], { cwd: workspace });

  const raw = runNoesis(['config', 'show', '--workspace', workspace], { cwd: workspace });
  assert.match(raw.stdout, /\[noesis\]/);
  assert.match(raw.stdout, /\[components\.pamem\]/);

  const json = runNoesis(['config', 'show', '--workspace', workspace, '--json'], { cwd: workspace });
  const data = JSON.parse(json.stdout);
  assert.equal(data.manifest.noesis.schema_version, '0.1');
  assert.equal(data.manifest.paths.proposals, '.noesis/proposals');
});


test('doctor is read-only and reports missing downstream readiness as warnings', (t) => {
  const workspace = tempWorkspace(t);
  runNoesis(['init', '--workspace', workspace, '--with', 'none'], { cwd: workspace });
  const before = new Set(fs.readdirSync(workspace));

  const result = runNoesis(['doctor', '--workspace', workspace, '--json'], { cwd: workspace, check: false, env: { PATH: '' } });
  const data = JSON.parse(result.stdout);
  const after = new Set(fs.readdirSync(workspace));

  assert.equal(result.status, 0);
  assert.equal(data.status, 'warning');
  assert.equal(data.summary.error_count, 0);
  assert.equal([...before].sort().join(','), [...after].sort().join(','));
  assert.ok(data.checks.find((item) => item.id === 'component.pamem.enabled' && item.message.includes('disabled')));
  assert.ok(data.checks.find((item) => item.id === 'component.loreforge.enabled' && item.message.includes('disabled')));
});


test('doctor fails when manifest is missing', (t) => {
  const workspace = tempWorkspace(t);

  const result = runNoesis(['doctor', '--workspace', workspace, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.summary.error_count, 1);
  assert.equal(data.checks[0].id, 'manifest.exists');
});


test('doctor runs declared read-only component status and validate commands', (t) => {
  const workspace = tempWorkspace(t);
  const binDir = path.join(workspace, 'bin');
  fs.mkdirSync(binDir);
  const component = path.join(binDir, process.platform === 'win32' ? 'component.cmd' : 'component');
  fs.writeFileSync(
    component,
    process.platform === 'win32'
      ? '@echo off\r\necho {"status":"ok","component":"fake"}\r\n'
      : '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"ok","component":"fake"}\'\n',
  );
  fs.chmodSync(component, 0o755);
  runNoesis(['init', '--workspace', workspace, '--with', 'none'], { cwd: workspace });
  const manifestPath = path.join(workspace, '.noesis', 'config.toml');
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace('enabled = false', 'enabled = true');
  manifest = manifest.replace('required_cli = "pamem"', 'required_cli = "component"');
  manifest = manifest.replace('status_command = "pamem status --workspace ${workspace} --json"', 'status_command = "component status --json"');
  manifest = manifest.replace('validate_command = "pamem lint --workspace ${workspace} --json"', 'validate_command = "component validate --json"');
  fs.writeFileSync(manifestPath, manifest);

  const result = runNoesis(['doctor', '--workspace', workspace, '--json'], {
    cwd: workspace,
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.checks.find((item) => item.id === 'component.pamem.status').envelope.status, 'ok');
  assert.equal(data.checks.find((item) => item.id === 'component.pamem.validate').envelope.component, 'fake');
});


test('doctor accepts skill-manager status command envelope', (t) => {
  const workspace = tempWorkspace(t);
  runNoesis(['init', '--workspace', workspace, '--with', 'none'], { cwd: workspace });
  runNoesis(['skill', 'add', 'noesis-skill-manager', '--workspace', workspace], { cwd: workspace });

  const result = runNoesis(['doctor', '--workspace', workspace, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(data.status, 'ok');
  const statusCheck = data.checks.find((item) => item.id === 'component.skill_manager.status');
  assert.equal(statusCheck.status, 'ok');
  assert.equal(statusCheck.envelope.status, 'ok');
  assert.equal(statusCheck.envelope.command, 'skill list');
});


test('bootstrap command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'init'], { cwd: workspace }).stdout, /Usage: noesis init/);
  assert.match(runNoesis(['help', 'doctor'], { cwd: workspace }).stdout, /Usage: noesis doctor/);
  assert.match(runNoesis(['help', 'config'], { cwd: workspace }).stdout, /Usage: noesis config show/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis doctor --workspace/);
});
