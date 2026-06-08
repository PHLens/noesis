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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-update-${process.pid}-${counter}-`));
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
  fs.writeFileSync(path.join(source, 'bin', 'pamem.mjs'), '#!/usr/bin/env node\nprocess.exit(0);\n');
  fs.chmodSync(path.join(source, 'bin', 'pamem.mjs'), 0o755);
  return source;
}


function makeLoreForgeComponent(root) {
  const source = path.join(root, 'LoreForge');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(source, 'skills', 'loreforge'), { recursive: true });
  fs.writeFileSync(path.join(source, 'bin', 'loreforge'), '#!/usr/bin/env node\nprocess.exit(0);\n');
  fs.writeFileSync(path.join(source, 'skills', 'loreforge', 'SKILL.md'), '---\nname: loreforge\ndescription: test\n---\n');
  fs.chmodSync(path.join(source, 'bin', 'loreforge'), 0o755);
  return source;
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


test('update installs missing enabled components into the managed component dir', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const componentDir = path.join(root, 'components');
  const remoteRoot = path.join(root, 'remotes');
  const pamemRemote = path.join(remoteRoot, 'pamem.git');
  const loreforgeRemote = path.join(remoteRoot, 'LoreForge.git');
  fs.mkdirSync(home);
  fs.mkdirSync(remoteRoot, { recursive: true });
  makeGitRemote(makePamemComponent(path.join(root, 'sources')), pamemRemote);
  makeGitRemote(makeLoreForgeComponent(path.join(root, 'sources')), loreforgeRemote);

  const result = runNoesis([
    'update',
    '--skip-self',
    '--component-dir', componentDir,
    '--json',
  ], {
    cwd: root,
    home,
    env: {
      NOESIS_PAMEM_REPO: pamemRemote,
      NOESIS_LOREFORGE_REPO: loreforgeRemote,
      NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search'),
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.command, 'update');
  assert.equal(data.actions.some((action) => action.phase === 'noesis' && action.action === 'update-skipped' && action.reason === 'skip-self'), true);
  assert.equal(data.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'installed'), true);
  assert.equal(data.actions.some((action) => action.phase === 'component' && action.name === 'loreforge' && action.action === 'installed'), true);
  assert.equal(fs.existsSync(path.join(componentDir, 'pamem', 'bin', 'pamem.mjs')), true);
  assert.equal(fs.existsSync(path.join(componentDir, 'LoreForge', 'bin', 'loreforge')), true);
});


test('update can skip installing unresolved components', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const componentDir = path.join(root, 'components');
  fs.mkdirSync(home);

  const result = runNoesis([
    'update',
    '--skip-self',
    '--with', 'pamem',
    '--component-dir', componentDir,
    '--no-install-components',
    '--json',
  ], {
    cwd: root,
    home,
    env: { NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search') },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'warning');
  assert.equal(data.actions.some((action) => action.phase === 'component' && action.name === 'pamem' && action.action === 'missing'), true);
  assert.equal(fs.existsSync(componentDir), false);
});


test('update can repair LoreForge entry skill visibility in a workspace', (t) => {
  const root = tempRoot(t);
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const componentDir = path.join(root, 'components');
  const remoteRoot = path.join(root, 'remotes');
  const loreforgeRemote = path.join(remoteRoot, 'LoreForge.git');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  fs.mkdirSync(remoteRoot, { recursive: true });
  makeGitRemote(makeLoreForgeComponent(path.join(root, 'sources')), loreforgeRemote);

  runNoesis([
    'init',
    '--workspace', workspace,
    '--with', 'loreforge',
    '--json',
  ], {
    cwd: root,
    home,
    env: { NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search') },
  });

  const result = runNoesis([
    'update',
    '--skip-self',
    '--workspace', workspace,
    '--with', 'loreforge',
    '--component-dir', componentDir,
    '--json',
  ], {
    cwd: root,
    home,
    env: {
      NOESIS_LOREFORGE_REPO: loreforgeRemote,
      NOESIS_COMPONENT_SEARCH_DIRS: path.join(root, 'empty-search'),
    },
  });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.workspace_update.status, 'ok');
  assert.equal(data.actions.some((action) => action.phase === 'component' && action.name === 'loreforge' && action.action === 'installed'), true);
  assert.equal(data.actions.some((action) => action.phase === 'skill' && action.name === 'loreforge' && action.action === 'add'), true);
  assert.equal(fs.realpathSync(path.join(workspace, '.codex', 'skills', 'loreforge')), path.join(componentDir, 'LoreForge', 'skills', 'loreforge'));

  const config = fs.readFileSync(path.join(workspace, '.noesis', 'config.toml'), 'utf8');
  assert.match(config, /component_source = ".*LoreForge/);
  assert.match(config, /required_entry_skill_source = ".*LoreForge.*skills.*loreforge/);
});
