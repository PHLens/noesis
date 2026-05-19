import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


export class BootstrapError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_WITH = ['pamem'];
const KNOWN_COMPONENTS = ['pamem', 'loreforge'];
const NOESIS_BIN = fileURLToPath(new URL('../bin/noesis', import.meta.url));


export function runBootstrapCommand(command, tokens, options = {}) {
  if (command === 'init') {
    return runInit(parseCommonArgs(tokens, { allowWith: true, allowForce: true }), options);
  }
  if (command === 'doctor') {
    return runDoctor(parseCommonArgs(tokens, {}), options);
  }
  if (command === 'config') {
    return runConfig(parseConfigArgs(tokens), options);
  }
  throw new BootstrapError(`unknown bootstrap command: ${command}`);
}


export function manifestPath(workspace) {
  return path.join(workspace, '.noesis', 'config.toml');
}


function runInit(args, options) {
  const workspace = resolveWorkspace(args.workspace);
  const noesisDir = path.join(workspace, '.noesis');
  const manifestFile = manifestPath(workspace);
  const enabled = parseWith(args.withComponents);
  const manifest = buildManifest({ workspace, enabled, version: options.version || '0.1.0' });
  const actions = [];

  mkdirp(noesisDir, actions);
  for (const value of Object.values(manifest.paths)) {
    mkdirp(path.resolve(workspace, value), actions);
  }

  if (fs.existsSync(manifestFile) && !args.force) {
    actions.push({ action: 'kept', path: manifestFile, reason: 'manifest-exists' });
  } else {
    fs.writeFileSync(manifestFile, `${serializeManifest(manifest)}\n`);
    actions.push({ action: fs.existsSync(manifestFile) ? 'wrote' : 'created', path: manifestFile });
  }

  const report = {
    status: 'ok',
    workspace,
    config_path: manifestFile,
    downstream_execution: 'not-run',
    actions,
    manifest: readManifest(manifestFile),
  };
  printReport(report, args.json, initHuman);
  return 0;
}


function runDoctor(args) {
  const workspace = resolveWorkspace(args.workspace);
  const configPath = manifestPath(workspace);
  const checks = [];
  let manifest = null;

  if (!fs.existsSync(configPath)) {
    checks.push(check('manifest.exists', 'error', false, `.noesis/config.toml is missing`, { path: configPath }));
  } else {
    checks.push(check('manifest.exists', 'info', true, `.noesis/config.toml exists`, { path: configPath }));
    try {
      manifest = readManifest(configPath);
      checks.push(check('manifest.parse', 'info', true, `.noesis/config.toml parses`, { path: configPath }));
    } catch (error) {
      checks.push(check('manifest.parse', 'error', false, error.message, { path: configPath }));
    }
  }

  if (manifest) {
    validateManifestShape(manifest, checks, configPath);
    checkLocalPaths(workspace, manifest, checks);
    checkComponents(workspace, manifest, checks);
  }

  const report = buildDoctorReport(workspace, configPath, checks);
  printReport(report, args.json, doctorHuman);
  return report.summary.error_count > 0 ? 1 : 0;
}


function runConfig(args) {
  if (args.subcommand !== 'show') {
    throw new BootstrapError(`unknown config command: ${args.subcommand || ''}`.trim());
  }
  const workspace = resolveWorkspace(args.workspace);
  const configPath = manifestPath(workspace);
  if (!fs.existsSync(configPath)) {
    throw new BootstrapError(`Noesis manifest not found: ${configPath}`);
  }
  if (args.json) {
    printJson({
      status: 'ok',
      workspace,
      config_path: configPath,
      manifest: readManifest(configPath),
    });
  } else {
    process.stdout.write(fs.readFileSync(configPath, 'utf8'));
  }
  return 0;
}


function parseCommonArgs(tokens, { allowWith = false, allowForce = false }) {
  const args = {
    workspace: null,
    json: false,
    withComponents: null,
    force: false,
  };
  const positionals = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--json') {
      args.json = true;
    } else if (allowWith && token === '--with') {
      args.withComponents = requireValue(tokens, ++index, '--with');
    } else if (allowWith && token.startsWith('--with=')) {
      args.withComponents = token.slice('--with='.length);
    } else if (allowForce && token === '--force') {
      args.force = true;
    } else if (token.startsWith('-')) {
      throw new BootstrapError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (positionals.length > 0) {
    throw new BootstrapError(`unexpected argument: ${positionals[0]}`);
  }
  return args;
}


function parseConfigArgs(tokens) {
  const [subcommand, ...rest] = tokens;
  if (!subcommand) throw new BootstrapError('usage: noesis config show');
  return { ...parseCommonArgs(rest, {}), subcommand };
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new BootstrapError(`missing value for ${option}`);
  }
  return value;
}


function resolveWorkspace(workspace) {
  return path.resolve(workspace || process.cwd());
}


function parseWith(value) {
  if (!value) return DEFAULT_WITH;
  if (value === 'none') return [];
  const components = value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const component of components) {
    if (!KNOWN_COMPONENTS.includes(component)) {
      throw new BootstrapError(`unsupported component in --with: ${component}`);
    }
  }
  return [...new Set(components)];
}


function buildManifest({ workspace, enabled, version }) {
  return {
    noesis: {
      schema_version: SUPPORTED_SCHEMA_VERSION,
      workspace,
      entry_skill: 'writeback-router',
      minimum_noesis_version: version,
      mode: 'workspace',
    },
    components: {
      pamem: {
        enabled: enabled.includes('pamem'),
        owner: 'pamem',
        config_path: '.pamem/config.toml',
        required_cli: 'pamem',
        required_version: '0.1.0',
        required_entry_skill: 'pamem',
        init_command: 'pamem init --workspace ${workspace}',
        status_command: 'pamem status --workspace ${workspace} --json',
        validate_command: 'pamem lint --workspace ${workspace} --json',
      },
      loreforge: {
        enabled: enabled.includes('loreforge'),
        owner: 'LoreForge',
        config_path: '.loreforge/config.toml',
        required_cli: '',
        required_version: '',
        required_entry_skill: 'loreforge',
        init_command: '',
        status_command: '',
        validate_command: '',
      },
      skill_manager: {
        enabled: true,
        owner: 'Noesis',
        required_cli: 'noesis',
        required_entry_skill: 'noesis-skill-manager',
        status_command: 'noesis skill list --workspace ${workspace} --json',
        validate_command: 'noesis skill verify --workspace ${workspace} --json',
      },
    },
    paths: {
      promote_requests: '.noesis/promote-requests',
      proposals: '.noesis/proposals',
      reports: '.noesis/reports',
    },
  };
}


function mkdirp(dir, actions) {
  if (fs.existsSync(dir)) {
    actions.push({ action: 'exists', path: dir });
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  actions.push({ action: 'created', path: dir });
}


export function readManifest(configPath) {
  return parseToml(fs.readFileSync(configPath, 'utf8'));
}


function parseToml(text) {
  const root = {};
  let current = root;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const table = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (table) {
      current = ensurePath(root, table[1].split('.'));
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      throw new BootstrapError(`invalid TOML line ${index + 1}: ${rawLine}`);
    }
    current[assignment[1]] = parseTomlValue(assignment[2].trim(), index + 1);
  }
  return root;
}


function stripComment(line) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\' && inString) {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    } else if (char === '#' && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}


function ensurePath(root, parts) {
  let current = root;
  for (const part of parts) {
    current[part] ||= {};
    current = current[part];
  }
  return current;
}


function parseTomlValue(value, line) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const quoted = value.match(/^"(.*)"$/);
  if (quoted) {
    return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  throw new BootstrapError(`unsupported TOML value on line ${line}: ${value}`);
}


function serializeManifest(manifest) {
  const lines = [];
  writeTable(lines, 'noesis', manifest.noesis);
  writeTable(lines, 'components.pamem', manifest.components.pamem);
  writeTable(lines, 'components.loreforge', manifest.components.loreforge);
  writeTable(lines, 'components.skill_manager', manifest.components.skill_manager);
  writeTable(lines, 'paths', manifest.paths);
  return lines.join('\n');
}


function writeTable(lines, name, values) {
  if (lines.length > 0) lines.push('');
  lines.push(`[${name}]`);
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }
}


function formatTomlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}


function validateManifestShape(manifest, checks, configPath) {
  if (manifest.noesis?.schema_version === SUPPORTED_SCHEMA_VERSION) {
    checks.push(check('manifest.schema_version', 'info', true, 'manifest schema version is supported', { path: configPath }));
  } else {
    checks.push(check('manifest.schema_version', 'error', false, 'manifest schema version is unsupported or missing', { path: configPath }));
  }
  for (const name of ['pamem', 'loreforge', 'skill_manager']) {
    if (manifest.components?.[name]) {
      checks.push(check(`component.${name}.declared`, 'info', true, `${name} component is declared`));
    } else {
      checks.push(check(`component.${name}.declared`, 'error', false, `${name} component is missing`));
    }
  }
}


function checkLocalPaths(workspace, manifest, checks) {
  for (const [name, relPath] of Object.entries(manifest.paths || {})) {
    const fullPath = path.resolve(workspace, relPath);
    checks.push(check(
      `paths.${name}`,
      fs.existsSync(fullPath) ? 'info' : 'warning',
      fs.existsSync(fullPath),
      fs.existsSync(fullPath) ? `${name} directory exists` : `${name} directory is missing`,
      { path: fullPath },
    ));
  }
}


function checkComponents(workspace, manifest, checks) {
  for (const [name, component] of Object.entries(manifest.components || {})) {
    if (!component.enabled) {
      checks.push(check(`component.${name}.enabled`, 'info', true, `${name} component is disabled`));
      continue;
    }
    checks.push(check(`component.${name}.enabled`, 'info', true, `${name} component is enabled`));
    if (component.config_path) {
      const configPath = path.resolve(workspace, component.config_path);
      checks.push(check(
        `component.${name}.config`,
        fs.existsSync(configPath) ? 'info' : 'warning',
        fs.existsSync(configPath),
        fs.existsSync(configPath) ? `${name} owner config exists` : `${name} owner config is missing`,
        { path: configPath },
      ));
    }
    if (component.required_cli) {
      const found = commandExists(component.required_cli);
      checks.push(check(
        `component.${name}.cli`,
        found ? 'info' : 'warning',
        found,
        found ? `${component.required_cli} CLI is discoverable` : `${component.required_cli} CLI is not on PATH`,
        { command: component.required_cli },
      ));
    }
    if (component.required_entry_skill) {
      const visible = entrySkillVisible(workspace, component.required_entry_skill);
      checks.push(check(
        `component.${name}.entry_skill`,
        visible ? 'info' : 'warning',
        visible,
        visible ? `${component.required_entry_skill} entry skill is visible` : `${component.required_entry_skill} entry skill is not visible`,
        { skill: component.required_entry_skill },
      ));
    }
    for (const [kind, commandLine] of Object.entries({
      status: component.status_command,
      validate: component.validate_command,
    })) {
      if (!commandLine) continue;
      checks.push(runComponentCommand(workspace, name, kind, commandLine));
    }
  }
}


function commandExists(command) {
  if (command === 'noesis') return true;
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [command] : ['-v', command], {
    shell: process.platform !== 'win32',
    stdio: 'ignore',
  });
  return result.status === 0;
}


function runComponentCommand(workspace, componentName, kind, commandLine) {
  const resolved = commandLine.replaceAll('${workspace}', shellQuote(workspace));
  const result = spawnSync(resolved, {
    cwd: workspace,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.dirname(NOESIS_BIN)}${path.delimiter}${process.env.PATH || ''}`,
    },
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  const id = `component.${componentName}.${kind}`;
  if (result.error) {
    return check(id, 'warning', false, `${componentName} ${kind} command failed: ${result.error.message}`, { command: commandLine });
  }
  if (result.status !== 0) {
    return check(id, 'warning', false, `${componentName} ${kind} command exited ${result.status}`, {
      command: commandLine,
      stderr: summarizeText(result.stderr),
    });
  }
  const stdout = result.stdout.trim();
  if (!stdout) {
    return check(id, 'warning', false, `${componentName} ${kind} command produced no JSON`, { command: commandLine });
  }
  try {
    const envelope = JSON.parse(stdout);
    const ok = envelope.status === 'ok' || envelope.ok === true;
    return check(id, ok ? 'info' : 'warning', ok, `${componentName} ${kind} command returned ${envelope.status || envelope.ok || 'unknown'}`, {
      command: commandLine,
      envelope,
    });
  } catch (error) {
    return check(id, 'warning', false, `${componentName} ${kind} command did not emit valid JSON`, {
      command: commandLine,
      stdout: summarizeText(stdout),
    });
  }
}


function shellQuote(value) {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}


function summarizeText(text) {
  const value = String(text || '').trim();
  return value.length > 400 ? `${value.slice(0, 397)}...` : value;
}


function entrySkillVisible(workspace, name) {
  return fs.existsSync(path.join(workspace, '.codex', 'skills', name))
    || fs.existsSync(path.join(workspace, '.claude', 'skills', name));
}


function check(id, severity, ok, message, extra = {}) {
  return {
    id,
    status: ok ? 'ok' : 'not_ok',
    severity,
    message,
    ...extra,
  };
}


function buildDoctorReport(workspace, configPath, checks) {
  const summary = {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length,
    info_count: checks.filter((item) => item.severity === 'info').length,
  };
  return {
    status: summary.error_count > 0 ? 'failed' : summary.warning_count > 0 ? 'warning' : 'ok',
    workspace,
    config_path: configPath,
    summary,
    checks,
  };
}


function printReport(report, json, humanPrinter) {
  if (json) printJson(report);
  else humanPrinter(report);
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function initHuman(report) {
  console.log(`Noesis initialized at ${report.workspace}`);
  console.log(`Manifest: ${report.config_path}`);
  console.log('Downstream execution: not run');
  for (const action of report.actions) {
    console.log(`- ${action.action}: ${action.path}`);
  }
}


function doctorHuman(report) {
  console.log(`Noesis doctor: ${report.status}`);
  console.log(`Workspace: ${report.workspace}`);
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}
