import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildManifest, manifestPath, readManifest, serializeManifest } from './bootstrap.mjs';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOESIS_BIN_DIR = path.join(REPO_ROOT, 'bin');
const PAMEM_DEP_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pamem.cmd' : 'pamem');
const DEFAULT_COMPONENTS = ['pamem', 'loreforge'];
const PAMEM_PROFILES = ['onboarding', 'coder', 'reviewer', 'researcher', 'wiki'];
const PAMEM_RUNTIMES = ['cli', 'slock'];


export class SetupError extends Error {}


export function printSetupUsage() {
  console.log(`Usage: noesis setup [--workspace <path>] [--with <components>] --profile <role> [options]

One-step local HS workspace bootstrap. This command runs Noesis init, installs
required Noesis entry skills, wires local pamem/LoreForge component sources
when provided, intentionally onboards the pamem workspace when pamem is enabled,
installs the LoreForge entry skill when a local source is provided, and finishes
with doctor.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --with <list>                 Comma-separated components: pamem,loreforge or none.
  --component <name=path>       Local component repo/source, e.g. pamem=/path/to/pamem.
  --profile <role>              Pamem profile: onboarding,coder,reviewer,researcher,wiki.
                                Required when pamem is enabled.
  --pamem-runtime <cli|slock>   Pamem runtime binding. Defaults to cli.
  --agent-id <id>               Pamem agent id to write into the runtime config.
  --memory-repo <path>          Pamem shared memory repo path.
  --sync-remote <target>        Pamem memory_repo.sync remote value.
  --sync-ref <ref>              Pamem memory_repo.sync ref value.
  --git-author-name <name>      Pamem memory repo git author name.
  --git-author-email <email>    Pamem memory repo git author email.
  --force                       Overwrite existing Noesis manifest and pamem config.
  --json                        Print machine-readable JSON.

Examples:
  noesis setup --workspace /path/to/ws --profile coder
  noesis setup --workspace /path/to/ws --profile wiki --component pamem=/path/to/pamem --component loreforge=/path/to/LoreForge
  noesis setup --workspace /path/to/ws --with none`);
}


export function runSetupCommand(tokens, options = {}) {
  const args = parseSetupArgs(tokens);
  const workspace = resolveWorkspace(args.workspace);
  const components = parseComponents(args.withComponents);
  validatePamemSetupOptions(components, args);
  const componentSources = resolveComponentSources(args.componentSources);
  const actions = [];

  fs.mkdirSync(workspace, { recursive: true });

  const initReport = runInit(workspace, components, args.force, options.version || '0.1.0');
  actions.push(...initReport.actions.map((action) => ({ phase: 'init', ...action })));

  const manifest = mergeComponentSources(
    buildManifest({ workspace, enabled: components, version: options.version || '0.1.0' }),
    componentSources,
  );
  writeManifest(workspace, manifest);
  actions.push({ phase: 'manifest', action: 'wrote', path: manifestPath(workspace) });

  actions.push(runSkillAdd(workspace, 'heuristic-intake'));
  actions.push(runSkillAdd(workspace, 'noesis-skill-manager'));

  if (components.includes('pamem')) {
    const pamem = componentSources.pamem || defaultPamemComponent();
    const initCommand = pamemOnboardCommand(pamem.cli_command, args);
    manifest.components.pamem.init_command = initCommand;
    writeManifest(workspace, manifest);
    actions.push(runComponentInit(workspace, 'pamem', initCommand));
  }
  if (components.includes('loreforge') && componentSources.loreforge?.skill_source) {
    actions.push(runSkillAdd(workspace, 'loreforge', { source: componentSources.loreforge.skill_source }));
  }

  const doctor = runDoctor(workspace);
  actions.push({ phase: 'doctor', action: 'ran', status: doctor.status, summary: doctor.summary });

  const report = {
    status: doctor.status === 'failed' ? 'failed' : 'ok',
    workspace,
    config_path: manifestPath(workspace),
    downstream_execution: 'setup-local-components',
    components: manifest.components,
    actions,
    doctor,
  };

  printReport(report, args.json);
  return report.status === 'failed' ? 1 : 0;
}


function parseSetupArgs(tokens) {
  const args = {
    workspace: null,
    withComponents: null,
    componentSources: [],
    profile: null,
    pamemRuntime: 'cli',
    agentId: null,
    memoryRepo: null,
    syncRemote: null,
    syncRef: null,
    gitAuthorName: null,
    gitAuthorEmail: null,
    force: false,
    json: false,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--with') {
      args.withComponents = requireValue(tokens, ++index, '--with');
    } else if (token.startsWith('--with=')) {
      args.withComponents = token.slice('--with='.length);
    } else if (token === '--component') {
      args.componentSources.push(requireValue(tokens, ++index, '--component'));
    } else if (token.startsWith('--component=')) {
      args.componentSources.push(token.slice('--component='.length));
    } else if (token === '--profile') {
      args.profile = requireValue(tokens, ++index, '--profile');
    } else if (token.startsWith('--profile=')) {
      args.profile = token.slice('--profile='.length);
    } else if (token === '--pamem-runtime') {
      args.pamemRuntime = requireValue(tokens, ++index, '--pamem-runtime');
    } else if (token.startsWith('--pamem-runtime=')) {
      args.pamemRuntime = token.slice('--pamem-runtime='.length);
    } else if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
    } else if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
    } else if (token === '--memory-repo') {
      args.memoryRepo = requireValue(tokens, ++index, '--memory-repo');
    } else if (token.startsWith('--memory-repo=')) {
      args.memoryRepo = token.slice('--memory-repo='.length);
    } else if (token === '--sync-remote') {
      args.syncRemote = requireValue(tokens, ++index, '--sync-remote');
    } else if (token.startsWith('--sync-remote=')) {
      args.syncRemote = token.slice('--sync-remote='.length);
    } else if (token === '--sync-ref') {
      args.syncRef = requireValue(tokens, ++index, '--sync-ref');
    } else if (token.startsWith('--sync-ref=')) {
      args.syncRef = token.slice('--sync-ref='.length);
    } else if (token === '--git-author-name') {
      args.gitAuthorName = requireValue(tokens, ++index, '--git-author-name');
    } else if (token.startsWith('--git-author-name=')) {
      args.gitAuthorName = token.slice('--git-author-name='.length);
    } else if (token === '--git-author-email') {
      args.gitAuthorEmail = requireValue(tokens, ++index, '--git-author-email');
    } else if (token.startsWith('--git-author-email=')) {
      args.gitAuthorEmail = token.slice('--git-author-email='.length);
    } else if (token === '--force') {
      args.force = true;
    } else if (token === '--json') {
      args.json = true;
    } else if (token.startsWith('-')) {
      throw new SetupError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length > 0) throw new SetupError(`unexpected argument: ${positionals[0]}`);
  if (!PAMEM_RUNTIMES.includes(args.pamemRuntime)) throw new SetupError(`unsupported pamem runtime: ${args.pamemRuntime}`);
  if ((args.gitAuthorName && !args.gitAuthorEmail) || (!args.gitAuthorName && args.gitAuthorEmail)) {
    throw new SetupError('--git-author-name and --git-author-email must be provided together');
  }
  return args;
}


function parseComponents(value) {
  if (!value) return DEFAULT_COMPONENTS;
  if (value === 'none') return [];
  const components = value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const component of components) {
    if (!DEFAULT_COMPONENTS.includes(component)) throw new SetupError(`unsupported component in --with: ${component}`);
  }
  return [...new Set(components)];
}


function validatePamemSetupOptions(components, args) {
  if (!components.includes('pamem')) return;
  if (!args.profile) {
    throw new SetupError('setup with pamem requires --profile <onboarding|coder|reviewer|researcher|wiki>; use --with none or --with loreforge to skip pamem');
  }
  if (!PAMEM_PROFILES.includes(args.profile)) throw new SetupError(`unsupported pamem profile: ${args.profile}`);
}


function resolveComponentSources(values) {
  const result = {};
  for (const value of values) {
    const splitAt = value.indexOf('=');
    if (splitAt <= 0) throw new SetupError(`component source must be name=path: ${value}`);
    const name = value.slice(0, splitAt);
    const root = expandPath(value.slice(splitAt + 1));
    if (!DEFAULT_COMPONENTS.includes(name)) throw new SetupError(`unsupported component source: ${name}`);
    requireDirectory(root, `${name} component source`);
    result[name] = componentSource(name, root);
  }
  return result;
}


function componentSource(name, root) {
  if (name === 'pamem') {
    const bin = path.join(root, 'bin', 'pamem.mjs');
    if (!fs.existsSync(bin)) throw new SetupError(`pamem component source missing bin/pamem.mjs: ${root}`);
    return {
      root,
      cli_command: `${process.execPath} ${shellQuote(bin)}`,
      status_command: `${process.execPath} ${shellQuote(bin)} status --workspace \${workspace} --json`,
      validate_command: `${process.execPath} ${shellQuote(bin)} lint --workspace \${workspace} --json`,
    };
  }

  const bin = path.join(root, 'bin', 'loreforge');
  const skill = path.join(root, 'skills', 'loreforge');
  if (!fs.existsSync(bin)) throw new SetupError(`loreforge component source missing bin/loreforge: ${root}`);
  if (!fs.existsSync(path.join(skill, 'SKILL.md'))) throw new SetupError(`loreforge component source missing skills/loreforge/SKILL.md: ${root}`);
  return {
    root,
    cli_command: `${process.execPath} ${shellQuote(bin)}`,
    skill_source: skill,
    status_command: `${process.execPath} ${shellQuote(bin)} status --json`,
    validate_command: `${process.execPath} ${shellQuote(bin)} validate --all-domains --json`,
    init_command: `${process.execPath} ${shellQuote(bin)} init --wiki \${workspace} --domain ai-research --json`,
  };
}


function defaultPamemComponent() {
  const command = fs.existsSync(PAMEM_DEP_BIN) ? shellQuote(PAMEM_DEP_BIN) : 'pamem';
  return {
    cli_command: command,
    status_command: `${command} status --workspace \${workspace} --json`,
    validate_command: `${command} lint --workspace \${workspace} --json`,
  };
}


function mergeComponentSources(manifest, sources) {
  const output = structuredClone(manifest);

  if (sources.pamem) {
    Object.assign(output.components.pamem, {
      component_source: sources.pamem.root,
      required_cli: sources.pamem.cli_command,
      status_command: sources.pamem.status_command,
      validate_command: sources.pamem.validate_command,
    });
  }

  if (sources.loreforge) {
    Object.assign(output.components.loreforge, {
      enabled: true,
      component_source: sources.loreforge.root,
      required_cli: sources.loreforge.cli_command,
      required_entry_skill_source: sources.loreforge.skill_source,
      init_command: sources.loreforge.init_command,
      status_command: '',
      validate_command: '',
    });
  }

  return output;
}


function pamemOnboardCommand(command, args) {
  const parts = [
    command,
    'onboard',
    '${workspace}',
    '--profile',
    shellQuote(args.profile),
    '--runtime',
    shellQuote(args.pamemRuntime),
  ];
  if (args.agentId) parts.push('--agent-id', shellQuote(args.agentId));
  if (args.memoryRepo) parts.push('--memory-repo', shellQuote(expandPath(args.memoryRepo)));
  if (args.syncRemote) parts.push('--sync-remote', shellQuote(args.syncRemote));
  if (args.syncRef) parts.push('--sync-ref', shellQuote(args.syncRef));
  if (args.gitAuthorName) parts.push('--git-author-name', shellQuote(args.gitAuthorName));
  if (args.gitAuthorEmail) parts.push('--git-author-email', shellQuote(args.gitAuthorEmail));
  if (args.force) parts.push('--force');
  return parts.join(' ');
}


function runInit(workspace, components, force, version) {
  const args = ['init', '--workspace', workspace, '--with', components.length > 0 ? components.join(',') : 'none', '--json'];
  if (force) args.push('--force');
  const result = runNoesis(args, workspace);
  return parseJsonOutput(result.stdout, 'noesis init');
}


function writeManifest(workspace, manifest) {
  fs.mkdirSync(path.dirname(manifestPath(workspace)), { recursive: true });
  fs.writeFileSync(manifestPath(workspace), `${serializeManifest(manifest)}\n`);
  readManifest(manifestPath(workspace));
}


function runSkillAdd(workspace, name, options = {}) {
  const args = ['skill', 'add', name, '--workspace', workspace, '--json'];
  if (options.source) args.push('--source', options.source);
  if (name === 'pamem') args.push('--runtime', options.runtime || 'codex');
  const result = runNoesis(args, workspace);
  return {
    phase: 'skill',
    action: 'add',
    name,
    status: 'ok',
    report: parseJsonOutput(result.stdout, `noesis skill add ${name}`),
  };
}


function runComponentInit(workspace, name, commandLine) {
  const result = runShellCommand(resolveCommand(commandLine, workspace), workspace);
  return {
    phase: 'component',
    action: 'init',
    name,
    status: 'ok',
    command: commandLine,
    stdout: result.stdout.trim(),
  };
}


function runDoctor(workspace) {
  const result = runNoesis(['doctor', '--workspace', workspace, '--json'], workspace, { check: false });
  return parseJsonOutput(result.stdout, 'noesis doctor');
}


function runShellCommand(commandLine, workspace) {
  const result = spawnSync(commandLine, [], {
    cwd: workspace,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${NOESIS_BIN_DIR}${path.delimiter}${process.env.PATH || ''}`,
    },
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new SetupError(`failed to run ${commandLine}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SetupError(`command failed (${commandLine})${detail ? `: ${detail}` : ''}`);
  }
  return result;
}


function runNoesis(args, workspace, options = {}) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'noesis'), ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${NOESIS_BIN_DIR}${path.delimiter}${process.env.PATH || ''}`,
    },
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new SetupError(`failed to run noesis ${args[0]}: ${result.error.message}`);
  if (options.check === false) return result;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SetupError(`noesis ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}


function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SetupError(`${label} did not emit valid JSON: ${error.message}`);
  }
}


function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Noesis setup: ${report.status}`);
  console.log(`Workspace: ${report.workspace}`);
  console.log(`Manifest: ${report.config_path}`);
  for (const action of report.actions) {
    console.log(`- ${action.phase}: ${action.action}${action.name ? ` ${action.name}` : ''}${action.status ? ` (${action.status})` : ''}`);
  }
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) throw new SetupError(`missing value for ${option}`);
  return value;
}


function resolveWorkspace(value) {
  return path.resolve(expandPath(value || process.cwd()));
}


function expandPath(value) {
  let expanded = String(value);
  if (expanded === '~') expanded = userHome();
  else if (expanded.startsWith('~/')) expanded = path.join(userHome(), expanded.slice(2));
  if (!path.isAbsolute(expanded)) expanded = path.join(process.cwd(), expanded);
  return path.resolve(expanded);
}


function userHome() {
  return path.resolve(process.env.HOME || os.homedir());
}


function requireDirectory(targetPath, label) {
  if (!fs.existsSync(targetPath)) throw new SetupError(`${label} does not exist: ${targetPath}`);
  if (!fs.statSync(targetPath).isDirectory()) throw new SetupError(`${label} is not a directory: ${targetPath}`);
}


function shellQuote(value) {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}


function resolveCommand(commandLine, workspace) {
  return commandLine.replaceAll('${workspace}', shellQuote(workspace));
}
