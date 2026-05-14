import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED_SKILLS_ROOT = path.join(REPO_ROOT, 'skills');
const PAMEM_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pamem.cmd' : 'pamem');
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
    const result = addSkill(target, args.name, args.source, args.alias);
    return emit(result, formatAdd(result), args.json);
  }
  if (args.skillCommand === 'remove') {
    const result = removeSkill(target, args.name);
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
    const root = resolveAgentRoot(args.agentId);
    requireDirectory(root, `pamem root for agent ${args.agentId}`);
    return {
      scope: 'workspace',
      kind: 'agent-home',
      root,
      resolver: 'pamem-status',
      agent_id: args.agentId,
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
  return expandPath(data.root);
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


function addSkill(target, name, sourceArg = null, alias = null) {
  requireLinkName(name, 'skill name');
  rejectCapabilityMutation(name, 'add');
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
    if (!samePath(resolveSymlinkTarget(link), resolvedSource.path)) {
      problems.push(`${runtime}: symlink already points to ${fs.readlinkSync(link)} at ${link}`);
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
      actions.push({ runtime, path: link, action: 'already-present' });
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


function removeSkill(target, name) {
  requireLinkName(name, 'skill name');
  rejectCapabilityMutation(name, 'remove');
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


function rejectCapabilityMutation(name, command) {
  const definition = capabilityDefinition(name);
  if (!definition) return;
  throw new SkillManagerError(
    `${command} for ${definition.type} '${name}' is not implemented yet; use inspect/verify for read-only status`,
  );
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
  const settingsPath = path.join(target.root, '.claude', 'settings.json');
  const info = {
    status: 'missing',
    path: settingsPath,
    key: pluginKey,
    enabled: false,
  };
  if (!isFile(settingsPath)) return info;

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
    return info;
  }
  info.enabled = enabledPlugins[pluginKey] === true;
  info.status = info.enabled ? 'ok' : 'missing';
  return info;
}


function codexPamemInfo(target) {
  const configPath = path.join(target.root, '.codex', 'config.toml');
  const hooksPath = path.join(target.root, '.codex', 'hooks.json');
  const config = codexConfigInfo(configPath);
  const hooks = codexHooksInfo(hooksPath);
  const foundation = {
    path: path.join(target.root, '.pamem'),
    status: isDirectory(path.join(target.root, '.pamem')) ? 'ok' : 'missing',
  };
  const memory = {
    path: path.join(target.root, 'MEMORY.md'),
    status: isFile(path.join(target.root, 'MEMORY.md')) ? 'ok' : 'missing',
  };
  const currentTask = {
    path: path.join(target.root, 'notes', 'current-task.md'),
    status: isFile(path.join(target.root, 'notes', 'current-task.md')) ? 'ok' : 'missing',
  };
  const workLog = {
    path: path.join(target.root, 'notes', 'work-log.md'),
    status: isFile(path.join(target.root, 'notes', 'work-log.md')) ? 'ok' : 'missing',
  };

  const checks = [config, hooks, foundation, memory, currentTask, workLog];
  return {
    status: aggregateRuntimeStatus(checks.map((check) => check.status)),
    config,
    hooks,
    foundation,
    memory,
    current_task: currentTask,
    work_log: workLog,
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


function codexHooksInfo(hooksPath) {
  const info = {
    path: hooksPath,
    status: 'missing',
    session_start: false,
    command: null,
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
      && candidate.command.includes('memory-session-start.sh')
    ));

  if (!hook) return info;
  info.status = 'ok';
  info.session_start = true;
  info.command = hook.command;
  return info;
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
  lines.push(`Added skill: ${result.skill.name}`);
  lines.push(`Source: ${result.source.path} (${result.source.kind})`);
  for (const action of result.actions) {
    lines.push(`  ${action.runtime}: ${action.action} ${action.path}${action.target ? ` -> ${action.target}` : ''}`);
  }
  return lines.join('\n');
}


function formatRemove(result) {
  const lines = targetHeader(result);
  lines.push(`Removed skill visibility: ${result.skill.name}`);
  for (const action of result.actions) lines.push(`  ${action.runtime}: ${action.action} ${action.path}`);
  return lines.join('\n');
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
      lines.push(`    foundation: ${capability.runtimes.codex.foundation.status} ${capability.runtimes.codex.foundation.path}`);
      lines.push(`    memory: ${capability.runtimes.codex.memory.status} ${capability.runtimes.codex.memory.path}`);
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
