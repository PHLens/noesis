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
