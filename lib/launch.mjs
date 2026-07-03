import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { manifestPath, readManifest, serializeManifest } from './bootstrap.mjs';
import { buildSetupReport, parseComponents } from './setup.mjs';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAMEM_REPO_ROOT = path.join(REPO_ROOT, 'node_modules', '@phlens', 'pamem');
const PAMEM_ASSETS_DIR = path.join(PAMEM_REPO_ROOT, 'assets');
const PAMEM_SCRIPTS_DIR = path.join(PAMEM_REPO_ROOT, 'scripts');
const PAMEM_CODEX_SKILLS = ['memory-lint', 'memory-rule', 'sync-request'];
const PAMEM_PROFILES = ['onboarding', 'coder', 'reviewer', 'researcher'];
const NOESIS_TASK_ROLES = ['coder', 'reviewer', 'researcher', 'planner', 'architect'];
const ROLE_CAPABILITY_REGISTRY = {
  onboarding: {
    memory: { profile: 'onboarding' },
    skills: { default: [] },
    wiki: { access: [] },
  },
  coder: {
    memory: { profile: 'coder' },
    skills: { default: ['shared-devflow'] },
    wiki: { access: ['read'] },
  },
  reviewer: {
    memory: { profile: 'reviewer' },
    skills: { default: ['code-review', 'doc-review'] },
    wiki: { access: ['read'] },
  },
  researcher: {
    memory: { profile: 'researcher' },
    skills: { default: ['doc-review'] },
    wiki: { access: ['read', 'capture', 'stage-proposal'] },
  },
  planner: {
    memory: { profile: 'researcher' },
    skills: { default: ['doc-review', 'shared-devflow'] },
    wiki: { access: ['read', 'stage-proposal'] },
  },
  architect: {
    memory: { profile: 'researcher' },
    skills: { default: ['doc-review', 'shared-devflow'] },
    wiki: { access: ['read', 'stage-proposal'] },
  },
};
const SKILL_MANAGER_ROLES = new Set(['onboarding', 'admin', 'heuristic-curator', 'noesis-owner']);
const LAUNCH_RUNTIMES = ['codex', 'claude', 'cli', 'slock'];


export class LaunchError extends Error {}


export function printLaunchUsage() {
  console.log(`Usage: noesis launch [--name <task>] [--role <role>] [--runtime codex|claude|cli] [options] [-- <command> [args...]]

Prepare a Noesis task instance, compatibility CLI agent home, or Slock
workspace, run doctor, then start or bind the selected runtime. Noesis owns the
user-facing runtime/session UX; memory and wiki setup remain delegated to pamem
and LoreForge owner setup surfaces.

Options:
  --role <role>                 Task role: coder,reviewer,researcher,planner,architect. Required for new task instances.
  --profile <role>              Compatibility alias for --role on task instances.
                                Direct pamem profiles remain accepted only on compatibility paths.
  --name <task>                 Optional task-instance quick-resume name.
  --runtime <name>              Runtime launcher: codex,claude,cli. Defaults to codex. Use slock with --workspace.
  --agent-id <id>               Deprecated compatibility CLI agent id.
  --workspace <path>            Explicit workspace or agent home. Required for Slock binding.
  --resume                      Resume the previous CLI runtime command.
  --rm                          Create a disposable one-shot task instance.
  --print-env                   Print PAMEM_* exports instead of starting a runtime.
  --runtime-arg <arg>           Append one launcher argument. May be repeated.
  --with <components>           Comma-separated launch components: pamem,loreforge.
                                Defaults to pamem; wiki/domain setup enables LoreForge.
                                Runtime launch requires pamem; loreforge keeps pamem enabled.
  --component <name=path>       Local component repo/source, e.g. pamem=/path/to/pamem.
  --component-dir <path>        Directory for discovered/installed component checkouts.
  --install-components          Clone missing enabled components into --component-dir.
                                Enabled by default for launch.
  --update-components           Run 'git pull --ff-only' in resolved component checkouts.
  --wiki <path>                 Alias for --loreforge-wiki.
  --domain <name>               Alias for --loreforge-domain.
  --loreforge-wiki <path>       LoreForge wiki path to set up.
  --loreforge-domain <name>     LoreForge domain name to set up.
  --loreforge-registry <path>   LoreForge registry path.
  --memory-repo <path>          Pamem shared memory repo path.
  --sync-remote <target>        Pamem memory_repo.sync remote value.
  --sync-ref <ref>              Pamem memory_repo.sync ref value.
  --git-author-name <name>      Pamem memory repo git author name.
  --git-author-email <email>    Pamem memory repo git author email.
  --force                       Re-onboard owner component configs deliberately.
  --json                        Print machine-readable JSON when no runtime is started.

Examples:
  noesis launch --name task52-noesis-role-startup --role planner --runtime codex
  noesis launch --name task52-noesis-role-startup --resume
  noesis launch --role reviewer --runtime codex --rm
  noesis launch --profile researcher --runtime codex --agent-id researcher-local
  noesis launch --profile coder --runtime claude --agent-id coder-local --resume
  noesis launch --profile researcher --runtime slock --workspace <slock-agent-workspace>
  noesis launch --profile researcher --runtime codex --wiki /path/to/wiki --domain gpu-arch-research`);
}


export function printListUsage() {
  console.log(`Usage: noesis list [--json]

List Noesis task instances, compatibility pamem CLI agent homes, and local
Slock workspaces discovered by Noesis. This is the user-facing replacement for
pamem list.`);
}


export function printRemoveUsage() {
  console.log(`Usage: noesis remove [--workspace <path>|--agent-id <id>] [--json]

Remove Noesis/pamem user-launch integration from a workspace or CLI agent home.
This leaves Noesis manifests, pamem configs, shared memory repos, and wiki
content in place. Use owner tools for memory/wiki content cleanup.`);
}


export function runLaunchCommand(tokens, options = {}) {
  const args = parseLaunchArgs(tokens);
  const target = resolveLaunchTarget(args);
  applyExistingTaskRuntime(args, target);
  normalizeLaunchRuntime(args);
  validateLaunchArgs(args, target);

  const workspace = target.workspace;
  const setupTokens = buildSetupTokens(args, workspace);
  let setupResult;
  try {
    setupResult = buildSetupReport(setupTokens, {
      version: options.version || '0.1.0',
      print: false,
      preferBundledPamem: true,
      runtimeCapability: args.runtime === 'claude' ? 'claude' : null,
    });
  } catch (error) {
    if (target.kind === 'task-instance' && target.disposable) markDisposableFailed(target, error.message, args);
    throw error;
  }
  const { report: setup, exitCode } = setupResult;
  if (exitCode !== 0 || setup.doctor.summary.error_count > 0) {
    const report = {
      status: 'failed',
      command: 'launch',
      workspace,
      runtime: args.runtime,
      runtime_mode: args.runtimeMode,
      downstream_execution: 'not-run',
      setup,
    };
    if (target.kind === 'task-instance' && target.disposable) report.disposable_cleanup = markDisposableFailed(target, 'setup-failed', args);
    emitReport(report, args.json);
    return 1;
  }

  try {
    if (args.runtimeMode === 'slock') {
      const state = runtimeState(workspace, args.agentId, []);
      if (target.kind === 'task-instance') applyTaskInstanceMetadata(target, args, state);
      const report = {
        status: setup.doctor.status === 'warning' ? 'warning' : 'ok',
        command: 'launch',
        workspace,
        runtime: args.runtime,
        runtime_mode: args.runtimeMode,
        downstream_execution: 'slock-bind',
        setup,
        runtime_state: statusObject(state),
      };
      if (target.kind === 'task-instance' && target.disposable) report.disposable_cleanup = cleanupDisposableSuccess(target);
      emitReport(report, args.json);
      return 0;
    }

    const state = runtimeState(workspace, args.agentId, args.launchArgs);
    if (target.kind === 'task-instance') applyTaskInstanceMetadata(target, args, state);
    if (state.runtimeMode !== 'cli') {
      throw new LaunchError(`pamem config at ${state.configFile} is runtime=${state.runtimeMode}, not cli`);
    }
    ensureCliState(state);

    if (args.printEnv) {
      printStatus(state);
      console.log(envLines(state, args.resume ? 'resume' : 'start').join('\n'));
      return 0;
    }

    const action = args.resume ? 'resume' : 'start';
    const command = args.resume && args.launchArgs.length === 0
      ? resumeArgs(state)
      : args.launchArgs;
    if (command.length === 0) {
      throw new LaunchError(`no resumable session found for agent_id=${state.agentId}; pass a runtime command after -- or use --runtime codex|claude`);
    }
    const launchArgs = runtimeLaunchArgs(command);
    if (args.json) {
      const report = {
        status: setup.doctor.status === 'warning' ? 'warning' : 'ok',
        command: 'launch',
        workspace,
        runtime: args.runtime,
        runtime_mode: args.runtimeMode,
        downstream_execution: 'runtime-not-run',
        setup,
        runtime_state: statusObject(state),
        launch_command: launchArgs,
      };
      if (target.kind === 'task-instance' && target.disposable) report.disposable_cleanup = cleanupDisposableSuccess(target);
      emitReport(report, true);
      return 0;
    }
    const session = recordSession(state, action, launchArgs);
    const report = {
      status: setup.doctor.status === 'warning' ? 'warning' : 'ok',
      command: 'launch',
      workspace,
      runtime: args.runtime,
      runtime_mode: args.runtimeMode,
      downstream_execution: 'runtime-start',
      setup,
      runtime_state: statusObject(state, session),
      launch_command: launchArgs,
    };
    if (target.kind === 'task-instance' && target.disposable) {
      const result = runRuntime(launchArgs[0], launchArgs.slice(1), {
        cwd: state.workspace,
        env: launchEnv(state, action, session),
      });
      if (result.status === 0) cleanupDisposableSuccess(target);
      else markDisposableFailed(target, `runtime-exit-${result.status ?? 1}`, args);
      return result.status ?? 1;
    }
    return runAndExit(launchArgs[0], launchArgs.slice(1), {
      cwd: state.workspace,
      env: launchEnv(state, action, session),
    });
  } catch (error) {
    if (target.kind === 'task-instance' && target.disposable) markDisposableFailed(target, error.message, args);
    throw error;
  }
}


export function runListCommand(tokens) {
  const args = parseListArgs(tokens);
  const agents = discoverAgents();
  const report = {
    status: 'ok',
    command: 'list',
    instances_dir: noesisInstancesDir(),
    agents_dir: pamemAgentsDir(),
    slock_agents_dir: slockAgentsDir(),
    agents,
  };
  if (args.json) {
    emitReport(report, true);
    return 0;
  }
  if (agents.length === 0) {
    console.log(`No Noesis task instances, compatibility agent homes, or Slock workspaces found under ${report.instances_dir}, ${report.agents_dir}, or ${report.slock_agents_dir}`);
    return 0;
  }
  console.log('name\tagent_id\truntime\trole\tkind\thome');
  for (const agent of agents) {
    console.log(`${agent.name || '-'}\t${agent.agent_id}\t${agent.runtime}\t${agent.role}\t${agent.kind}\t${agent.home}`);
  }
  return 0;
}


export function runRemoveCommand(tokens) {
  const args = parseRemoveArgs(tokens);
  const workspace = resolveRemoveWorkspace(args);
  const actions = fs.existsSync(workspace)
    ? removeUserLaunchIntegration(workspace)
    : [{ action: 'workspace-missing', status: 'skipped', path: workspace, reason: 'not-found' }];
  const report = removeReport(workspace, actions);
  emitReport(report, args.json);
  return 0;
}


function parseLaunchArgs(tokens) {
  const args = {
    profile: '',
    runtime: 'codex',
    runtimeProvided: false,
    runtimeMode: 'cli',
    resumeLastCommand: false,
    workspace: '',
    agentId: '',
    name: '',
    disposable: false,
    resume: false,
    printEnv: false,
    json: false,
    force: false,
    withComponents: null,
    componentSources: [],
    componentDir: '',
    installComponents: false,
    updateComponents: false,
    loreforgeWiki: '',
    loreforgeDomain: '',
    loreforgeRegistry: '',
    memoryRepo: '',
    syncRemote: '',
    syncRef: '',
    gitAuthorName: '',
    gitAuthorEmail: '',
    launchArgs: [],
    launchArgsProvided: false,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      args.launchArgs = tokens.slice(index + 1);
      args.launchArgsProvided = args.launchArgs.length > 0;
      break;
    }
    if (token === '-h' || token === '--help') {
      printLaunchUsage();
      process.exit(0);
    } else if (token === '--profile' || token === '--role') {
      args.profile = requireValue(tokens, ++index, token);
    } else if (token.startsWith('--profile=')) {
      args.profile = token.slice('--profile='.length);
    } else if (token.startsWith('--role=')) {
      args.profile = token.slice('--role='.length);
    } else if (token === '--runtime') {
      args.runtime = requireValue(tokens, ++index, '--runtime');
      args.runtimeProvided = true;
    } else if (token.startsWith('--runtime=')) {
      args.runtime = token.slice('--runtime='.length);
      args.runtimeProvided = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
    } else if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
    } else if (token === '--name') {
      args.name = requireValue(tokens, ++index, '--name');
    } else if (token.startsWith('--name=')) {
      args.name = token.slice('--name='.length);
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
    } else if (token === '--wiki' || token === '--loreforge-wiki') {
      args.loreforgeWiki = requireValue(tokens, ++index, token);
    } else if (token.startsWith('--wiki=')) {
      args.loreforgeWiki = token.slice('--wiki='.length);
    } else if (token.startsWith('--loreforge-wiki=')) {
      args.loreforgeWiki = token.slice('--loreforge-wiki='.length);
    } else if (token === '--domain' || token === '--loreforge-domain') {
      args.loreforgeDomain = requireValue(tokens, ++index, token);
    } else if (token.startsWith('--domain=')) {
      args.loreforgeDomain = token.slice('--domain='.length);
    } else if (token.startsWith('--loreforge-domain=')) {
      args.loreforgeDomain = token.slice('--loreforge-domain='.length);
    } else if (token === '--loreforge-registry') {
      args.loreforgeRegistry = requireValue(tokens, ++index, '--loreforge-registry');
    } else if (token.startsWith('--loreforge-registry=')) {
      args.loreforgeRegistry = token.slice('--loreforge-registry='.length);
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
    } else if (token === '--runtime-arg') {
      args.launchArgs.push(requireValue(tokens, ++index, '--runtime-arg'));
      args.launchArgsProvided = true;
    } else if (token.startsWith('--runtime-arg=')) {
      args.launchArgs.push(token.slice('--runtime-arg='.length));
      args.launchArgsProvided = true;
    } else if (token === '--resume') {
      args.resume = true;
    } else if (token === '--rm') {
      args.disposable = true;
    } else if (token === '--print-env') {
      args.printEnv = true;
    } else if (token === '--force') {
      args.force = true;
    } else if (token === '--json') {
      args.json = true;
    } else if (token.startsWith('-')) {
      throw new LaunchError(`unknown launch option: ${token}`);
    } else {
      throw new LaunchError(`unexpected launch argument: ${token}`);
    }
  }
  return args;
}


function applyExistingTaskRuntime(args, target) {
  if (args.runtimeProvided || target.kind !== 'task-instance' || !target.existing) return;
  if (args.resume && !args.launchArgsProvided) args.resumeLastCommand = true;
  const launcher = target.metadata?.launcher;
  if (LAUNCH_RUNTIMES.includes(launcher)) {
    args.runtime = launcher;
    return;
  }
  if (target.metadata?.runtime === 'slock') args.runtime = 'slock';
  else if (target.metadata?.runtime === 'cli') args.runtime = 'cli';
}


function normalizeLaunchRuntime(args) {
  if (!LAUNCH_RUNTIMES.includes(args.runtime)) throw new LaunchError(`unsupported runtime: ${args.runtime}`);
  if (args.runtime === 'codex' || args.runtime === 'claude') {
    args.runtimeMode = 'cli';
    if (args.resumeLastCommand) return;
    if (args.launchArgs.length === 0) {
      args.launchArgs = [args.runtime];
    } else if (args.launchArgs[0] !== args.runtime) {
      args.launchArgs = [args.runtime, ...args.launchArgs];
    }
    return;
  }
  args.runtimeMode = args.runtime;
}


function validateLaunchArgs(args, target) {
  if (target.kind === 'task-instance') {
    if (!args.profile) throw new LaunchError('new task instance launch requires --role <coder|reviewer|researcher|planner|architect>');
    if (!NOESIS_TASK_ROLES.includes(args.profile)) throw new LaunchError(`unsupported role: ${args.profile}`);
    if (args.disposable && args.resume) throw new LaunchError('--resume cannot be used with --rm');
    if (args.disposable && args.printEnv) throw new LaunchError('--print-env cannot be used with --rm');
    if (args.workspace) throw new LaunchError('--workspace is not supported with task-instance launch; use --name or compatibility --agent-id');
  } else {
    if (!args.profile) throw new LaunchError('noesis launch requires --profile <onboarding|coder|reviewer|researcher>');
    if (!PAMEM_PROFILES.includes(args.profile)) throw new LaunchError(`unsupported profile: ${args.profile}`);
  }
  if (args.runtimeMode === 'cli' && target.kind !== 'task-instance' && !args.workspace && !args.agentId) {
    throw new LaunchError(`noesis launch --runtime ${args.runtime} requires --agent-id when --workspace is omitted`);
  }
  if (args.runtimeMode === 'slock' && !args.workspace) {
    throw new LaunchError('noesis launch --runtime slock requires --workspace');
  }
  if (args.runtimeMode === 'slock') {
    if (args.resume) throw new LaunchError('noesis launch --runtime slock binds/repairs an existing Slock workspace; resume is handled by Slock');
    if (args.printEnv) throw new LaunchError('noesis launch --runtime slock does not emit CLI launcher environment');
    if (args.launchArgs.length > 0) throw new LaunchError('noesis launch --runtime slock does not start a process; start the agent through Slock');
  }
  if ((args.gitAuthorName && !args.gitAuthorEmail) || (!args.gitAuthorName && args.gitAuthorEmail)) {
    throw new LaunchError('--git-author-name and --git-author-email must be provided together');
  }
}


function buildSetupTokens(args, workspace) {
  const tokens = [
    '--workspace', workspace,
    '--profile', launchMemoryProfile(args),
    '--pamem-runtime', args.runtimeMode,
  ];
  if (args.runtimeMode === 'cli') tokens.push('--pamem-agent-home');
  tokens.push('--with', launchSetupComponents(args));
  for (const source of args.componentSources) tokens.push('--component', source);
  if (args.componentDir) tokens.push('--component-dir', args.componentDir);
  tokens.push('--install-components');
  if (args.updateComponents) tokens.push('--update-components');
  if (args.loreforgeWiki) tokens.push('--loreforge-wiki', args.loreforgeWiki);
  if (args.loreforgeDomain) tokens.push('--loreforge-domain', args.loreforgeDomain);
  if (args.loreforgeRegistry) tokens.push('--loreforge-registry', args.loreforgeRegistry);
  if (args.agentId) tokens.push('--agent-id', args.agentId);
  if (args.memoryRepo) tokens.push('--memory-repo', args.memoryRepo);
  if (args.syncRemote) tokens.push('--sync-remote', args.syncRemote);
  if (args.syncRef) tokens.push('--sync-ref', args.syncRef);
  if (args.gitAuthorName) tokens.push('--git-author-name', args.gitAuthorName);
  if (args.gitAuthorEmail) tokens.push('--git-author-email', args.gitAuthorEmail);
  if (args.force) tokens.push('--force');
  tokens.push('--json');
  return tokens;
}


function launchSetupComponents(args) {
  if (args.withComponents) {
    const components = parseComponents(args.withComponents);
    if (components.includes('loreforge') && !components.includes('pamem')) {
      components.unshift('pamem');
    }
    return components.length > 0 ? components.join(',') : 'none';
  }
  if (launchRequestsLoreForge(args)) return 'pamem,loreforge';
  return 'pamem';
}


function launchRequestsLoreForge(args) {
  if (args.loreforgeWiki || args.loreforgeDomain || args.loreforgeRegistry) return true;
  return args.componentSources.some((source) => source.split('=', 1)[0] === 'loreforge');
}


function resolveLaunchTarget(args) {
  if (!isTaskInstanceLaunch(args)) {
    const workspace = resolveLaunchWorkspace(args);
    return {
      kind: 'compat',
      workspace,
      existing: hasPamemConfig(workspace),
      disposable: false,
    };
  }

  if (args.agentId) throw new LaunchError('--agent-id is a compatibility path and cannot be combined with task-instance launch');
  if (args.name) requireInstanceName(args.name);

  if (args.disposable) {
    const name = args.name || generatedHandle(args.profile || 'task');
    const internalId = generatedInstanceId(name);
    args.name = name;
    args.agentId = internalId;
    return {
      kind: 'task-instance',
      existing: false,
      disposable: true,
      name,
      internalInstanceId: internalId,
      workspace: noesisInstancePath(internalId),
      metadata: null,
    };
  }

  if (args.name) {
    const existing = findTaskInstanceByName(args.name);
    if (existing) {
      validateExistingTaskInstanceArgs(args, existing.metadata);
      args.profile = existing.metadata.role;
      args.agentId = existing.metadata.internal_instance_id;
      args.memoryProfile = storedMemoryProfile(existing.metadata);
      if (!args.memoryRepo && existing.metadata.memory_repo) args.memoryRepo = existing.metadata.memory_repo;
      return {
        kind: 'task-instance',
        existing: true,
        disposable: false,
        name: existing.metadata.name,
        internalInstanceId: existing.metadata.internal_instance_id,
        workspace: existing.root,
        metadata: existing.metadata,
      };
    }
  }

  if (!args.profile) throw new LaunchError('new task instance launch requires --role <coder|reviewer|researcher|planner|architect>');
  const name = args.name || generatedHandle(args.profile);
  const internalId = generatedInstanceId(name);
  args.name = name;
  args.agentId = internalId;
  args.memoryProfile = memoryProfileForRole(args.profile);
  return {
    kind: 'task-instance',
    existing: false,
    disposable: false,
    name,
    internalInstanceId: internalId,
    workspace: noesisInstancePath(internalId),
    metadata: null,
  };
}


function isTaskInstanceLaunch(args) {
  if (args.name || args.disposable) return true;
  return !args.workspace && !args.agentId;
}


function validateExistingTaskInstanceArgs(args, metadata) {
  if (args.profile && args.profile !== metadata.role) {
    throw new LaunchError(`existing task instance ${metadata.name} has role=${metadata.role}; omit --role or use the stored role`);
  }
  if (args.memoryRepo && metadata.memory_repo && !samePath(expandPath(args.memoryRepo), expandPath(metadata.memory_repo))) {
    throw new LaunchError(`memory repo mismatch for task instance ${metadata.name}: stored ${metadata.memory_repo}, requested ${args.memoryRepo}`);
  }
  const domains = metadata.capabilities?.wiki?.domains;
  if (args.loreforgeDomain && Array.isArray(domains) && !domains.includes(args.loreforgeDomain)) {
    throw new LaunchError(`wiki domain mismatch for task instance ${metadata.name}: stored ${domains.join(',') || '(none)'}, requested ${args.loreforgeDomain}`);
  }
}


function applyTaskInstanceMetadata(target, args, state) {
  const existing = target.metadata || readTaskInstanceMetadata(target.workspace);
  const now = isoTimestamp();
  const role = args.profile;
  const taskDir = existing?.task_dir || path.join(target.workspace, 'tasks', target.name);
  const capabilities = existing?.capabilities || roleCapabilityEnvelope(role, args, existing);
  const metadata = {
    version: 1,
    kind: 'task-instance',
    name: target.name,
    internal_instance_id: target.internalInstanceId,
    role,
    pamem_profile: capabilities.memory.profile,
    runtime: args.runtimeMode,
    launcher: args.runtime,
    state_root: target.workspace,
    agent_id: target.internalInstanceId,
    memory_repo: state.memoryRepoRoot,
    memory_entry: path.join(state.memoryRepoRoot, state.memoryEntryFile),
    task_dir: taskDir,
    disposable: target.disposable,
    status: target.disposable ? 'disposable-active' : 'active',
    created_at: existing?.created_at || now,
    updated_at: now,
    role_skills: capabilities.skills.default,
    capabilities,
  };
  target.metadata = metadata;
  state.instance = metadata;
  state.agentId = metadata.agent_id;
  state.localDir = target.workspace;
  state.currentTaskPath = path.join(target.workspace, 'notes', 'current-task.md');
  state.workLogPath = path.join(target.workspace, 'notes', 'work-log.md');
  state.sessionDir = path.join(target.workspace, 'sessions');
  state.sessionPath = path.join(state.sessionDir, 'latest.json');
  state.taskDir = taskDir;
  ensureTaskInstanceFiles(state, metadata);
  writeTaskInstanceMetadata(target.workspace, metadata);
  alignTaskInstanceManifest(target.workspace, role);
  materializeRoleSkills(target.workspace, role, capabilities.skills.default);
  return metadata;
}


function ensureTaskInstanceFiles(state, metadata) {
  fs.mkdirSync(path.join(state.workspace, 'notes'), { recursive: true });
  fs.mkdirSync(metadata.task_dir, { recursive: true });
  fs.mkdirSync(path.join(metadata.task_dir, 'plan'), { recursive: true });
  fs.mkdirSync(path.join(metadata.task_dir, 'execution'), { recursive: true });
  fs.mkdirSync(path.join(metadata.task_dir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(metadata.task_dir, 'scratch'), { recursive: true });
  fs.mkdirSync(state.sessionDir, { recursive: true });
  copyTextIfMissing(state.currentTaskPath, [
    '# Current Task',
    '',
    `- Task instance: ${metadata.name}`,
    `- Role: ${metadata.role}`,
    `- Task directory: ${metadata.task_dir}`,
    '- Status: active',
    '',
  ].join('\n'));
  copyTextIfMissing(state.workLogPath, [
    '# Work Log',
    '',
    `- ${metadata.created_at} created task instance ${metadata.name} role=${metadata.role}`,
    '',
  ].join('\n'));
}


function materializeRoleSkills(workspace, role, defaults = roleSkillDefaults(role)) {
  for (const runtimeDir of Object.values(runtimeSkillDirs(workspace))) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    if (!SKILL_MANAGER_ROLES.has(role)) removeSymlinkIfPresent(path.join(runtimeDir, 'noesis-skill-manager'));
    for (const name of defaults) {
      const source = path.join(REPO_ROOT, 'skills', name);
      if (!fs.existsSync(path.join(source, 'SKILL.md'))) continue;
      const link = path.join(runtimeDir, name);
      const stat = lstatOrNull(link);
      if (stat && !stat.isSymbolicLink()) {
        throw new LaunchError(`cannot materialize role skill ${name}; non-symlink already exists at ${link}`);
      }
      if (stat?.isSymbolicLink()) {
        if (samePath(resolveSymlinkTarget(link), source)) continue;
        fs.unlinkSync(link);
      }
      fs.symlinkSync(path.relative(runtimeDir, source), link);
    }
  }
}


function alignTaskInstanceManifest(workspace, role) {
  const file = manifestPath(workspace);
  if (!fs.existsSync(file)) return;
  if (SKILL_MANAGER_ROLES.has(role)) return;
  const manifest = readManifest(file);
  if (!manifest.components?.skill_manager) return;
  manifest.components.skill_manager.enabled = false;
  manifest.components.skill_manager.required_entry_skill = '';
  manifest.components.skill_manager.status_command = '';
  manifest.components.skill_manager.validate_command = '';
  fs.writeFileSync(file, `${serializeManifest(manifest)}\n`);
}


function roleSkillDefaults(role) {
  return [...(roleCapabilitySpec(role).skills?.default || [])];
}


function roleCapabilitySpec(role) {
  return ROLE_CAPABILITY_REGISTRY[role] || {
    memory: { profile: role },
    skills: { default: [] },
    wiki: { access: [] },
  };
}


function roleCapabilityEnvelope(role, args = {}, existing = null) {
  const spec = roleCapabilitySpec(role);
  const memoryProfile = existing?.pamem_profile || spec.memory?.profile || role;
  const defaultSkills = Array.isArray(existing?.role_skills)
    ? [...existing.role_skills]
    : [...(spec.skills?.default || [])];
  const requestedDomains = args.loreforgeDomain ? [args.loreforgeDomain] : [];
  return {
    version: 1,
    role,
    memory: {
      owner: 'pamem',
      profile: memoryProfile,
      shared: [
        'governance/constitution.md',
        'shared/preferences.md',
        'shared/operating-rules.md',
        'shared/experience.md',
      ],
      role_guide: `roles/${memoryProfile}/${memoryProfile}.md`,
      write_policy: 'pamem-owner-gated',
    },
    skills: {
      owner: 'noesis',
      default: defaultSkills,
    },
    wiki: {
      owner: 'LoreForge',
      domains: requestedDomains,
      default_domains: [...(spec.wiki?.default_domains || [])],
      access: [...(spec.wiki?.access || [])],
    },
  };
}


function readTaskInstanceMetadata(root) {
  const file = taskInstanceMetadataPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.kind === 'task-instance' ? parsed : null;
  } catch {
    return null;
  }
}


function writeTaskInstanceMetadata(root, metadata) {
  const file = taskInstanceMetadataPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
}


function taskInstanceMetadataPath(root) {
  return path.join(root, '.noesis', 'instance.json');
}


function findTaskInstanceByName(name) {
  for (const root of taskInstanceRoots()) {
    const metadata = readTaskInstanceMetadata(root);
    if (metadata?.name === name && metadata.status !== 'removed') return { root, metadata };
  }
  return null;
}


function noesisInstancesDir() {
  return path.join(dataHome(), 'noesis', 'instances');
}


function noesisInstancePath(internalId) {
  return path.join(noesisInstancesDir(), internalId);
}


function generatedInstanceId(name) {
  return `ti-${cryptoHash(`${name}-${cryptoRandomUUID()}`).slice(0, 16)}`;
}


function generatedHandle(role) {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '').replace(/[-:]/g, '');
  return `${role}-${stamp}-${cryptoHash(cryptoRandomUUID()).slice(0, 8)}`;
}


function memoryProfileForRole(role) {
  return roleCapabilitySpec(role).memory?.profile || role;
}


function launchMemoryProfile(args) {
  return args.memoryProfile || memoryProfileForRole(args.profile);
}


function storedMemoryProfile(metadata) {
  return metadata.capabilities?.memory?.profile || metadata.pamem_profile || memoryProfileForRole(metadata.role);
}


function requireInstanceName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new LaunchError(`invalid task instance name: ${name}`);
  }
}


function parseListArgs(tokens) {
  const args = { json: false };
  for (const token of tokens) {
    if (token === '--json') args.json = true;
    else throw new LaunchError(`unknown list option: ${token}`);
  }
  return args;
}


function parseRemoveArgs(tokens) {
  const args = { workspace: '', agentId: '', json: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
    } else if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
    } else if (token === '--json') {
      args.json = true;
    } else if (token.startsWith('-')) {
      throw new LaunchError(`unknown remove option: ${token}`);
    } else {
      if (args.workspace) throw new LaunchError(`unexpected remove argument: ${token}`);
      args.workspace = token;
    }
  }
  if (args.workspace && args.agentId) throw new LaunchError('--workspace and --agent-id are mutually exclusive');
  if (!args.workspace && !args.agentId) args.workspace = process.cwd();
  return args;
}


function resolveLaunchWorkspace(args) {
  if (args.workspace) return path.resolve(expandPath(args.workspace));
  return agentHomePath(args.agentId);
}


function resolveRemoveWorkspace(args) {
  if (args.agentId) {
    return findConfiguredRootByAgentId(args.agentId) || agentHomePath(args.agentId);
  }
  return path.resolve(expandPath(args.workspace));
}


function runtimeState(workspace, agentIdValue, launchArgs) {
  if (!hasPamemConfig(workspace)) throw new LaunchError(`pamem config not found for root: ${workspace}`);
  const mode = runtimeMode(workspace);
  const instance = readTaskInstanceMetadata(workspace);
  const resolvedAgentId = agentIdValue || configuredAgentId(workspace);
  const state = {
    workspace,
    configFile: pamemConfigPath(workspace),
    runtimeMode: mode,
    agentId: resolvedAgentId,
    instance,
    memoryRepoRoot: memoryRepoRoot(workspace),
    memoryEntryFile: memoryRepoEntryFile(workspace),
    localDir: '',
    currentTaskPath: '',
    workLogPath: '',
    sessionDir: '',
    sessionPath: '',
    taskDir: instance?.task_dir || '',
    launchArgs,
    printEnv: false,
    json: false,
  };
  if (mode === 'cli') {
    if (instance) {
      state.localDir = workspace;
      state.currentTaskPath = path.join(workspace, 'notes', 'current-task.md');
      state.workLogPath = path.join(workspace, 'notes', 'work-log.md');
      state.sessionDir = path.join(workspace, 'sessions');
      state.sessionPath = path.join(state.sessionDir, 'latest.json');
    } else {
      state.localDir = agentLocalDir(workspace, resolvedAgentId);
      state.currentTaskPath = path.join(state.localDir, 'current-task.md');
      state.workLogPath = path.join(state.localDir, 'work-log.md');
      state.sessionPath = path.join(state.localDir, 'session.json');
    }
  } else if (mode === 'slock') {
    state.currentTaskPath = path.join(workspace, 'notes', 'current-task.md');
    state.workLogPath = path.join(workspace, 'notes', 'work-log.md');
  }
  return state;
}


function printStatus(state) {
  const session = state.runtimeMode === 'cli' ? readSession(state.sessionPath) : {};
  const lines = [
    `root=${state.workspace}`,
    `runtime=${state.runtimeMode}`,
    ...(state.instance ? [
      `name=${state.instance.name}`,
      `internal_instance_id=${state.instance.internal_instance_id}`,
      `role=${state.instance.role}`,
    ] : []),
    `agent_id=${state.agentId}`,
    `memory_repo=${state.memoryRepoRoot}`,
    `memory_entry=${path.join(state.memoryRepoRoot, state.memoryEntryFile)}`,
    `task_state=${state.instance ? 'task-instance' : state.runtimeMode === 'slock' ? 'slock' : state.runtimeMode}`,
    `current_task=${state.currentTaskPath}`,
    `work_log=${state.workLogPath}`,
  ];
  if (state.runtimeMode === 'cli') {
    lines.push(`local_dir=${state.localDir}`);
    lines.push(`session_file=${state.sessionPath}`);
    lines.push(`session_id=${typeof session.session_id === 'string' ? session.session_id : ''}`);
    lines.push(`last_command=${Array.isArray(session.last_command) ? session.last_command.map(shellQuote).join(' ') : ''}`);
  }
  console.log(lines.join('\n'));
}


function statusObject(state, session = null) {
  const resolvedSession = session || (state.runtimeMode === 'cli' ? readSession(state.sessionPath) : {});
  if (state.instance) {
    const metadata = state.instance;
    const result = {
      status: 'ok',
      kind: 'task-instance',
      name: metadata.name,
      internal_instance_id: metadata.internal_instance_id,
      root: state.workspace,
      runtime: state.runtimeMode,
      launcher: metadata.launcher || state.runtimeMode,
      role: metadata.role,
      pamem_profile: metadata.pamem_profile,
      agent_id: metadata.agent_id || state.agentId,
      config: state.configFile,
      memory_repo: state.memoryRepoRoot,
      memory_entry: path.join(state.memoryRepoRoot, state.memoryEntryFile),
      task_state: state.runtimeMode === 'slock' ? 'slock' : 'task-instance',
      current_task: state.currentTaskPath,
      work_log: state.workLogPath,
      task_dir: metadata.task_dir,
      agent_home: state.workspace,
      role_skills: metadata.role_skills || roleSkillDefaults(metadata.role),
      capabilities: metadata.capabilities || roleCapabilityEnvelope(metadata.role, {}, metadata),
      disposable: metadata.disposable === true,
    };
    if (state.runtimeMode === 'cli') {
      result.local_dir = state.localDir;
      result.session_file = state.sessionPath;
      result.session_id = typeof resolvedSession.session_id === 'string' ? resolvedSession.session_id : '';
      result.last_action = typeof resolvedSession.last_action === 'string' ? resolvedSession.last_action : '';
      result.session_updated_at = typeof resolvedSession.updated_at === 'string' ? resolvedSession.updated_at : '';
      result.last_command = Array.isArray(resolvedSession.last_command) ? resolvedSession.last_command : [];
    }
    return result;
  }
  const result = {
    status: 'ok',
    kind: isAgentHome(state.workspace) ? 'agent-home' : 'workspace',
    root: state.workspace,
    runtime: state.runtimeMode,
    role: defaultProfile(state.workspace),
    agent_id: state.agentId,
    config: state.configFile,
    memory_repo: state.memoryRepoRoot,
    memory_entry: path.join(state.memoryRepoRoot, state.memoryEntryFile),
    task_state: state.runtimeMode === 'slock' ? 'slock' : state.runtimeMode,
    current_task: state.currentTaskPath,
    work_log: state.workLogPath,
    agent_home: agentLocalDir(state.workspace, state.agentId),
  };
  if (state.runtimeMode === 'cli') {
    result.local_dir = state.localDir;
    result.session_file = state.sessionPath;
    result.session_id = typeof resolvedSession.session_id === 'string' ? resolvedSession.session_id : '';
    result.last_action = typeof resolvedSession.last_action === 'string' ? resolvedSession.last_action : '';
    result.session_updated_at = typeof resolvedSession.updated_at === 'string' ? resolvedSession.updated_at : '';
    result.last_command = Array.isArray(resolvedSession.last_command) ? resolvedSession.last_command : [];
  }
  return result;
}


function ensureCliState(state) {
  fs.mkdirSync(state.localDir, { recursive: true });
  copyIfMissing(path.join(PAMEM_ASSETS_DIR, 'notes', 'current-task.md.template'), state.currentTaskPath);
  copyIfMissing(path.join(PAMEM_ASSETS_DIR, 'notes', 'work-log.md.template'), state.workLogPath);
  cleanStartupSessionHistory(state.currentTaskPath, state.workLogPath);
}


function cleanStartupSessionHistory(currentTaskPath, workLogPath) {
  if (fs.existsSync(currentTaskPath)) {
    const content = fs.readFileSync(currentTaskPath, 'utf8');
    const cleaned = content
      .replace(/\n?<!-- pamem-session:start -->[\s\S]*?<!-- pamem-session:end -->\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*$/, '\n');
    if (cleaned !== content) fs.writeFileSync(currentTaskPath, cleaned);
  }

  if (fs.existsSync(workLogPath)) {
    const content = fs.readFileSync(workLogPath, 'utf8');
    const cleaned = content
      .split(/\r?\n/)
      .filter((line) => !/^\s*-\s+\S+\s+session_id=\S+\s+action=\S+\s+session_file=/.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*$/, '\n');
    if (cleaned !== content) fs.writeFileSync(workLogPath, cleaned);
  }
}


function recordSession(state, action, args) {
  const session = {
    version: 1,
    session_id: cryptoRandomUUID(),
    agent_id: state.agentId,
    root: state.workspace,
    local_dir: state.localDir,
    current_task: state.currentTaskPath,
    work_log: state.workLogPath,
    last_action: action,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    last_command: args,
  };
  if (state.instance) {
    session.task_instance = state.instance.name;
    session.internal_instance_id = state.instance.internal_instance_id;
    session.task_dir = state.instance.task_dir;
    fs.mkdirSync(state.sessionDir, { recursive: true });
    fs.writeFileSync(path.join(state.sessionDir, `${session.session_id}.json`), `${JSON.stringify(session, null, 2)}\n`);
    fs.writeFileSync(state.sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    fs.appendFileSync(path.join(state.sessionDir, 'ledger.jsonl'), `${JSON.stringify(session)}\n`);
    return session;
  }
  fs.mkdirSync(path.dirname(state.sessionPath), { recursive: true });
  fs.writeFileSync(state.sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  return session;
}


function resumeArgs(state) {
  const configured = tomlArrayValues(state.configFile, 'runtime.resume', 'command');
  if (configured.length > 0) return configured;
  const last = readSession(state.sessionPath).last_command;
  return Array.isArray(last) && last.length > 0 ? last : [];
}


function runtimeLaunchArgs(args) {
  if (args.length === 0) return args;
  const command = args[0];
  if (command === 'codex' && !args.includes('--dangerously-bypass-approvals-and-sandbox')) {
    return [command, '--dangerously-bypass-approvals-and-sandbox', ...args.slice(1)];
  }
  if (command === 'claude' && !args.includes('--dangerously-skip-permissions')) {
    return [command, '--dangerously-skip-permissions', ...args.slice(1)];
  }
  return args;
}


function launchEnv(state, action, session) {
  return {
    ...process.env,
    PAMEM_WORKSPACE: state.workspace,
    PAMEM_AGENT_ID: state.agentId,
    PAMEM_AGENT_HOME: state.localDir,
    PAMEM_LOCAL_DIR: state.localDir,
    PAMEM_CURRENT_TASK: state.currentTaskPath,
    PAMEM_WORK_LOG: state.workLogPath,
    PAMEM_SESSION_FILE: state.sessionPath,
    PAMEM_SESSION_ID: typeof session.session_id === 'string' ? session.session_id : '',
    PAMEM_RESUME: action === 'resume' ? '1' : '0',
  };
}


function envLines(state, action = 'start') {
  const session = readSession(state.sessionPath);
  return [
    ['PAMEM_WORKSPACE', state.workspace],
    ['PAMEM_AGENT_ID', state.agentId],
    ['PAMEM_AGENT_HOME', state.localDir],
    ['PAMEM_LOCAL_DIR', state.localDir],
    ['PAMEM_CURRENT_TASK', state.currentTaskPath],
    ['PAMEM_WORK_LOG', state.workLogPath],
    ['PAMEM_SESSION_FILE', state.sessionPath],
    ['PAMEM_SESSION_ID', typeof session.session_id === 'string' ? session.session_id : ''],
    ['PAMEM_RESUME', action === 'resume' ? '1' : '0'],
  ].map(([key, value]) => `export ${key}=${shellQuote(value)}`);
}


function discoverAgents() {
  return [
    ...discoverTaskInstances(),
    ...discoverConfiguredRoots().map((root) => ({
      agent_id: configuredAgentId(root),
      role: defaultProfile(root),
      runtime: runtimeMode(root),
      kind: isAgentHome(root) ? 'agent-home' : 'workspace',
      home: root,
      config: pamemConfigPath(root),
    })),
  ].sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.agent_id.localeCompare(right.agent_id)
    || left.home.localeCompare(right.home)
  ));
}


function discoverTaskInstances() {
  return taskInstanceRoots()
    .map((root) => ({ root, metadata: readTaskInstanceMetadata(root) }))
    .filter(({ metadata }) => metadata && metadata.status !== 'removed')
    .map(({ root, metadata }) => ({
      name: metadata.name,
      internal_instance_id: metadata.internal_instance_id,
      agent_id: metadata.agent_id || metadata.internal_instance_id,
      role: metadata.role,
      pamem_profile: metadata.pamem_profile,
      runtime: metadata.runtime,
      launcher: metadata.launcher,
      kind: 'task-instance',
      status: metadata.status || 'active',
      home: root,
      state_root: root,
      task_dir: metadata.task_dir,
      config: pamemConfigPath(root),
      memory_repo: metadata.memory_repo || (hasPamemConfig(root) ? memoryRepoRoot(root) : ''),
      role_skills: metadata.role_skills || roleSkillDefaults(metadata.role),
      capabilities: metadata.capabilities || roleCapabilityEnvelope(metadata.role, {}, metadata),
      disposable: metadata.disposable === true,
    }));
}


function taskInstanceRoots() {
  const dir = noesisInstancesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => safeRealpath(path.join(dir, entry.name)))
    .filter(Boolean)
    .filter((root) => readTaskInstanceMetadata(root))
    .sort();
}


function discoverConfiguredRoots() {
  const roots = [];
  const seen = new Set();
  for (const dir of [pamemAgentsDir(), slockAgentsDir()]) {
    for (const root of configuredChildren(dir)) {
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }
  }
  return roots.sort();
}


function configuredChildren(dir) {
  if (!fs.existsSync(dir)) return [];
  const roots = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const root = safeRealpath(path.join(dir, name));
    if (root && hasPamemConfig(root)) roots.push(root);
  }
  return roots;
}


function findConfiguredRootByAgentId(resolvedAgentId) {
  for (const candidate of [agentHomePath(resolvedAgentId), path.join(slockAgentsDir(), resolvedAgentId)]) {
    const root = safeRealpath(candidate);
    if (root && hasPamemConfig(root)) return root;
  }
  return discoverConfiguredRoots().find((root) => configuredAgentId(root) === resolvedAgentId) || '';
}


function removeUserLaunchIntegration(workspace) {
  const actions = [];
  const hooksFile = path.join(workspace, '.codex', 'hooks.json');
  const removedHooks = removeCodexMemoryHooks(hooksFile, pamemSessionStartCommands(workspace));
  actions.push({ action: 'remove-codex-hooks', status: 'ok', path: hooksFile, removed: removedHooks });

  const skillsDir = path.join(workspace, '.codex', 'skills');
  const removedSkills = [];
  for (const name of PAMEM_CODEX_SKILLS) {
    const link = path.join(skillsDir, name);
    if (isSymlink(link)) {
      fs.rmSync(link, { force: true });
      removedSkills.push(link);
    }
  }
  actions.push({ action: 'remove-codex-skill-links', status: 'ok', removed: removedSkills });
  return actions;
}


function removeReport(workspace, actions) {
  return {
    status: 'ok',
    command: 'remove',
    workspace,
    config: pamemConfigPath(workspace),
    actions,
    preserved: [
      'Noesis manifest and local state',
      'pamem config',
      'shared memory repo',
      'LoreForge wiki and registry',
    ],
  };
}


function removeCodexMemoryHooks(file, commands) {
  if (!fs.existsSync(file)) return 0;
  const expected = new Set(commands);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const [event, entries] of Object.entries(parsed.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    parsed.hooks[event] = entries.map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      const hooks = entry.hooks.filter((hook) => {
        const keep = !expected.has(hook?.command);
        if (!keep) removed += 1;
        return keep;
      });
      return { ...entry, hooks };
    }).filter((entry) => entry.hooks.length > 0);
  }
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return removed;
}


function pamemSessionStartCommands(workspace) {
  return [
    '.pamem/scripts/memory-session-start.sh',
    path.join(PAMEM_SCRIPTS_DIR, 'memory-session-start.sh'),
    configuredPamemComponentSessionStart(workspace),
  ].filter(Boolean);
}


function configuredPamemComponentSessionStart(workspace) {
  const source = tomlValue(path.join(workspace, '.noesis', 'config.toml'), 'components.pamem', 'component_source');
  if (source) return path.join(expandPath(source, workspace), 'scripts', 'memory-session-start.sh');
  const command = tomlValue(path.join(workspace, '.noesis', 'config.toml'), 'components.pamem', 'required_cli');
  const match = command.match(/^(.+?)\s+(.+)\/bin\/pamem\.mjs(?:\s|$)/);
  return match ? path.join(unquoteShellToken(match[2]), 'scripts', 'memory-session-start.sh') : '';
}


function unquoteShellToken(value) {
  let result = value.trim();
  if (result.startsWith("'") && result.endsWith("'")) {
    result = result.slice(1, -1).replace(/'\\''/g, "'");
  } else if (result.startsWith('"') && result.endsWith('"')) {
    result = result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return result;
}


function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}


function pamemConfigPath(root) {
  const agentConfig = path.join(root, 'config.toml');
  if (fs.existsSync(agentConfig)) return agentConfig;
  return path.join(root, '.pamem', 'config.toml');
}


function hasPamemConfig(root) {
  return fs.existsSync(pamemConfigPath(root));
}


function defaultProfile(root) {
  return configValue(root, '', 'default_profile', 'onboarding');
}


function runtimeMode(root) {
  return configValue(root, 'runtime', 'mode', 'cli');
}


function configuredAgentId(root) {
  const raw = configValue(root, 'runtime', 'agent_id', '');
  if (raw) return raw;
  return `workspace-${cryptoHash(root).slice(0, 16)}`;
}


function agentLocalDir(root, agentIdValue = '') {
  if (isAgentHome(root)) return root;
  return agentHomePath(agentIdValue || configuredAgentId(root));
}


function isAgentHome(root) {
  return fs.existsSync(path.join(root, 'config.toml'));
}


function memoryRepoRoot(root) {
  const rawPath = tomlValue(pamemConfigPath(root), 'memory_repo', 'path');
  if (!rawPath) return path.join(dataHome(), 'pamem', 'memory');
  return expandPath(rawPath, root);
}


function memoryRepoEntryFile(root) {
  return configValue(root, 'memory_repo', 'entry_file', 'MEMORY.md');
}


function configValue(root, section, key, defaultValue) {
  return tomlValue(pamemConfigPath(root), section, key) || defaultValue;
}


function tomlArrayValues(file, section, key) {
  if (!fs.existsSync(file)) return [];
  const sectionHeader = `[${section}]`;
  const values = [];
  let inSection = section === '';
  let inArray = false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/[ \t]*#.*/, '').trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      inSection = line === sectionHeader;
      inArray = false;
      continue;
    }
    if (!inSection) continue;
    if (inArray) {
      values.push(...quotedStrings(line));
      if (line.includes(']')) inArray = false;
      continue;
    }
    const match = line.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`));
    if (!match) continue;
    const value = match[1].trim();
    values.push(...quotedStrings(value));
    if (value.includes('[') && !value.includes(']')) inArray = true;
  }
  return values;
}


function tomlValue(file, section, key) {
  if (!fs.existsSync(file)) return '';
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


function quotedStrings(value) {
  const values = [];
  const pattern = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    values.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return values;
}


function readSession(file) {
  if (!nonEmptyFile(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}


function copyIfMissing(src, dst) {
  if (nonEmptyFile(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, fs.readFileSync(src));
}


function copyTextIfMissing(dst, content) {
  if (nonEmptyFile(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, content.endsWith('\n') ? content : `${content}\n`);
}


function nonEmptyFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').length > 0;
  } catch {
    return false;
  }
}


function dataHome() {
  return process.env.XDG_DATA_HOME || path.join(userHome(), '.local', 'share');
}


function pamemAgentsDir() {
  return path.join(dataHome(), 'pamem', 'agents');
}


function slockAgentsDir() {
  return process.env.PAMEM_SLOCK_AGENTS_DIR || path.join(userHome(), '.slock', 'agents');
}


function agentHomePath(agentIdValue) {
  return path.join(pamemAgentsDir(), agentIdValue);
}


function expandPath(value, base = process.cwd()) {
  let expanded = String(value);
  const dataDefault = '${XDG_DATA_HOME:-$HOME/.local/share}';
  if (expanded === dataDefault || expanded.startsWith(`${dataDefault}/`)) {
    expanded = `${dataHome()}${expanded.slice(dataDefault.length)}`;
  } else if (expanded === '~') {
    expanded = userHome();
  } else if (expanded.startsWith('~/')) {
    expanded = path.join(userHome(), expanded.slice(2));
  }
  if (!path.isAbsolute(expanded)) expanded = path.join(base, expanded);
  return path.resolve(expanded);
}


function emitReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.command === 'remove') {
    console.log(`Noesis remove: ${report.status}`);
    console.log(`Workspace: ${report.workspace}`);
    return;
  }
  if (report.command === 'launch') {
    console.log(`Noesis launch: ${report.status}`);
    console.log(`Workspace: ${report.workspace}`);
    console.log(`Runtime: ${report.runtime}`);
  }
}


function runAndExit(command, args, options = {}) {
  const result = runRuntime(command, args, options);
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.exit(0);
}


function runRuntime(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    return { status: 1, error: result.error };
  }
  return result;
}


function cleanupDisposableSuccess(target) {
  const root = target.workspace;
  if (!isNoesisInstanceRoot(root)) {
    return { status: 'skipped', reason: 'outside-noesis-instance-root', root };
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { status: 'removed', root };
}


function markDisposableFailed(target, reason, args = null) {
  if (!target.disposable) return { status: 'not-disposable', root: target.workspace };
  const metadata = target.metadata || readTaskInstanceMetadata(target.workspace);
  const now = isoTimestamp();
  const role = args?.profile || metadata?.role || '';
  const capabilities = metadata?.capabilities || (role ? roleCapabilityEnvelope(role, args || {}, metadata) : null);
  writeTaskInstanceMetadata(target.workspace, {
    version: 1,
    kind: 'task-instance',
    name: target.name,
    internal_instance_id: target.internalInstanceId,
    role,
    pamem_profile: capabilities?.memory?.profile || metadata?.pamem_profile || '',
    runtime: args?.runtimeMode || metadata?.runtime || '',
    launcher: args?.runtime || metadata?.launcher || '',
    state_root: target.workspace,
    agent_id: target.internalInstanceId,
    memory_repo: metadata?.memory_repo || '',
    memory_entry: metadata?.memory_entry || '',
    task_dir: metadata?.task_dir || path.join(target.workspace, 'tasks', target.name),
    disposable: true,
    created_at: metadata?.created_at || now,
    role_skills: capabilities?.skills?.default || metadata?.role_skills || [],
    ...(metadata || {}),
    ...(capabilities ? { capabilities } : {}),
    status: 'failed-disposable',
    failure_reason: reason,
    updated_at: now,
  });
  return { status: 'preserved-failed-disposable', reason, root: target.workspace };
}


function isNoesisInstanceRoot(root) {
  const resolvedRoot = path.resolve(root);
  const resolvedBase = path.resolve(noesisInstancesDir());
  return resolvedRoot.startsWith(`${resolvedBase}${path.sep}`);
}


function runtimeSkillDirs(root) {
  return {
    codex: path.join(root, '.codex', 'skills'),
    claude: path.join(root, '.claude', 'skills'),
  };
}


function removeSymlinkIfPresent(file) {
  const stat = lstatOrNull(file);
  if (stat?.isSymbolicLink()) fs.unlinkSync(file);
}


function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}


function resolveSymlinkTarget(file) {
  return path.resolve(path.dirname(file), fs.readlinkSync(file));
}


function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}


function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) throw new LaunchError(`missing value for ${option}`);
  return value;
}


function safeRealpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return '';
  }
}


function cryptoHash(value) {
  return createHash('sha256').update(value).digest('hex');
}


function cryptoRandomUUID() {
  return randomUUID();
}


function shellQuote(value) {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function userHome() {
  return path.resolve(process.env.HOME || os.homedir());
}
