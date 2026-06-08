import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { manifestPath, readManifest, serializeManifest } from './bootstrap.mjs';
import { parseComponents, resolveSetupComponents, runDoctor, runSkillAdd } from './setup.mjs';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


export class UpdateError extends Error {}


export function printUpdateUsage() {
  console.log(`Usage: noesis update [options]

Update Noesis-managed local tooling. This is the user-facing update surface for
Noesis, pamem, and LoreForge: Noesis updates itself when it is a git checkout,
then resolves enabled pamem/LoreForge components through the same resolver used
by launch/setup, installs missing enabled components into --component-dir, and
fast-forwards resolved git checkouts.

Options:
  --workspace <path>            Repair Noesis/LoreForge entry skill links in this workspace after updating.
  --with <list>                 Comma-separated components: pamem,loreforge or none.
  --component <name=path>       Local component repo/source, e.g. pamem=/path/to/pamem.
  --component-dir <path>        Directory for discovered/installed component checkouts.
                                Defaults to XDG_DATA_HOME/noesis/components.
  --install-components          Install missing enabled components. Enabled by default.
  --no-install-components       Only update already resolved component checkouts.
  --skip-self                   Do not update the Noesis checkout itself.
  --json                        Print machine-readable JSON.

Examples:
  noesis update
  noesis update --with pamem,loreforge
  noesis update --component pamem=/path/to/pamem --component loreforge=/path/to/LoreForge
  noesis update --component-dir ~/.local/share/noesis/components`);
}


export function runUpdateCommand(tokens, options = {}) {
  const args = parseUpdateArgs(tokens);
  const components = parseComponents(args.withComponents);
  resolveSetupComponents(components, {
    componentSources: args.componentSources,
    componentDir: args.componentDir,
    installComponents: false,
    updateComponents: false,
  }, { recordMissing: true });

  const actions = [];

  if (args.updateSelf) actions.push(updateSelf());
  else actions.push({ phase: 'noesis', action: 'update-skipped', status: 'skipped', path: REPO_ROOT, reason: 'skip-self' });

  const resolution = resolveSetupComponents(components, {
    componentSources: args.componentSources,
    componentDir: args.componentDir,
    installComponents: args.installComponents,
    updateComponents: true,
  }, { recordMissing: true });
  actions.push(...resolution.actions);

  const report = {
    status: 'ok',
    command: 'update',
    downstream_execution: 'update-local-tooling',
    noesis: {
      root: REPO_ROOT,
      updated: actions.some((action) => action.phase === 'noesis' && action.action === 'updated'),
    },
    component_dir: resolution.component_dir,
    components: Object.fromEntries(Object.entries(resolution.sources).map(([name, source]) => [name, {
      root: source.root,
      command: source.cli_command,
    }])),
    actions,
  };
  if (args.workspace) report.workspace_update = repairWorkspace(args.workspace, components, resolution.sources, actions);
  report.status = actionStatus(actions);

  if (options.print !== false) printReport(report, args.json);
  return report.status === 'failed' ? 1 : 0;
}


function parseUpdateArgs(tokens) {
  const args = {
    withComponents: null,
    workspace: null,
    componentSources: [],
    componentDir: null,
    installComponents: true,
    updateSelf: true,
    json: false,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--with') {
      args.withComponents = requireValue(tokens, ++index, '--with');
    } else if (token.startsWith('--with=')) {
      args.withComponents = token.slice('--with='.length);
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--component') {
      args.componentSources.push(requireValue(tokens, ++index, '--component'));
    } else if (token.startsWith('--component=')) {
      args.componentSources.push(token.slice('--component='.length));
    } else if (token === '--component-dir') {
      args.componentDir = requireValue(tokens, ++index, '--component-dir');
    } else if (token.startsWith('--component-dir=')) {
      args.componentDir = token.slice('--component-dir='.length);
    } else if (token === '--install-components') {
      args.installComponents = true;
    } else if (token === '--no-install-components') {
      args.installComponents = false;
    } else if (token === '--skip-self') {
      args.updateSelf = false;
    } else if (token === '--json') {
      args.json = true;
    } else if (token.startsWith('-')) {
      throw new UpdateError(`unknown update option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length > 0) throw new UpdateError(`unexpected update argument: ${positionals[0]}`);
  return args;
}


function repairWorkspace(workspaceValue, components, sources, actions) {
  const workspace = path.resolve(expandPath(workspaceValue));
  const file = manifestPath(workspace);
  if (!fs.existsSync(file)) {
    actions.push({
      phase: 'workspace',
      action: 'repair-skipped',
      status: 'skipped',
      path: workspace,
      reason: 'no-noesis-manifest',
    });
    return { status: 'skipped', workspace, reason: 'no-noesis-manifest' };
  }

  const manifest = readManifest(file);
  updateManifestComponentSources(manifest, components, sources);
  fs.writeFileSync(file, `${serializeManifest(manifest)}\n`);
  actions.push({ phase: 'workspace', action: 'manifest-updated', status: 'ok', path: file });

  const workspaceActions = [];
  const noesisSkill = manifest.noesis?.entry_skill;
  if (noesisSkill) workspaceActions.push(runSkillAdd(workspace, noesisSkill));

  const skillManager = manifest.components?.skill_manager;
  if (skillManager?.enabled !== false && skillManager?.required_entry_skill) {
    workspaceActions.push(runSkillAdd(workspace, skillManager.required_entry_skill));
  }

  const loreforge = manifest.components?.loreforge;
  if (components.includes('loreforge') && sources.loreforge?.skill_source && loreforge?.enabled !== false) {
    workspaceActions.push(runSkillAdd(workspace, loreforge.required_entry_skill || 'loreforge', {
      source: sources.loreforge.skill_source,
    }));
  }

  actions.push(...workspaceActions);
  const doctor = runDoctor(workspace);
  actions.push({ phase: 'workspace', action: 'doctor-ran', status: doctor.status, path: workspace, summary: doctor.summary });
  return {
    status: doctor.status,
    workspace,
    manifest: file,
    actions: workspaceActions,
    doctor,
  };
}


function updateManifestComponentSources(manifest, components, sources) {
  if (components.includes('pamem') && sources.pamem && manifest.components?.pamem) {
    Object.assign(manifest.components.pamem, {
      enabled: true,
      component_source: sources.pamem.root,
      required_cli: sources.pamem.cli_command,
      status_command: sources.pamem.status_command,
      validate_command: sources.pamem.validate_command,
    });
  }

  if (components.includes('loreforge') && sources.loreforge && manifest.components?.loreforge) {
    Object.assign(manifest.components.loreforge, {
      enabled: true,
      component_source: sources.loreforge.root,
      required_cli: sources.loreforge.cli_command,
      required_entry_skill: manifest.components.loreforge.required_entry_skill || 'loreforge',
      required_entry_skill_source: sources.loreforge.skill_source,
      init_command: sources.loreforge.init_command,
    });
  }
}


function updateSelf() {
  if (!fs.existsSync(path.join(REPO_ROOT, '.git'))) {
    return {
      phase: 'noesis',
      action: 'update-skipped',
      status: 'skipped',
      path: REPO_ROOT,
      reason: 'not-a-git-checkout',
    };
  }
  const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (upstream.status !== 0) {
    return {
      phase: 'noesis',
      action: 'update-skipped',
      status: 'skipped',
      path: REPO_ROOT,
      reason: 'no-upstream',
    };
  }
  const result = runGitCommand(['pull', '--ff-only'], REPO_ROOT, 'update noesis');
  return {
    phase: 'noesis',
    action: 'updated',
    status: 'ok',
    path: REPO_ROOT,
    stdout: result.stdout.trim(),
  };
}


function actionStatus(actions) {
  if (actions.some((action) => action.status === 'failed')) return 'failed';
  if (actions.some((action) => action.status === 'missing' || action.status === 'warning')) return 'warning';
  return 'ok';
}


function runGitCommand(args, cwd, label) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new UpdateError(`failed to ${label}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new UpdateError(`failed to ${label}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}


function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Noesis update: ${report.status}`);
  console.log(`Noesis: ${report.noesis.root}`);
  console.log(`Components: ${report.component_dir}`);
  for (const action of report.actions) {
    console.log(`- ${action.phase}: ${action.action}${action.name ? ` ${action.name}` : ''}${action.status ? ` (${action.status})` : ''}`);
  }
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) throw new UpdateError(`missing value for ${option}`);
  return value;
}


function expandPath(value) {
  let expanded = String(value);
  if (expanded === '~') expanded = process.env.HOME || '';
  else if (expanded.startsWith('~/')) expanded = path.join(process.env.HOME || '', expanded.slice(2));
  if (!path.isAbsolute(expanded)) expanded = path.join(process.cwd(), expanded);
  return path.resolve(expanded);
}
