import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildSetupReport } from './setup.mjs';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAMEM_REPO_ROOT = path.join(REPO_ROOT, 'node_modules', '@phlens', 'pamem');
const PAMEM_ASSETS_DIR = path.join(PAMEM_REPO_ROOT, 'assets');
const PAMEM_SCRIPTS_DIR = path.join(PAMEM_REPO_ROOT, 'scripts');
const PAMEM_CODEX_SKILLS = ['memory-lint', 'memory-rule', 'sync-request'];
const PAMEM_PROFILES = ['onboarding', 'coder', 'reviewer', 'researcher'];
const LAUNCH_RUNTIMES = ['codex', 'claude', 'cli', 'slock'];


export class LaunchError extends Error {}


export function printLaunchUsage() {
  console.log(`Usage: noesis launch --profile <role> [--runtime codex|claude|cli|slock] [options] [-- <command> [args...]]

Prepare a Noesis workspace or CLI agent home, run doctor, then start or bind the
selected runtime. Noesis owns the user-facing runtime/session UX; memory and
wiki setup remain delegated to pamem and LoreForge owner setup surfaces.

Options:
  --profile <role>              Pamem profile: onboarding,coder,reviewer,researcher.
  --runtime <name>              Runtime launcher: codex,claude,cli,slock. Defaults to codex.
  --agent-id <id>               CLI agent id. Required for cli/codex/claude when --workspace is omitted.
  --workspace <path>            Workspace or agent home. Defaults to XDG data agent home for CLI runtimes.
  --resume                      Resume the previous CLI runtime command.
  --print-env                   Print PAMEM_* exports instead of starting a runtime.
  --runtime-arg <arg>           Append one launcher argument. May be repeated.
  --with <components>           Comma-separated components: pamem,loreforge or none.
                                Defaults to pamem; wiki/domain setup enables LoreForge.
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
  noesis launch --profile researcher --runtime codex --agent-id researcher-local
  noesis launch --profile coder --runtime claude --agent-id coder-local --resume
  noesis launch --profile researcher --runtime slock --workspace <slock-agent-workspace>
  noesis launch --profile researcher --runtime codex --wiki /path/to/wiki --domain gpu-arch-research`);
}


export function printListUsage() {
  console.log(`Usage: noesis list [--json]

List configured pamem CLI agent homes and local Slock workspaces discovered by
Noesis. This is the user-facing replacement for pamem list.`);
}


export function printRemoveUsage() {
  console.log(`Usage: noesis remove [--workspace <path>|--agent-id <id>] [--json]

Remove Noesis/pamem user-launch integration from a workspace or CLI agent home.
This leaves Noesis manifests, pamem configs, shared memory repos, and wiki
content in place. Use owner tools for memory/wiki content cleanup.`);
}


export function runLaunchCommand(tokens, options = {}) {
  const args = parseLaunchArgs(tokens);
  normalizeLaunchRuntime(args);
  validateLaunchArgs(args);

  const workspace = resolveLaunchWorkspace(args);
  const setupTokens = buildSetupTokens(args, workspace);
  const { report: setup, exitCode } = buildSetupReport(setupTokens, {
    version: options.version || '0.1.0',
    print: false,
    preferBundledPamem: true,
  });
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
    emitReport(report, args.json);
    return 1;
  }

  if (args.runtimeMode === 'slock') {
    const state = runtimeState(workspace, args.agentId, []);
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
    emitReport(report, args.json);
    return 0;
  }

  const state = runtimeState(workspace, args.agentId, args.launchArgs);
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
  runAndExit(launchArgs[0], launchArgs.slice(1), {
    cwd: state.workspace,
    env: launchEnv(state, action, session),
  });
  return 0;
}


export function runListCommand(tokens) {
  const args = parseListArgs(tokens);
  const agents = discoverAgents();
  const report = {
    status: 'ok',
    command: 'list',
    agents_dir: pamemAgentsDir(),
    slock_agents_dir: slockAgentsDir(),
    agents,
  };
  if (args.json) {
    emitReport(report, true);
    return 0;
  }
  if (agents.length === 0) {
    console.log(`No Noesis launch workspaces found under ${report.agents_dir} or ${report.slock_agents_dir}`);
    return 0;
  }
  console.log('agent_id\truntime\trole\tkind\thome');
  for (const agent of agents) {
    console.log(`${agent.agent_id}\t${agent.runtime}\t${agent.role}\t${agent.kind}\t${agent.home}`);
  }
  return 0;
}


export function runRemoveCommand(tokens) {
  const args = parseRemoveArgs(tokens);
  const workspace = resolveRemoveWorkspace(args);
  if (!fs.existsSync(workspace)) throw new LaunchError(`workspace does not exist: ${workspace}`);
  const actions = removeUserLaunchIntegration(workspace);
  const report = {
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
  emitReport(report, args.json);
  return 0;
}


function parseLaunchArgs(tokens) {
  const args = {
    profile: '',
    runtime: 'codex',
    runtimeMode: 'cli',
    workspace: '',
    agentId: '',
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
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      args.launchArgs = tokens.slice(index + 1);
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
    } else if (token.startsWith('--runtime=')) {
      args.runtime = token.slice('--runtime='.length);
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
    } else if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
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
    } else if (token.startsWith('--runtime-arg=')) {
      args.launchArgs.push(token.slice('--runtime-arg='.length));
    } else if (token === '--resume') {
      args.resume = true;
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


function normalizeLaunchRuntime(args) {
  if (!LAUNCH_RUNTIMES.includes(args.runtime)) throw new LaunchError(`unsupported runtime: ${args.runtime}`);
  if (args.runtime === 'codex' || args.runtime === 'claude') {
    args.runtimeMode = 'cli';
    if (args.launchArgs.length === 0) {
      args.launchArgs = [args.runtime];
    } else if (args.launchArgs[0] !== args.runtime) {
      args.launchArgs = [args.runtime, ...args.launchArgs];
    }
    return;
  }
  args.runtimeMode = args.runtime;
}


function validateLaunchArgs(args) {
  if (!args.profile) throw new LaunchError('noesis launch requires --profile <onboarding|coder|reviewer|researcher>');
  if (!PAMEM_PROFILES.includes(args.profile)) throw new LaunchError(`unsupported profile: ${args.profile}`);
  if (args.runtimeMode === 'cli' && !args.workspace && !args.agentId) {
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
    '--profile', args.profile,
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
  if (args.withComponents) return args.withComponents;
  if (launchRequestsLoreForge(args)) return 'pamem,loreforge';
  return 'pamem';
}


function launchRequestsLoreForge(args) {
  if (args.loreforgeWiki || args.loreforgeDomain || args.loreforgeRegistry) return true;
  return args.componentSources.some((source) => source.split('=', 1)[0] === 'loreforge');
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
  const resolvedAgentId = agentIdValue || configuredAgentId(workspace);
  const state = {
    workspace,
    configFile: pamemConfigPath(workspace),
    runtimeMode: mode,
    agentId: resolvedAgentId,
    memoryRepoRoot: memoryRepoRoot(workspace),
    memoryEntryFile: memoryRepoEntryFile(workspace),
    localDir: '',
    currentTaskPath: '',
    workLogPath: '',
    sessionPath: '',
    launchArgs,
    printEnv: false,
    json: false,
  };
  if (mode === 'cli') {
    state.localDir = agentLocalDir(workspace, resolvedAgentId);
    state.currentTaskPath = path.join(state.localDir, 'current-task.md');
    state.workLogPath = path.join(state.localDir, 'work-log.md');
    state.sessionPath = path.join(state.localDir, 'session.json');
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
    `agent_id=${state.agentId}`,
    `memory_repo=${state.memoryRepoRoot}`,
    `memory_entry=${path.join(state.memoryRepoRoot, state.memoryEntryFile)}`,
    `task_state=${state.runtimeMode === 'slock' ? 'slock' : state.runtimeMode}`,
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
  fs.mkdirSync(path.dirname(state.sessionPath), { recursive: true });
  fs.writeFileSync(state.sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  updateCurrentTaskSessionBlock(state.currentTaskPath, session, state.sessionPath);
  prependWorkLogSessionEntry(state.workLogPath, session, state.sessionPath);
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
  return discoverConfiguredRoots().map((root) => ({
    agent_id: configuredAgentId(root),
    role: defaultProfile(root),
    runtime: runtimeMode(root),
    kind: isAgentHome(root) ? 'agent-home' : 'workspace',
    home: root,
    config: pamemConfigPath(root),
  })).sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.agent_id.localeCompare(right.agent_id)
    || left.home.localeCompare(right.home)
  ));
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


function updateCurrentTaskSessionBlock(file, session, sessionPath) {
  if (!fs.existsSync(file)) return;
  const start = '<!-- pamem-session:start -->';
  const end = '<!-- pamem-session:end -->';
  const block = [
    start,
    '## Runtime Session',
    `- Latest CLI session_id: \`${session.session_id}\``,
    `- Action: ${session.last_action}`,
    `- Updated at: ${session.updated_at}`,
    `- Session file: \`${sessionPath}\``,
    end,
  ].join('\n');
  const content = fs.readFileSync(file, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(content)) {
    fs.writeFileSync(file, `${content.replace(pattern, block).replace(/\s*$/, '')}\n`);
    return;
  }
  const lines = content.split(/\r?\n/);
  if (lines[0]?.startsWith('# ')) {
    const rest = lines.slice(1).join('\n').replace(/^\n*/, '');
    fs.writeFileSync(file, `${lines[0]}\n\n${block}\n\n${rest.replace(/\s*$/, '')}\n`);
    return;
  }
  fs.writeFileSync(file, `${block}\n\n${content.replace(/\s*$/, '')}\n`);
}


function prependWorkLogSessionEntry(file, session, sessionPath) {
  if (!fs.existsSync(file)) return;
  const heading = '## Runtime Sessions';
  const entry = `- ${session.updated_at} session_id=${session.session_id} action=${session.last_action} session_file=${sessionPath}`;
  const content = fs.readFileSync(file, 'utf8').replace(/\s*$/, '');
  if (content.includes(heading)) {
    const withoutPlaceholder = content.replace(`${heading}\n- No CLI sessions recorded yet.`, heading);
    fs.writeFileSync(file, `${withoutPlaceholder.replace(heading, `${heading}\n${entry}`)}\n`);
    return;
  }
  const lines = content.split(/\r?\n/);
  if (lines[0]?.startsWith('# ')) {
    const rest = lines.slice(1).join('\n').replace(/^\n*/, '');
    fs.writeFileSync(file, `${lines[0]}\n\n${heading}\n${entry}\n\n${rest}\n`);
    return;
  }
  fs.writeFileSync(file, `${heading}\n${entry}\n\n${content}\n`);
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
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.exit(0);
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
