import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED_SKILLS_ROOT = path.join(REPO_ROOT, 'skills');
const PAMEM_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pamem.cmd' : 'pamem');
const PROTECTED_PAMEM_SKILLS = new Set(['memory-lint', 'memory-rule', 'sync-request']);
const RUNTIME_SKILL_DIRS = {
  codex: path.join('.codex', 'skills'),
  claude: path.join('.claude', 'skills'),
};
const PLUGIN_CAPABILITIES = {
  humanize: {
    type: 'plugin-capability',
    claude_key: 'humanize@humania',
  },
  superpowers: {
    type: 'plugin-capability',
    claude_key: 'superpowers@claude-plugins-official',
  },
};
const RUNTIME_CAPABILITIES = {
  pamem: {
    type: 'runtime-capability',
    claude_key: 'pamem@phlens',
  },
};


export class SkillManagerError extends Error {}


export function runSkillCommand(args) {
  if (args.skillCommand === 'help') return 0;
  const target = resolveTarget(args);

  if (args.skillCommand === 'list') {
    const result = listSkills(target);
    return emit(result, formatList(result), args.json);
  }
  if (args.skillCommand === 'inspect') {
    const result = inspectSkill(target, args.name, args.source);
    return emit(result, formatInspect(result), args.json);
  }
  if (args.skillCommand === 'verify') {
    const result = verifySkills(target, args.name, args.source);
    return emit(result, formatVerify(result), args.json, result.status === 'ok' ? 0 : 1);
  }
  if (args.skillCommand === 'add') {
    const result = addSkill(target, args.name, args.source, args.alias, args.runtime);
    return emit(result, formatAdd(result), args.json);
  }
  if (args.skillCommand === 'remove') {
    const result = removeSkill(target, args.name, args.runtime);
    return emit(result, formatRemove(result), args.json);
  }

  throw new SkillManagerError(`unknown skill command: ${args.skillCommand}`);
}


function emit(data, humanText, jsonOutput, exitCode = 0) {
  console.log(jsonOutput ? JSON.stringify(data, null, 2) : humanText);
  return exitCode;
}


function resolveTarget(args) {
  const selected = [Boolean(args.workspace), Boolean(args.agentId), Boolean(args.globalScope)].filter(Boolean).length;
  if (selected > 1) {
    throw new SkillManagerError('--workspace, --agent-id, and --global are mutually exclusive');
  }

  if (args.globalScope) {
    return {
      scope: 'global',
      kind: 'global',
      root: userHome(),
      resolver: 'home',
    };
  }

  if (args.agentId) {
    const agent = resolveAgentRoot(args.agentId);
    requireDirectory(agent.root, `pamem root for agent ${args.agentId}`);
    return {
      scope: 'workspace',
      kind: agent.kind,
      root: agent.root,
      resolver: 'pamem-status',
      agent_id: args.agentId,
      memory_repo: agent.memory_repo,
      agent_home: agent.agent_home,
      role: agent.role,
      runtime: agent.runtime,
    };
  }

  if (args.workspace) {
    const root = expandPath(args.workspace);
    requireDirectory(root, 'workspace');
    return {
      scope: 'workspace',
      kind: 'workspace',
      root,
      resolver: 'explicit-workspace',
    };
  }

  const root = path.resolve(process.cwd());
  requireDirectory(root, 'workspace');
  return {
    scope: 'workspace',
    kind: 'workspace',
    root,
    resolver: 'cwd',
  };
}


function resolveAgentRoot(agentId) {
  const pamemCommand = fs.existsSync(PAMEM_BIN) ? PAMEM_BIN : 'pamem';
  const result = spawnSync(pamemCommand, ['status', '--agent-id', agentId, '--json'], {
    encoding: 'utf8',
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new SkillManagerError('pamem executable not found; --agent-id requires @phlens/pamem or pamem on PATH');
    }
    throw new SkillManagerError(`failed to run pamem status: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SkillManagerError(`pamem status failed for agent ${agentId}${detail ? `: ${detail}` : ''}`);
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch (error) {
    throw new SkillManagerError(`pamem status returned invalid JSON for agent ${agentId}: ${error.message}`);
  }

  if (!data || typeof data.root !== 'string' || data.root.trim() === '') {
    throw new SkillManagerError(`pamem status JSON did not include root for agent ${agentId}`);
  }
  return {
    root: expandPath(data.root),
    kind: data.kind === 'workspace' ? 'workspace' : 'agent-home',
    memory_repo: typeof data.memory_repo === 'string' && data.memory_repo.trim() !== '' ? expandPath(data.memory_repo) : null,
    agent_home: typeof data.agent_home === 'string' && data.agent_home.trim() !== '' ? expandPath(data.agent_home) : null,
    role: typeof data.role === 'string' && data.role.trim() !== '' ? data.role : null,
    runtime: typeof data.runtime === 'string' && data.runtime.trim() !== '' ? data.runtime : null,
  };
}


function listSkills(target) {
  const names = visibleSkillNames(target);
  return {
    command: 'skill list',
    target,
    skill_dirs: skillDirsJson(target),
    skills: names.sort().map((name) => skillRecord(target, name)),
    capabilities: visibleCapabilityRecords(target),
  };
}


function inspectSkill(target, name, sourceArg = null) {
  requireLinkName(name, 'skill name');
  rejectPamemProvidedSkill(name);
  if (capabilityDefinition(name)) return inspectCapability(target, name, sourceArg);
  const source = sourceReport(name, sourceArg);
  const expectedSource = source.status === 'ok' ? source.path : null;
  const skill = skillRecord(target, name, expectedSource);
  if (source.status !== 'ok' && skill.status === 'ok') skill.status = 'source-unresolved';
  return {
    command: 'skill inspect',
    target,
    skill_dirs: skillDirsJson(target),
    source,
    skill,
  };
}


function verifySkills(target, name = null, sourceArg = null) {
  if (name) {
    requireLinkName(name, 'skill name');
    if (capabilityDefinition(name)) return verifyCapability(target, name, sourceArg);
    const inspected = inspectSkill(target, name, sourceArg);
    const failures = [];
    if (inspected.source.status !== 'ok') {
      failures.push({ name, reason: inspected.source.status, detail: inspected.source.error });
    }
    if (inspected.skill.status !== 'ok') {
      failures.push({ name, reason: inspected.skill.status });
    }
    return {
      command: 'skill verify',
      status: failures.length === 0 ? 'ok' : 'failed',
      target: inspected.target,
      skill_dirs: inspected.skill_dirs,
      source: inspected.source,
      skills: [inspected.skill],
      capabilities: [],
      failures,
    };
  }

  const listed = listSkills(target);
  const failures = listed.skills
    .filter((skill) => skill.status !== 'ok')
    .map((skill) => ({ name: skill.name, reason: skill.status }));
  failures.push(
    ...listed.capabilities
      .filter((capability) => capability.status !== 'ok')
      .map((capability) => ({ name: capability.name, reason: capability.status })),
  );
  return {
    command: 'skill verify',
    status: failures.length === 0 ? 'ok' : 'failed',
    target: listed.target,
    skill_dirs: listed.skill_dirs,
    skills: listed.skills,
    capabilities: listed.capabilities,
    failures,
  };
}


function addSkill(target, name, sourceArg = null, alias = null, runtime = null) {
  requireLinkName(name, 'skill name');
  rejectPamemProvidedSkill(name);
  if (capabilityDefinition(name)) {
    if (sourceArg) throw new SkillManagerError(`--source is not supported for ${name}`);
    if (alias) throw new SkillManagerError(`--alias is not supported for ${name}`);
    return addCapability(target, name, runtime);
  }
  const resolvedSource = resolveSource(name, sourceArg);
  validateSource(resolvedSource.path);
  const linkName = alias || path.basename(resolvedSource.path);
  requireLinkName(linkName, 'skill alias');
  const links = Object.fromEntries(
    Object.entries(targetSkillDirs(target)).map(([runtime, skillDir]) => [runtime, path.join(skillDir, linkName)]),
  );

  const problems = [];
  for (const [runtime, link] of Object.entries(links)) {
    if (!lexists(link)) continue;
    const stat = lstatOrNull(link);
    if (!stat?.isSymbolicLink()) {
      problems.push(`${runtime}: non-symlink already exists at ${link}`);
      continue;
    }
  }
  if (problems.length > 0) {
    throw new SkillManagerError(`cannot add skill because target paths are occupied: ${problems.join('; ')}`);
  }

  const actions = [];
  for (const [runtime, link] of Object.entries(links)) {
    const skillDir = path.dirname(link);
    fs.mkdirSync(skillDir, { recursive: true });
    if (lexists(link)) {
      if (samePath(resolveSymlinkTarget(link), resolvedSource.path)) {
        actions.push({ runtime, path: link, action: 'already-present' });
        continue;
      }
      const previousTarget = fs.readlinkSync(link);
      fs.unlinkSync(link);
      const relativeTarget = path.relative(skillDir, resolvedSource.path);
      fs.symlinkSync(relativeTarget, link);
      if (!samePath(resolveSymlinkTarget(link), resolvedSource.path)) {
        throw new SkillManagerError(`repaired symlink did not resolve to expected source: ${link}`);
      }
      actions.push({ runtime, path: link, action: 'repaired', previous_target: previousTarget, target: relativeTarget });
      continue;
    }
    const relativeTarget = path.relative(skillDir, resolvedSource.path);
    fs.symlinkSync(relativeTarget, link);
    if (!samePath(resolveSymlinkTarget(link), resolvedSource.path)) {
      throw new SkillManagerError(`created symlink did not resolve to expected source: ${link}`);
    }
    actions.push({ runtime, path: link, action: 'created', target: relativeTarget });
  }

  const inspected = inspectSkill(target, linkName, resolvedSource.path);
  if (inspected.skill.status !== 'ok') {
    throw new SkillManagerError(`skill was added but verification failed with status ${inspected.skill.status}`);
  }

  return {
    command: 'skill add',
    target,
    skill_dirs: skillDirsJson(target),
    source: inspected.source,
    skill: inspected.skill,
    actions,
  };
}


function removeSkill(target, name, runtime = null) {
  requireLinkName(name, 'skill name');
  rejectPamemProvidedSkill(name);
  if (capabilityDefinition(name)) return removeCapability(target, name, runtime);
  const links = Object.fromEntries(
    Object.entries(targetSkillDirs(target)).map(([runtime, skillDir]) => [runtime, path.join(skillDir, name)]),
  );
  const problems = [];
  for (const [runtime, link] of Object.entries(links)) {
    const stat = lstatOrNull(link);
    if (stat && !stat.isSymbolicLink()) problems.push(`${runtime}: non-symlink exists at ${link}`);
  }
  if (problems.length > 0) {
    throw new SkillManagerError(`refusing to remove non-symlink paths: ${problems.join('; ')}`);
  }

  const actions = [];
  for (const [runtime, link] of Object.entries(links)) {
    const stat = lstatOrNull(link);
    if (stat?.isSymbolicLink()) {
      const targetText = fs.readlinkSync(link);
      fs.unlinkSync(link);
      actions.push({ runtime, path: link, action: 'removed', target: targetText });
    } else {
      actions.push({ runtime, path: link, action: 'missing' });
    }
  }

  const inspected = inspectSkill(target, name);
  return {
    command: 'skill remove',
    target,
    skill_dirs: skillDirsJson(target),
    skill: inspected.skill,
    actions,
  };
}


function skillRecord(target, name, expectedSource = null) {
  const runtimes = Object.fromEntries(
    Object.entries(targetSkillDirs(target)).map(([runtime, skillDir]) => [
      runtime,
      linkInfo(path.join(skillDir, name), expectedSource),
    ]),
  );
  return {
    name,
    type: 'symlink-skill',
    status: aggregateStatus(runtimes),
    runtimes,
  };
}


function visibleSkillNames(target) {
  const names = new Set();
  for (const skillDir of Object.values(targetSkillDirs(target))) {
    let entries = [];
    try {
      entries = fs.readdirSync(skillDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) names.add(entry.name);
  }
  return [...names];
}


function targetSkillDirs(target) {
  return Object.fromEntries(
    Object.entries(RUNTIME_SKILL_DIRS).map(([runtime, relativePath]) => [runtime, path.join(target.root, relativePath)]),
  );
}


function skillDirsJson(target) {
  return targetSkillDirs(target);
}


function visibleCapabilityRecords(target) {
  return Object.entries({ ...PLUGIN_CAPABILITIES, ...RUNTIME_CAPABILITIES })
    .map(([name]) => capabilityRecord(target, name))
    .filter((capability) => capability.status !== 'missing');
}


function inspectCapability(target, name, sourceArg = null) {
  if (sourceArg) throw new SkillManagerError(`--source is not supported for ${name}`);
  return {
    command: 'skill inspect',
    target,
    skill_dirs: skillDirsJson(target),
    source: {
      status: 'not-applicable',
      path: null,
      kind: capabilityDefinition(name).type,
      source_kind: capabilityDefinition(name).type,
      root: null,
      skill_md: null,
      has_skill_md: false,
    },
    skill: null,
    capability: capabilityRecord(target, name),
  };
}


function verifyCapability(target, name, sourceArg = null) {
  if (sourceArg) throw new SkillManagerError(`--source is not supported for ${name}`);
  const inspected = inspectCapability(target, name);
  const failures = inspected.capability.status === 'ok'
    ? []
    : [{ name, reason: inspected.capability.status }];
  return {
    command: 'skill verify',
    status: failures.length === 0 ? 'ok' : 'failed',
    target: inspected.target,
    skill_dirs: inspected.skill_dirs,
    source: inspected.source,
    skills: [],
    capabilities: [inspected.capability],
    failures,
  };
}


function addCapability(target, name, runtime = null) {
  const definition = capabilityDefinition(name);
  if (definition.type === 'plugin-capability') {
    const actions = [setClaudePlugin(target, name, definition.claude_key, true)];
    const inspected = inspectCapability(target, name);
    ensureCapabilityMutationVerified(inspected.capability, ['claude'], true);
    return {
      command: 'skill add',
      target,
      skill_dirs: skillDirsJson(target),
      source: inspected.source,
      skill: null,
      capability: inspected.capability,
      actions,
    };
  }
  if (name === 'pamem') return addPamemCapability(target, runtime);
  throw new SkillManagerError(`unsupported capability: ${name}`);
}


function removeCapability(target, name, runtime = null) {
  const definition = capabilityDefinition(name);
  if (definition.type === 'plugin-capability') {
    const actions = [setClaudePlugin(target, name, definition.claude_key, false)];
    const inspected = inspectCapability(target, name);
    ensureCapabilityMutationVerified(inspected.capability, ['claude'], false);
    return {
      command: 'skill remove',
      target,
      skill_dirs: skillDirsJson(target),
      skill: null,
      capability: inspected.capability,
      actions,
    };
  }
  if (name === 'pamem') return removePamemCapability(target, runtime);
  throw new SkillManagerError(`unsupported capability: ${name}`);
}


function addPamemCapability(target, runtime = null) {
  const runtimes = resolvePamemMutationRuntimes(target, runtime, 'add');
  const actions = [];
  if (runtimes.includes('claude')) {
    actions.push(setClaudePlugin(target, 'pamem', RUNTIME_CAPABILITIES.pamem.claude_key, true));
  }
  if (runtimes.includes('codex')) {
    actions.push(runPamemBootstrap(target, 'install'));
  }
  const inspected = inspectCapability(target, 'pamem');
  ensureCapabilityMutationVerified(inspected.capability, runtimes, true);
  return {
    command: 'skill add',
    target,
    skill_dirs: skillDirsJson(target),
    source: inspected.source,
    skill: null,
    capability: inspected.capability,
    actions,
  };
}


function removePamemCapability(target, runtime = null) {
  const runtimes = resolvePamemMutationRuntimes(target, runtime, 'remove');
  const actions = [];
  if (runtimes.includes('claude')) {
    actions.push(setClaudePlugin(target, 'pamem', RUNTIME_CAPABILITIES.pamem.claude_key, false));
  }
  if (runtimes.includes('codex')) {
    actions.push(runPamemBootstrap(target, 'remove'));
  }
  const inspected = inspectCapability(target, 'pamem');
  ensureCapabilityMutationVerified(inspected.capability, runtimes, false);
  return {
    command: 'skill remove',
    target,
    skill_dirs: skillDirsJson(target),
    skill: null,
    capability: inspected.capability,
    actions,
  };
}


function ensureCapabilityMutationVerified(capability, runtimes, enabled) {
  const expected = enabled ? 'ok' : 'missing';
  const failures = runtimes
    .map((runtime) => [runtime, capability.runtimes[runtime]?.status || 'unknown'])
    .filter(([, status]) => status !== expected);
  if (failures.length === 0) return;
  const action = enabled ? 'add' : 'remove';
  throw new SkillManagerError(`${capability.name} ${action} verification failed: ${failures.map(([runtime, status]) => `${runtime} is ${status}`).join(', ')}`);
}


function capabilityRecord(target, name) {
  const definition = capabilityDefinition(name);
  if (!definition) {
    throw new SkillManagerError(`unknown capability: ${name}`);
  }

  const claude = claudePluginInfo(target, definition.claude_key);
  const record = {
    name,
    type: definition.type,
    status: claude.status,
    claude_key: definition.claude_key,
    runtimes: {
      claude,
    },
  };

  if (definition.type === 'runtime-capability') {
    const codex = codexPamemInfo(target);
    record.runtimes.codex = codex;
    record.runtime_mode = runtimeCapabilityMode(claude.status, codex.status);
    record.status = aggregateRuntimeCapabilityStatus(claude.status, codex.status);
  }

  return record;
}


function capabilityDefinition(name) {
  return PLUGIN_CAPABILITIES[name] || RUNTIME_CAPABILITIES[name] || null;
}


function rejectPamemProvidedSkill(name) {
  if (!PROTECTED_PAMEM_SKILLS.has(name)) return;
  throw new SkillManagerError(`${name} is provided by pamem; manage the pamem runtime capability instead`);
}


function setClaudePlugin(target, name, pluginKey, enabled) {
  const settingsPath = claudeSettingsPath(target);
  const current = claudePluginInfo(target, pluginKey);
  if (current.status === 'invalid') {
    throw new SkillManagerError(`cannot inspect Claude plugin ${pluginKey}: ${current.error}`);
  }
  const data = readJsonObjectOrEmpty(settingsPath);
  data.enabledPlugins = objectOrEmpty(data.enabledPlugins);
  const alreadyEnabled = data.enabledPlugins[pluginKey] === true;

  if (enabled) {
    if (current.enabled) {
      return {
        type: 'claude-plugin',
        capability: name,
        key: pluginKey,
        path: settingsPath,
        action: 'already-enabled',
        source: current.source || null,
      };
    }
    const cliAction = runClaudePluginCli(target, pluginKey, enabled);
    if (cliAction.method === 'settings-json') {
      data.enabledPlugins[pluginKey] = true;
      writeJsonObject(settingsPath, data);
    }
    return {
      type: 'claude-plugin',
      capability: name,
      key: pluginKey,
      path: settingsPath,
      action: 'enabled',
      ...cliAction,
    };
  }

  if (!current.enabled) {
    return {
      type: 'claude-plugin',
      capability: name,
      key: pluginKey,
      path: settingsPath,
      action: 'already-disabled',
    };
  }

  const cliAction = runClaudePluginCli(target, pluginKey, enabled);
  if (cliAction.method === 'settings-json' && alreadyEnabled) {
    delete data.enabledPlugins[pluginKey];
    writeJsonObject(settingsPath, data);
  }
  return {
    type: 'claude-plugin',
    capability: name,
    key: pluginKey,
    path: settingsPath,
    action: 'disabled',
    ...cliAction,
  };
}


function runClaudePluginCli(target, pluginKey, enabled) {
  const scope = claudePluginScope(target);
  const subcommand = enabled ? 'install' : 'uninstall';
  const args = ['plugin', subcommand, pluginKey, '-s', scope];
  const result = spawnSync('claude', args, {
    cwd: target.root,
    encoding: 'utf8',
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') return { method: 'settings-json' };
    throw new SkillManagerError(`failed to run claude plugin ${subcommand}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SkillManagerError(`claude plugin ${subcommand} failed for ${pluginKey}${detail ? `: ${detail}` : ''}`);
  }
  return {
    method: 'claude-cli',
    command: `claude plugin ${subcommand}`,
    scope,
    stdout: result.stdout.trim(),
  };
}


function claudeSettingsPath(target) {
  return path.join(target.root, '.claude', 'settings.json');
}


function runPamemBootstrap(target, command) {
  if (target.scope === 'global') {
    throw new SkillManagerError('global pamem codex bootstrap requires an explicit workspace target');
  }
  const pamemCommand = fs.existsSync(PAMEM_BIN) ? PAMEM_BIN : 'pamem';
  const args = [command, target.root];
  if (command === 'install' && codexPamemLayout(target) === 'agent-home') args.push('--agent-home');
  const result = spawnSync(pamemCommand, args, {
    encoding: 'utf8',
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new SkillManagerError(`pamem executable not found; pamem ${command} requires @phlens/pamem or pamem on PATH`);
    }
    throw new SkillManagerError(`failed to run pamem ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new SkillManagerError(`pamem ${command} failed for ${target.root}${detail ? `: ${detail}` : ''}`);
  }
  return {
    type: 'pamem-runtime',
    runtime: 'codex',
    command: `pamem ${command}`,
    path: target.root,
    action: command === 'install' ? 'installed' : 'removed',
    stdout: result.stdout.trim(),
  };
}


function resolvePamemMutationRuntimes(target, runtime, command) {
  if (target.scope === 'global') {
    if (runtime && runtime !== 'claude') {
      throw new SkillManagerError('global pamem codex bootstrap is not supported; pass an explicit workspace');
    }
    return ['claude'];
  }
  if (runtime === 'codex') return ['codex'];
  if (runtime === 'claude') return ['claude'];
  if (runtime === 'both') return ['claude', 'codex'];

  const current = capabilityRecord(target, 'pamem');
  if (command === 'remove') {
    if (current.runtime_mode === 'claude') return ['claude'];
    if (current.runtime_mode === 'codex') return ['codex'];
    if (current.runtime_mode === 'both') return ['claude', 'codex'];
    return ['claude'];
  }
  if (current.runtime_mode === 'codex') return ['codex'];
  if (current.runtime_mode === 'claude') return ['claude'];
  const hasCodex = hasCodexWorkspaceSignals(target.root);
  const hasClaude = hasClaudeWorkspaceSignals(target.root);
  if (hasCodex && !hasClaude) return ['codex'];
  if (hasClaude && !hasCodex) return ['claude'];
  throw new SkillManagerError('pamem add requires --runtime when the target runtime is ambiguous');
}


function hasCodexWorkspaceSignals(root) {
  return isDirectory(path.join(root, '.codex')) || isFile(path.join(root, '.codex', 'config.toml'));
}


function hasClaudeWorkspaceSignals(root) {
  return isDirectory(path.join(root, '.claude')) || isFile(path.join(root, '.claude', 'settings.json'));
}


function runtimeCapabilityMode(claudeStatus, codexStatus) {
  const hasClaude = claudeStatus !== 'missing';
  const hasCodex = codexStatus !== 'missing';
  if (hasClaude && hasCodex) return 'both';
  if (hasClaude) return 'claude';
  if (hasCodex) return 'codex';
  return 'unknown';
}


function aggregateRuntimeCapabilityStatus(claudeStatus, codexStatus) {
  const statuses = [claudeStatus, codexStatus];
  if (statuses.every((status) => status === 'missing')) return 'missing';
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('partial')) return 'partial';
  if (statuses.includes('ok')) return 'ok';
  return 'unknown';
}


function claudePluginInfo(target, pluginKey) {
  const settingsPath = claudeSettingsPath(target);
  const scope = claudePluginScope(target);
  const info = {
    status: 'missing',
    path: settingsPath,
    key: pluginKey,
    scope,
    enabled: false,
  };
  if (!isFile(settingsPath)) return claudePluginCliInfo(target, pluginKey, info);

  const parsed = readJsonObject(settingsPath);
  if (parsed.status !== 'ok') {
    return {
      ...info,
      status: 'invalid',
      error: parsed.error,
    };
  }

  const enabledPlugins = parsed.value.enabledPlugins;
  if (!enabledPlugins || Array.isArray(enabledPlugins) || typeof enabledPlugins !== 'object') {
    return claudePluginCliInfo(target, pluginKey, info);
  }
  info.enabled = enabledPlugins[pluginKey] === true;
  if (info.enabled) {
    info.status = 'ok';
    info.source = 'settings-json';
    return info;
  }
  return claudePluginCliInfo(target, pluginKey, info);
}


function claudePluginCliInfo(target, pluginKey, baseInfo) {
  const result = spawnSync('claude', ['plugin', 'list', '--json'], {
    cwd: target.root,
    encoding: 'utf8',
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') return baseInfo;
    return {
      ...baseInfo,
      status: 'invalid',
      error: `failed to run claude plugin list: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      ...baseInfo,
      status: 'invalid',
      error: `claude plugin list failed${detail ? `: ${detail}` : ''}`,
    };
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch (error) {
    return {
      ...baseInfo,
      status: 'invalid',
      error: `claude plugin list returned invalid JSON: ${error.message}`,
    };
  }

  const plugins = claudePluginListEntries(data);
  if (!plugins) {
    return {
      ...baseInfo,
      status: 'invalid',
      error: 'claude plugin list JSON did not contain plugin entries',
    };
  }

  const found = plugins.find((plugin) => (
    plugin
    && plugin.id === pluginKey
    && plugin.enabled === true
    && plugin.scope === baseInfo.scope
    && claudePluginProjectMatches(target, plugin)
  ));
  if (!found) return baseInfo;
  return {
    ...baseInfo,
    status: 'ok',
    enabled: true,
    source: 'claude-cli',
    version: typeof found.version === 'string' ? found.version : null,
    install_path: typeof found.installPath === 'string' ? found.installPath : null,
  };
}


function claudePluginListEntries(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.installed)) return data.installed;
  return null;
}


function claudePluginProjectMatches(target, plugin) {
  if (target.scope === 'global') return true;
  if (typeof plugin.projectPath !== 'string' || plugin.projectPath.trim() === '') return true;
  return samePath(plugin.projectPath, target.root);
}


function claudePluginScope(target) {
  return target.scope === 'global' ? 'user' : 'project';
}


function codexPamemInfo(target) {
  const configPath = path.join(target.root, '.codex', 'config.toml');
  const hooksPath = path.join(target.root, '.codex', 'hooks.json');
  const layout = codexPamemLayout(target);
  const config = codexConfigInfo(configPath);
  const hooks = codexHooksInfo(hooksPath, layout);
  const local = codexPamemLocalFiles(target, layout);

  if (hooks.status === 'missing') {
    return {
      status: 'missing',
      config,
      hooks,
      ...local,
    };
  }

  const checks = [config, hooks, ...Object.values(local)];
  return {
    status: aggregateRuntimeStatus(checks.map((check) => check.status)),
    config,
    hooks,
    ...local,
  };
}


function codexPamemLayout(target) {
  if (isFile(path.join(target.root, 'config.toml')) && !isFile(path.join(target.root, '.pamem', 'config.toml'))) {
    return 'agent-home';
  }
  if (isDirectory(path.join(target.root, '.pamem')) || isFile(path.join(target.root, '.pamem', 'config.toml'))) {
    return 'workspace';
  }
  return target.kind === 'agent-home' ? 'agent-home' : 'workspace';
}


function codexPamemLocalFiles(target, layout) {
  if (layout === 'agent-home') {
    return {
      pamem_config: fileStatus(path.join(target.root, 'config.toml')),
      current_task: fileStatus(path.join(target.root, 'current-task.md')),
      work_log: fileStatus(path.join(target.root, 'work-log.md')),
    };
  }
  return {
    foundation: directoryStatus(path.join(target.root, '.pamem')),
    memory: fileStatus(path.join(target.root, 'MEMORY.md')),
    current_task: fileStatus(path.join(target.root, 'notes', 'current-task.md')),
    work_log: fileStatus(path.join(target.root, 'notes', 'work-log.md')),
  };
}


function codexConfigInfo(configPath) {
  const info = {
    path: configPath,
    status: 'missing',
    codex_hooks: false,
  };
  if (!isFile(configPath)) return info;
  const text = fs.readFileSync(configPath, 'utf8');
  info.codex_hooks = /^[ \t]*codex_hooks[ \t]*=[ \t]*true[ \t]*$/m.test(text);
  info.status = info.codex_hooks ? 'ok' : 'missing';
  return info;
}


function codexHooksInfo(hooksPath, layout) {
  const info = {
    path: hooksPath,
    status: 'missing',
    session_start: false,
    command: null,
    expected_command: layout === 'agent-home' ? null : '.pamem/scripts/memory-session-start.sh',
  };
  if (!isFile(hooksPath)) return info;

  const parsed = readJsonObject(hooksPath);
  if (parsed.status !== 'ok') {
    return {
      ...info,
      status: 'invalid',
      error: parsed.error,
    };
  }

  const event = parsed.value.hooks?.SessionStart;
  if (!Array.isArray(event)) return info;

  const hook = event
    .filter((entry) => entry && entry.matcher === 'startup|resume' && Array.isArray(entry.hooks))
    .flatMap((entry) => entry.hooks)
    .find((candidate) => (
      candidate
      && candidate.type === 'command'
      && typeof candidate.command === 'string'
      && pamemSessionStartCommandMatches(candidate.command, layout)
    ));

  if (!hook) return info;
  info.status = 'ok';
  info.session_start = true;
  info.command = hook.command;
  return info;
}


function pamemSessionStartCommandMatches(command, layout) {
  if (layout === 'agent-home') {
    return path.basename(command) === 'memory-session-start.sh' && path.isAbsolute(command);
  }
  return command === '.pamem/scripts/memory-session-start.sh';
}


function aggregateRuntimeStatus(statuses) {
  if (statuses.every((status) => status === 'missing')) return 'missing';
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('missing')) return 'partial';
  if (statuses.every((status) => status === 'ok')) return 'ok';
  return 'unknown';
}


function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return { status: 'invalid', value: null, error: 'expected a JSON object' };
    }
    return { status: 'ok', value };
  } catch (error) {
    return { status: 'invalid', value: null, error: error.message };
  }
}


function readJsonObjectOrEmpty(file) {
  if (!isFile(file)) return {};
  const parsed = readJsonObject(file);
  if (parsed.status !== 'ok') {
    throw new SkillManagerError(`invalid JSON at ${file}: ${parsed.error}`);
  }
  return parsed.value;
}


function writeJsonObject(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}


function objectOrEmpty(value) {
  return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
}


function fileStatus(targetPath) {
  return {
    path: targetPath,
    status: isFile(targetPath) ? 'ok' : 'missing',
  };
}


function directoryStatus(targetPath) {
  return {
    path: targetPath,
    status: isDirectory(targetPath) ? 'ok' : 'missing',
  };
}


function linkInfo(link, expectedSource = null) {
  const data = {
    path: link,
    status: 'missing',
    kind: 'missing',
    target: null,
    resolved: null,
    matches_source: null,
    relative_target: null,
  };

  const stat = lstatOrNull(link);
  if (!stat) {
    data.matches_source = expectedSource === null;
    return data;
  }

  if (!stat.isSymbolicLink()) {
    data.status = 'conflict';
    data.kind = stat.isDirectory() ? 'directory' : 'file';
    data.matches_source = false;
    return data;
  }

  const targetText = fs.readlinkSync(link);
  const resolved = resolveSymlinkTarget(link);
  data.kind = 'symlink';
  data.target = targetText;
  data.resolved = existingRealpathOrResolved(resolved);
  data.relative_target = !path.isAbsolute(targetText);
  data.matches_source = expectedSource === null ? null : samePath(resolved, expectedSource);

  const resolvedStat = statOrNull(resolved);
  if (!resolvedStat) {
    data.status = 'broken';
  } else if (!resolvedStat.isDirectory() || !isFile(path.join(resolved, 'SKILL.md'))) {
    data.status = 'invalid-source';
  } else if (expectedSource !== null && !samePath(resolved, expectedSource)) {
    data.status = 'mismatch';
  } else {
    data.status = 'ok';
  }
  return data;
}


function aggregateStatus(runtimes) {
  const statuses = Object.values(runtimes).map((info) => info.status);
  if (statuses.every((status) => status === 'missing')) return 'missing';
  for (const status of ['conflict', 'broken', 'invalid-source', 'mismatch']) {
    if (statuses.includes(status)) return status;
  }
  if (statuses.includes('missing')) return 'mismatch';

  const resolved = new Set(
    Object.values(runtimes)
      .filter((info) => info.status === 'ok' && typeof info.resolved === 'string')
      .map((info) => existingRealpathOrResolved(info.resolved)),
  );
  if (resolved.size > 1) return 'mismatch';
  if (statuses.every((status) => status === 'ok')) return 'ok';
  return 'unknown';
}


function sourceReport(name, sourceArg = null) {
  try {
    const source = resolveSource(name, sourceArg);
    const skillMd = path.join(source.path, 'SKILL.md');
    const hasSkillMd = isFile(skillMd);
    return {
      status: hasSkillMd ? 'ok' : 'invalid-source',
      path: source.path,
      kind: source.kind,
      source_kind: source.kind,
      root: source.root,
      skill_md: skillMd,
      has_skill_md: hasSkillMd,
      ...(hasSkillMd ? {} : { error: `missing SKILL.md at ${skillMd}` }),
    };
  } catch (error) {
    if (!(error instanceof SkillManagerError)) throw error;
    return {
      status: 'unresolved',
      path: null,
      kind: null,
      root: null,
      skill_md: null,
      has_skill_md: false,
      error: error.message,
    };
  }
}


function resolveSource(name, sourceArg = null) {
  if (sourceArg) {
    const sourcePath = expandPath(sourceArg);
    const { kind, root } = classifySource(sourcePath);
    if (!isDirectory(sourcePath)) throw new SkillManagerError(`skill source directory not found: ${sourcePath}`);
    return { path: existingRealpathOrResolved(sourcePath), kind, root };
  }

  requireLinkName(name, 'skill name');
  const roots = sourceRoots();
  for (const { kind, root } of roots) {
    const matches = findSourceMatches(root, name);
    if (matches.length > 1) {
      throw new SkillManagerError(`multiple ${kind} skill sources named ${name}; pass --source explicitly: ${matches.join(', ')}`);
    }
    if (matches.length === 1) return { path: matches[0], kind, root };
  }

  throw new SkillManagerError(`skill source not found under ${roots.map((sourceRoot) => sourceRoot.root).join(', ')}: ${name}`);
}


function sourceRoots() {
  return [
    { kind: 'managed', root: MANAGED_SKILLS_ROOT },
    { kind: 'external', root: path.join(userHome(), 'skills') },
  ];
}


function findSourceMatches(root, name) {
  if (!isDirectory(root)) return [];
  const matches = [];
  const walk = (directory) => {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (entry.name === name) matches.push(existingRealpathOrResolved(child));
      walk(child);
    }
  };
  walk(root);
  return [...new Set(matches)].sort();
}


function classifySource(sourcePath) {
  const resolvedSource = existingRealpathOrResolved(sourcePath);
  for (const { kind, root } of sourceRoots()) {
    if (isRelativeTo(resolvedSource, root)) return { kind, root };
  }
  throw new SkillManagerError(`explicit source must be under one of: ${sourceRoots().map((sourceRoot) => sourceRoot.root).join(', ')}; got ${resolvedSource}`);
}


function validateSource(sourcePath) {
  if (!isDirectory(sourcePath)) throw new SkillManagerError(`skill source directory not found: ${sourcePath}`);
  const skillMd = path.join(sourcePath, 'SKILL.md');
  if (!isFile(skillMd)) throw new SkillManagerError(`skill source is missing SKILL.md: ${skillMd}`);
}


function requireLinkName(name, label) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new SkillManagerError(`${label} must be a non-empty basename`);
  }
  if (path.basename(name) !== name || path.isAbsolute(name) || name === '.' || name === '..') {
    throw new SkillManagerError(`${label} must be a basename without path separators: ${name}`);
  }
}


function formatList(result) {
  const lines = targetHeader(result);
  if (result.skills.length === 0 && result.capabilities.length === 0) {
    lines.push('No visible skills.');
    return lines.join('\n');
  }
  if (result.skills.length > 0) lines.push('Skills:');
  for (const skill of result.skills) lines.push(formatSkillSummary(skill));
  if (result.capabilities.length > 0) {
    lines.push('Capabilities:');
    for (const capability of result.capabilities) lines.push(formatCapabilitySummary(capability));
  }
  return lines.join('\n');
}


function formatInspect(result) {
  const lines = targetHeader(result);
  if (result.capability) {
    lines.push(formatCapabilitySummary(result.capability, true));
    return lines.join('\n');
  }
  if (result.source.status === 'ok') {
    lines.push(`Source: ${result.source.path} (${result.source.kind})`);
  } else {
    lines.push(`Source: ${result.source.status} (${result.source.error})`);
  }
  lines.push(formatSkillSummary(result.skill, true));
  return lines.join('\n');
}


function formatVerify(result) {
  const lines = targetHeader(result);
  lines.push(result.status === 'ok' ? 'Verification: ok' : 'Verification: failed');
  for (const failure of result.failures) {
    lines.push(`  ${failure.name}: ${failure.reason}${failure.detail ? ` - ${failure.detail}` : ''}`);
  }
  for (const skill of result.skills) lines.push(formatSkillSummary(skill));
  for (const capability of result.capabilities) lines.push(formatCapabilitySummary(capability));
  return lines.join('\n');
}


function formatAdd(result) {
  const lines = targetHeader(result);
  if (result.capability) {
    lines.push(`Added capability: ${result.capability.name}`);
    for (const action of result.actions) lines.push(formatAction(action));
    return lines.join('\n');
  }
  lines.push(`Added skill: ${result.skill.name}`);
  lines.push(`Source: ${result.source.path} (${result.source.kind})`);
  for (const action of result.actions) {
    lines.push(formatAction(action));
  }
  return lines.join('\n');
}


function formatRemove(result) {
  const lines = targetHeader(result);
  if (result.capability) {
    lines.push(`Removed capability: ${result.capability.name}`);
    for (const action of result.actions) lines.push(formatAction(action));
    return lines.join('\n');
  }
  lines.push(`Removed skill visibility: ${result.skill.name}`);
  for (const action of result.actions) lines.push(formatAction(action));
  return lines.join('\n');
}


function formatAction(action) {
  if (action.type === 'claude-plugin') {
    return `  claude: ${action.action} ${action.key} at ${action.path}`;
  }
  if (action.type === 'pamem-runtime') {
    return `  ${action.runtime}: ${action.action} ${action.path}`;
  }
  return `  ${action.runtime}: ${action.action} ${action.path}${action.target ? ` -> ${action.target}` : ''}`;
}


function targetHeader(result) {
  const lines = [`Target: ${result.target.scope} ${result.target.root} (${result.target.resolver})`, 'Skill dirs:'];
  for (const [runtime, skillDir] of Object.entries(result.skill_dirs)) lines.push(`  ${runtime}: ${skillDir}`);
  return lines;
}


function formatSkillSummary(skill, includeLinks = false) {
  const lines = [`${skill.name}: ${skill.status}`];
  if (includeLinks) {
    for (const [runtime, info] of Object.entries(skill.runtimes)) {
      lines.push(`  ${runtime}: ${info.status} ${info.path}${info.target ? ` -> ${info.target}` : ''}${info.resolved ? ` (${info.resolved})` : ''}`);
    }
  }
  return lines.join('\n');
}


function formatCapabilitySummary(capability, includeDetails = false) {
  const lines = [`${capability.name}: ${capability.status} (${capability.type})`];
  lines.push(`  claude: ${capability.runtimes.claude.status} ${capability.claude_key}`);
  if (includeDetails) {
    lines[lines.length - 1] += ` at ${capability.runtimes.claude.path}`;
  }
  if (capability.runtimes.codex) {
    lines.push(`  codex: ${capability.runtimes.codex.status}`);
    if (includeDetails) {
      lines.push(`    config: ${capability.runtimes.codex.config.status} ${capability.runtimes.codex.config.path}`);
      lines.push(`    hooks: ${capability.runtimes.codex.hooks.status} ${capability.runtimes.codex.hooks.path}`);
      if (capability.runtimes.codex.foundation) {
        lines.push(`    foundation: ${capability.runtimes.codex.foundation.status} ${capability.runtimes.codex.foundation.path}`);
      }
      if (capability.runtimes.codex.memory) {
        lines.push(`    memory: ${capability.runtimes.codex.memory.status} ${capability.runtimes.codex.memory.path}`);
      }
      if (capability.runtimes.codex.pamem_config) {
        lines.push(`    pamem_config: ${capability.runtimes.codex.pamem_config.status} ${capability.runtimes.codex.pamem_config.path}`);
      }
      lines.push(`    current_task: ${capability.runtimes.codex.current_task.status} ${capability.runtimes.codex.current_task.path}`);
      lines.push(`    work_log: ${capability.runtimes.codex.work_log.status} ${capability.runtimes.codex.work_log.path}`);
    }
  }
  return lines.join('\n');
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
  if (!isDirectory(targetPath)) {
    if (!lexists(targetPath)) throw new SkillManagerError(`${label} does not exist: ${targetPath}`);
    throw new SkillManagerError(`${label} is not a directory: ${targetPath}`);
  }
}


function resolveSymlinkTarget(link) {
  const target = fs.readlinkSync(link);
  return path.resolve(path.isAbsolute(target) ? target : path.join(path.dirname(link), target));
}


function lexists(targetPath) {
  return lstatOrNull(targetPath) !== null;
}


function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
}


function statOrNull(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}


function isDirectory(targetPath) {
  return Boolean(statOrNull(targetPath)?.isDirectory());
}


function isFile(targetPath) {
  return Boolean(statOrNull(targetPath)?.isFile());
}


function samePath(first, second) {
  return existingRealpathOrResolved(first) === existingRealpathOrResolved(second);
}


function existingRealpathOrResolved(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}


function isRelativeTo(child, parent) {
  const relative = path.relative(existingRealpathOrResolved(parent), existingRealpathOrResolved(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
