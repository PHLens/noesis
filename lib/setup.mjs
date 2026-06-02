import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildManifest, manifestPath, readManifest, serializeManifest } from './bootstrap.mjs';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOESIS_BIN_DIR = path.join(REPO_ROOT, 'bin');
const PAMEM_DEP_ROOT = path.join(REPO_ROOT, 'node_modules', '@phlens', 'pamem');
export const DEFAULT_COMPONENTS = ['pamem', 'loreforge'];
const PAMEM_PROFILES = ['onboarding', 'coder', 'reviewer', 'researcher'];
const PAMEM_RUNTIMES = ['cli', 'slock'];
const COMPONENT_DEFINITIONS = {
  pamem: {
    env: 'NOESIS_PAMEM_ROOT',
    repo_env: 'NOESIS_PAMEM_REPO',
    managed_dir: 'pamem',
    repo: 'git@github.com:PHLens/pamem.git',
  },
  loreforge: {
    env: 'NOESIS_LOREFORGE_ROOT',
    repo_env: 'NOESIS_LOREFORGE_REPO',
    managed_dir: 'LoreForge',
    repo: 'git@github.com:PHLens/LoreForge.git',
  },
};


export class SetupError extends Error {}


export function printSetupUsage() {
  console.log(`Usage: noesis setup [--workspace <path>] [--with <components>] --profile <role> [options]

Advanced local prepare path used by noesis launch, development workflows, and
smoke tests. It runs Noesis init, installs required Noesis entry skills,
resolves local pamem/LoreForge component sources, calls pamem's
component-facing setup wrapper when pamem is enabled, installs the LoreForge
entry skill when a local source is resolved, optionally calls LoreForge's setup
wrapper for wiki/domain bootstrap, and finishes with doctor.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --with <list>                 Comma-separated components: pamem,loreforge or none.
  --component <name=path>       Local component repo/source, e.g. pamem=/path/to/pamem.
  --component-dir <path>        Directory for discovered/installed component checkouts.
                                Defaults to XDG_DATA_HOME/noesis/components.
  --install-components          Clone missing enabled components into --component-dir.
  --update-components           Run 'git pull --ff-only' in resolved component checkouts.
  --profile <role>              Pamem profile: onboarding,coder,reviewer,researcher.
                                Required when pamem is enabled.
  --pamem-runtime <cli|slock>   Pamem runtime binding. Defaults to cli.
  --loreforge-wiki <path>       LoreForge wiki path to set up.
  --loreforge-domain <name>     LoreForge domain name to set up.
  --loreforge-registry <path>   LoreForge registry path. Defaults to .noesis/loreforge/registry.toml.
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
  noesis setup --workspace /path/to/ws --profile researcher --install-components --loreforge-wiki /path/to/wiki --loreforge-domain research
  noesis setup --workspace /path/to/ws --profile researcher --component pamem=/path/to/pamem --component loreforge=/path/to/LoreForge --loreforge-wiki /path/to/wiki --loreforge-domain research
  noesis setup --workspace /path/to/ws --with none`);
}


export function runSetupCommand(tokens, options = {}) {
  const { report, exitCode, args } = buildSetupReport(tokens, options);
  if (options.print !== false) printReport(report, args.json || false);
  return exitCode;
}


export function buildSetupReport(tokens, options = {}) {
  const args = parseSetupArgs(tokens);
  const workspace = resolveWorkspace(args.workspace);
  const components = parseComponents(args.withComponents);
  validatePamemSetupOptions(components, args);
  validateLoreForgeSetupOptions(components, args);
  const componentResolution = resolveSetupComponents(components, args);
  const componentSources = componentResolution.sources;
  validateLoreForgeComponentSource(components, args, componentSources);
  const actions = [...componentResolution.actions];
  const manifestSources = { ...componentSources };
  if (components.includes('pamem') && !manifestSources.pamem) {
    manifestSources.pamem = defaultPamemComponent();
  }

  fs.mkdirSync(workspace, { recursive: true });

  const initReport = runInit(workspace, components, args.force, options.version || '0.1.0');
  actions.push(...initReport.actions.map((action) => ({ phase: 'init', ...action })));

  const manifest = mergeComponentSources(
    buildManifest({ workspace, enabled: components, version: options.version || '0.1.0' }),
    manifestSources,
  );
  if (components.includes('pamem') && args.pamemAgentHome) {
    manifest.components.pamem.config_path = 'config.toml';
  }
  writeManifest(workspace, manifest);
  actions.push({ phase: 'manifest', action: 'wrote', path: manifestPath(workspace) });

  actions.push(runSkillAdd(workspace, 'heuristic-intake'));
  actions.push(runSkillAdd(workspace, 'noesis-skill-manager'));

  if (components.includes('pamem')) {
    const pamem = manifestSources.pamem;
    const initCommand = pamemSetupCommand(pamem.cli_command, args);
    manifest.components.pamem.init_command = initCommand;
    writeManifest(workspace, manifest);
    const existing = existingPamemSetup(workspace, args);
    if (existing.configured && !args.force) {
      actions.push({
        phase: 'component',
        action: 'init-skipped',
        name: 'pamem',
        status: 'ok',
        reason: 'already-configured',
        config: existing.config,
      });
    } else {
      actions.push(runComponentInit(workspace, 'pamem', initCommand));
    }
  }
  if (components.includes('loreforge') && componentSources.loreforge?.skill_source) {
    actions.push(runSkillAdd(workspace, 'loreforge', { source: componentSources.loreforge.skill_source }));
  }
  if (components.includes('loreforge') && args.loreforgeWiki && args.loreforgeDomain) {
    const loreforge = componentSources.loreforge;
    const initCommand = loreforgeSetupCommand(loreforge.cli_command, args);
    manifest.components.loreforge.init_command = initCommand;
    manifest.components.loreforge.status_command = loreforgeStatusCommand(loreforge.cli_command, args);
    manifest.components.loreforge.validate_command = loreforgeValidateCommand(loreforge.cli_command, args);
    writeManifest(workspace, manifest);
    actions.push(runComponentInit(workspace, 'loreforge', initCommand));
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

  return { report, exitCode: report.status === 'failed' ? 1 : 0, args };
}


function parseSetupArgs(tokens) {
  const args = {
    workspace: null,
    withComponents: null,
    componentSources: [],
    componentDir: null,
    installComponents: false,
    updateComponents: false,
    profile: null,
    pamemRuntime: 'cli',
    pamemAgentHome: false,
    loreforgeWiki: null,
    loreforgeDomain: null,
    loreforgeRegistry: null,
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
    } else if (token === '--component-dir') {
      args.componentDir = requireValue(tokens, ++index, '--component-dir');
    } else if (token.startsWith('--component-dir=')) {
      args.componentDir = token.slice('--component-dir='.length);
    } else if (token === '--install-components') {
      args.installComponents = true;
    } else if (token === '--update-components') {
      args.updateComponents = true;
    } else if (token === '--profile') {
      args.profile = requireValue(tokens, ++index, '--profile');
    } else if (token.startsWith('--profile=')) {
      args.profile = token.slice('--profile='.length);
    } else if (token === '--pamem-runtime') {
      args.pamemRuntime = requireValue(tokens, ++index, '--pamem-runtime');
    } else if (token.startsWith('--pamem-runtime=')) {
      args.pamemRuntime = token.slice('--pamem-runtime='.length);
    } else if (token === '--pamem-agent-home') {
      args.pamemAgentHome = true;
    } else if (token === '--loreforge-wiki') {
      args.loreforgeWiki = requireValue(tokens, ++index, '--loreforge-wiki');
    } else if (token.startsWith('--loreforge-wiki=')) {
      args.loreforgeWiki = token.slice('--loreforge-wiki='.length);
    } else if (token === '--loreforge-domain') {
      args.loreforgeDomain = requireValue(tokens, ++index, '--loreforge-domain');
    } else if (token.startsWith('--loreforge-domain=')) {
      args.loreforgeDomain = token.slice('--loreforge-domain='.length);
    } else if (token === '--loreforge-registry') {
      args.loreforgeRegistry = requireValue(tokens, ++index, '--loreforge-registry');
    } else if (token.startsWith('--loreforge-registry=')) {
      args.loreforgeRegistry = token.slice('--loreforge-registry='.length);
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
  if (args.pamemAgentHome && args.pamemRuntime !== 'cli') throw new SetupError('--pamem-agent-home is only supported with --pamem-runtime cli');
  if ((args.gitAuthorName && !args.gitAuthorEmail) || (!args.gitAuthorName && args.gitAuthorEmail)) {
    throw new SetupError('--git-author-name and --git-author-email must be provided together');
  }
  return args;
}


export function parseComponents(value) {
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
    throw new SetupError('setup with pamem requires --profile <onboarding|coder|reviewer|researcher>; use --with none or --with loreforge to skip pamem');
  }
  if (!PAMEM_PROFILES.includes(args.profile)) throw new SetupError(`unsupported pamem profile: ${args.profile}`);
}


function validateLoreForgeSetupOptions(components, args) {
  const hasWiki = Boolean(args.loreforgeWiki);
  const hasDomain = Boolean(args.loreforgeDomain);
  if (!hasWiki && !hasDomain) return;
  if (!components.includes('loreforge')) {
    throw new SetupError('LoreForge setup options require the loreforge component; remove --loreforge-wiki/--loreforge-domain or include loreforge in --with');
  }
  if (hasWiki !== hasDomain) {
    throw new SetupError('--loreforge-wiki and --loreforge-domain must be provided together');
  }
}


function validateLoreForgeComponentSource(components, args, componentSources) {
  if (!components.includes('loreforge') || !args.loreforgeWiki || !args.loreforgeDomain) return;
  if (!componentSources.loreforge) {
    throw new SetupError('LoreForge setup requires a LoreForge component source; pass --component loreforge=/path/to/LoreForge, set NOESIS_LOREFORGE_ROOT, place LoreForge near the workspace, or use --install-components');
  }
}


export function resolveSetupComponents(components, args, options = {}) {
  const explicit = resolveExplicitComponentSources(args.componentSources);
  const actions = [];
  const sources = { ...explicit };
  const componentDir = resolveComponentDir(args.componentDir);

  for (const name of components) {
    if (sources[name]) {
      actions.push(componentResolutionAction(name, 'explicit', sources[name]));
      maybeUpdateComponent(name, sources[name], args, actions);
      continue;
    }

    const discovered = discoverComponentSource(name, componentDir);
    if (discovered) {
      sources[name] = discovered.source;
      actions.push(componentResolutionAction(name, discovered.kind, discovered.source));
      maybeUpdateComponent(name, discovered.source, args, actions);
      continue;
    }

    if (args.installComponents) {
      const installed = installComponentSource(name, componentDir);
      sources[name] = installed;
      actions.push(componentResolutionAction(name, 'installed', installed));
      maybeUpdateComponent(name, installed, args, actions);
    } else if (options.recordMissing) {
      actions.push({
        phase: 'component',
        action: 'missing',
        name,
        status: 'missing',
        path: path.join(componentDir, COMPONENT_DEFINITIONS[name].managed_dir),
        reason: 'not-resolved',
      });
    }
  }

  return { sources, actions, component_dir: componentDir };
}


function resolveExplicitComponentSources(values) {
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


function discoverComponentSource(name, componentDir) {
  const definition = COMPONENT_DEFINITIONS[name];
  const candidates = [
    { kind: 'env', root: process.env[definition.env] },
    ...nearbyComponentCandidates(name).map((root) => ({ kind: 'nearby', root })),
    { kind: 'managed', root: path.join(componentDir, definition.managed_dir) },
  ];

  for (const candidate of candidates) {
    if (!candidate.root) continue;
    const root = path.resolve(expandPath(candidate.root));
    if (!fs.existsSync(root)) continue;
    try {
      return { kind: candidate.kind, source: componentSource(name, root) };
    } catch (error) {
      if (candidate.kind === 'env' || candidate.kind === 'managed') throw error;
    }
  }

  return null;
}


function nearbyComponentCandidates(name) {
  const definition = COMPONENT_DEFINITIONS[name];
  const names = [...new Set([definition.managed_dir, name])];
  const bases = componentSearchBases();
  const candidates = [];
  for (const base of bases) {
    for (const dirname of names) {
      candidates.push(path.join(base, dirname));
    }
  }
  return candidates;
}


function componentSearchBases() {
  if (Object.hasOwn(process.env, 'NOESIS_COMPONENT_SEARCH_DIRS')) {
    return process.env.NOESIS_COMPONENT_SEARCH_DIRS
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => expandPath(item));
  }
  return [
    process.cwd(),
    path.dirname(process.cwd()),
    path.dirname(REPO_ROOT),
    path.join(userHome(), 'plugins'),
    userHome(),
  ];
}


function installComponentSource(name, componentDir) {
  const definition = COMPONENT_DEFINITIONS[name];
  const root = path.join(componentDir, definition.managed_dir);
  if (fs.existsSync(root)) return componentSource(name, root);

  fs.mkdirSync(componentDir, { recursive: true });
  runGitCommand(['clone', process.env[definition.repo_env] || definition.repo, root], componentDir, `clone ${name}`);
  return componentSource(name, root);
}


function maybeUpdateComponent(name, source, args, actions) {
  if (!args.updateComponents) return;
  if (!fs.existsSync(path.join(source.root, '.git'))) {
    actions.push({
      phase: 'component',
      action: 'update-skipped',
      name,
      status: 'skipped',
      path: source.root,
      reason: 'not-a-git-checkout',
    });
    return;
  }
  const result = runGitCommand(['pull', '--ff-only'], source.root, `update ${name}`);
  actions.push({
    phase: 'component',
    action: 'updated',
    name,
    status: 'ok',
    path: source.root,
    stdout: result.stdout.trim(),
  });
}


function resolveComponentDir(value) {
  if (value) return expandPath(value);
  const dataHome = process.env.XDG_DATA_HOME
    ? expandPath(process.env.XDG_DATA_HOME)
    : path.join(userHome(), '.local', 'share');
  return path.join(dataHome, 'noesis', 'components');
}


function runGitCommand(args, cwd, label) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new SetupError(`failed to ${label}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SetupError(`failed to ${label}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}


function componentResolutionAction(name, action, source) {
  return {
    phase: 'component',
    action,
    name,
    status: 'ok',
    path: source.root,
    command: source.cli_command,
  };
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
  if (fs.existsSync(PAMEM_DEP_ROOT)) return componentSource('pamem', PAMEM_DEP_ROOT);
  const command = 'pamem';
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


function pamemSetupCommand(command, args) {
  const parts = [
    command,
    'setup',
    '${workspace}',
    '--profile',
    shellQuote(args.profile),
    '--runtime',
    shellQuote(args.pamemRuntime),
  ];
  if (args.agentId) parts.push('--agent-id', shellQuote(args.agentId));
  if (args.pamemAgentHome) parts.push('--agent-home');
  if (args.memoryRepo) parts.push('--memory-repo', shellQuote(expandPath(args.memoryRepo)));
  if (args.syncRemote) parts.push('--sync-remote', shellQuote(args.syncRemote));
  if (args.syncRef) parts.push('--sync-ref', shellQuote(args.syncRef));
  if (args.gitAuthorName) parts.push('--git-author-name', shellQuote(args.gitAuthorName));
  if (args.gitAuthorEmail) parts.push('--git-author-email', shellQuote(args.gitAuthorEmail));
  if (args.force) parts.push('--force');
  parts.push('--json');
  return parts.join(' ');
}


function existingPamemSetup(workspace, args) {
  const config = args.pamemAgentHome
    ? path.join(workspace, 'config.toml')
    : path.join(workspace, '.pamem', 'config.toml');
  if (!fs.existsSync(config)) return { configured: false, config };

  const profile = tomlValue(config, '', 'default_profile');
  const runtime = tomlValue(config, 'runtime', 'mode') || 'cli';
  const agentId = tomlValue(config, 'runtime', 'agent_id');
  if (args.force) return { configured: true, config, profile, runtime, agent_id: agentId };
  if (profile && profile !== args.profile) {
    throw new SetupError(`pamem config at ${config} is already profile=${profile}; use --force only for deliberate re-onboarding`);
  }
  if (runtime !== args.pamemRuntime) {
    throw new SetupError(`pamem config at ${config} is runtime=${runtime}, not ${args.pamemRuntime}; use --force only for deliberate re-onboarding`);
  }
  if (args.agentId && agentId && agentId !== args.agentId) {
    throw new SetupError(`pamem config at ${config} is agent_id=${agentId}, not ${args.agentId}; use --force only for deliberate re-onboarding`);
  }
  return { configured: true, config, profile, runtime, agent_id: agentId };
}


function tomlValue(file, section, key) {
  const sectionHeader = `[${section}]`;
  let inSection = section === '';
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/[ \t]*#.*/, '').trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      inSection = line === sectionHeader;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`));
    if (!match) continue;
    let value = match[1].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value;
  }
  return '';
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function loreforgeSetupCommand(command, args) {
  const registry = loreforgeRegistryPath(args);
  const parts = [
    command,
    'setup',
    '--wiki',
    shellQuote(expandPath(args.loreforgeWiki)),
    '--domain',
    shellQuote(args.loreforgeDomain),
    '--registry',
    shellQuote(registry),
    '--json',
  ];
  if (args.force) parts.push('--force');
  return parts.join(' ');
}


function loreforgeStatusCommand(command, args) {
  return `${command} status --registry ${shellQuote(loreforgeRegistryPath(args))} --wiki-name 'main' --json`;
}


function loreforgeValidateCommand(command, args) {
  return `${command} validate --registry ${shellQuote(loreforgeRegistryPath(args))} --wiki ${shellQuote(expandPath(args.loreforgeWiki))} --all-domains --json`;
}


function loreforgeRegistryPath(args) {
  return args.loreforgeRegistry
    ? expandPath(args.loreforgeRegistry)
    : path.join(resolveWorkspace(args.workspace), '.noesis', 'loreforge', 'registry.toml');
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
