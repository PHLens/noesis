import fs from 'node:fs';
import path from 'node:path';


export class EventError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const EVENT_KINDS = new Set([
  'user_correction',
  'task_failure',
  'repeated_workflow',
  'missing_capability',
  'tool_behavior_discovery',
  'successful_pattern',
  'source_backed_insight',
  'stale_or_conflicting_learning',
  'manual',
]);
const SOURCE_REF_KINDS = new Set([
  'slock_message',
  'slock_thread',
  'task',
  'test',
  'pr',
  'doc',
  'file',
  'url',
  'runtime_log',
  'manual_note',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);
const RECURRENCES = new Set(['once', 'repeated', 'systemic', 'unknown']);
const CONFIDENCES = new Set(['low', 'medium', 'high']);
const CANDIDATE_KINDS = new Set([
  'memory',
  'wiki',
  'skill',
  'eval',
  'compression',
  'mixed',
  'noop',
  'unknown',
]);
const TARGET_SURFACES = new Set([
  'pamem',
  'loreforge',
  'skill-manager',
  'evals',
  'noesis',
  'none',
  'unknown',
]);


export function runEventCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printEventUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printEventUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'check') {
      printEventCheckUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'promote') {
      printEventPromoteUsage();
      return 0;
    }
    throw new EventError(`unknown help topic: event ${rest.join(' ')}`);
  }
  if (command !== 'check' && command !== 'promote') {
    throw new EventError(`unknown event command: ${command}`);
  }

  if (command === 'check') {
    const args = parseCheckArgs(rest);
    if (args.help) return 0;
    return runEventCheck(args);
  }

  const args = parsePromoteArgs(rest);
  if (args.help) return 0;
  return runEventPromote(args);
}


function runEventCheck(args) {
  const { event, report } = loadAndCheckEvent(args.eventPath, args.workspace);
  if (args.json) printJson(report);
  else printHuman(report);
  return report.summary.error_count > 0 ? 1 : 0;
}


function runEventPromote(args) {
  const { event, report: eventReport } = loadAndCheckEvent(args.eventPath, args.workspace);
  const outputDir = resolvePromoteOutputDir(args, event);

  if (eventReport.summary.error_count > 0) {
    const report = buildPromoteReport({
      status: 'failed',
      eventPath: eventReport.event_path,
      event,
      outputDir,
      request: null,
      requestPath: null,
      eventReport,
      actions: [],
      checks: [
        check('event.promote.event_check', 'error', false, 'learning-event has check errors; no promote-request was written'),
      ],
    });
    if (args.json) printJson(report);
    else printPromoteHuman(report);
    return 1;
  }

  const request = buildPromoteRequest(event);
  const requestPath = path.join(outputDir, `${sanitizeId(request.request_id)}.json`);
  const existed = fs.existsSync(requestPath);
  if (existed && !args.force) {
    throw new EventError(`promote request already exists: ${requestPath}; use --force to overwrite`);
  }

  const actions = [];
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    actions.push({ action: 'created', path: outputDir });
  } else {
    actions.push({ action: 'exists', path: outputDir });
  }
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  actions.push({ action: existed ? 'wrote' : 'created', path: requestPath });

  const bridgeWarnings = bridgeWarningChecks(request);
  const report = buildPromoteReport({
    status: eventReport.summary.warning_count > 0 || bridgeWarnings.some((item) => item.status !== 'ok') ? 'warning' : 'ok',
    eventPath: eventReport.event_path,
    event,
    outputDir,
    request,
    requestPath,
    eventReport,
    actions,
    checks: [
      check('event.promote.proposal_only', 'info', true, 'promote-request was generated without proposal planning or owner apply'),
      ...bridgeWarnings,
    ],
  });
  if (args.json) printJson(report);
  else printPromoteHuman(report);
  return 0;
}


function loadAndCheckEvent(eventPathArg, workspaceArg) {
  const eventPath = path.resolve(eventPathArg);
  const { event, checks } = readEvent(eventPath);
  if (event) validateEvent(event, checks, workspaceArg);
  return {
    event,
    report: buildCheckReport(eventPath, event, checks),
  };
}


function parseCheckArgs(tokens) {
  const args = {
    json: false,
    workspace: null,
    eventPath: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printEventCheckUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token.startsWith('-')) {
      throw new EventError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new EventError('usage: noesis event check <event-file>');
  }
  args.eventPath = positionals[0];
  return args;
}


function parsePromoteArgs(tokens) {
  const args = {
    json: false,
    workspace: null,
    out: path.join('.noesis', 'promote-requests'),
    force: false,
    eventPath: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printEventPromoteUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--out') {
      args.out = requireValue(tokens, ++index, '--out');
    } else if (token.startsWith('--out=')) {
      args.out = token.slice('--out='.length);
    } else if (token === '--force') {
      args.force = true;
    } else if (token.startsWith('-')) {
      throw new EventError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new EventError('usage: noesis event promote <event-file>');
  }
  args.eventPath = positionals[0];
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new EventError(`missing value for ${option}`);
  }
  return value;
}


function readEvent(eventPath) {
  const checks = [];
  if (!fs.existsSync(eventPath)) {
    checks.push(check('event.exists', 'error', false, 'learning-event file is missing', { path: eventPath }));
    return { event: null, checks };
  }
  checks.push(check('event.exists', 'info', true, 'learning-event file exists', { path: eventPath }));

  let text;
  try {
    text = fs.readFileSync(eventPath, 'utf8');
  } catch (error) {
    checks.push(check('event.read', 'error', false, `failed to read learning-event file: ${error.message}`, { path: eventPath }));
    return { event: null, checks };
  }

  if (text.length > 64 * 1024) {
    checks.push(check('event.size', 'warning', false, 'learning-event file is large; keep artifacts compact and reference external evidence'));
  } else {
    checks.push(check('event.size', 'info', true, 'learning-event file size is compact'));
  }

  try {
    return { event: JSON.parse(text), checks };
  } catch (error) {
    checks.push(check('event.parse', 'error', false, `learning-event file is not valid JSON: ${error.message}`, { path: eventPath }));
    return { event: null, checks };
  }
}


function validateEvent(event, checks, workspaceArg) {
  if (!isPlainObject(event)) {
    checks.push(check('event.shape', 'error', false, 'learning-event root must be a JSON object'));
    return;
  }
  checks.push(check('event.parse', 'info', true, 'learning-event JSON parses'));

  stringField(event, 'schema_version', 'event.schema_version', checks, { exact: SUPPORTED_SCHEMA_VERSION });
  stringField(event, 'event_id', 'event.event_id', checks, { pattern: /^[A-Za-z0-9._:-]+$/ });
  stringField(event, 'created_at', 'event.created_at', checks, { isoDate: true });
  stringField(event, 'workspace', 'event.workspace', checks);
  if (workspaceArg) {
    const requested = path.resolve(workspaceArg);
    const declared = typeof event.workspace === 'string' ? path.resolve(event.workspace) : null;
    if (declared && declared !== requested) {
      checks.push(check('event.workspace.argument', 'warning', false, '--workspace differs from event.workspace', {
        workspace_argument: requested,
        event_workspace: declared,
      }));
    } else if (declared) {
      checks.push(check('event.workspace.argument', 'info', true, '--workspace matches event.workspace'));
    }
  }
  enumField(event, 'kind', 'event.kind', checks, EVENT_KINDS);
  stringField(event, 'summary', 'event.summary', checks, { maxLength: 600 });
  validateSourceRefs(event.source_refs, checks, 'event.source_refs');
  validateCase(event.case, checks);
  validateImpact(event.impact, checks);
  validateRoutingHints(event.routing_hints, checks);
  rejectTranscriptLikeFields(event, checks);
}


function validateSourceRefs(sourceRefs, checks, prefix) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    checks.push(check(prefix, 'error', false, 'source_refs must be a non-empty array of short references'));
    return;
  }
  checks.push(check(prefix, 'info', true, 'source_refs are present'));
  sourceRefs.forEach((sourceRef, index) => validateSourceRef(sourceRef, checks, `${prefix}[${index}]`));
}


function validateSourceRef(sourceRef, checks, prefix) {
  if (!isPlainObject(sourceRef)) {
    checks.push(check(prefix, 'error', false, 'source_ref must be an object'));
    return;
  }
  enumField(sourceRef, 'kind', `${prefix}.kind`, checks, SOURCE_REF_KINDS);
  stringField(sourceRef, 'ref', `${prefix}.ref`, checks, { maxLength: 240 });
  stringField(sourceRef, 'summary', `${prefix}.summary`, checks, { maxLength: 400 });
  if (typeof sourceRef.ref === 'string' && looksPrivatePath(sourceRef.ref)) {
    checks.push(check(`${prefix}.ref.private_path`, 'warning', false, 'source ref looks like a private absolute path; prefer a repo-relative path or task/thread reference'));
  }
}


function validateCase(caseObject, checks) {
  if (!isPlainObject(caseObject)) {
    checks.push(check('event.case', 'error', false, 'case must be an object'));
    return;
  }
  stringField(caseObject, 'situation', 'event.case.situation', checks, { maxLength: 800 });
  stringField(caseObject, 'observed', 'event.case.observed', checks, { maxLength: 800 });
  stringField(caseObject, 'desired', 'event.case.desired', checks, { maxLength: 800 });
  stringField(caseObject, 'evidence', 'event.case.evidence', checks, { maxLength: 800 });
}


function validateImpact(impact, checks) {
  if (!isPlainObject(impact)) {
    checks.push(check('event.impact', 'error', false, 'impact must be an object'));
    return;
  }
  enumField(impact, 'severity', 'event.impact.severity', checks, SEVERITIES);
  enumField(impact, 'recurrence', 'event.impact.recurrence', checks, RECURRENCES);
  enumField(impact, 'confidence', 'event.impact.confidence', checks, CONFIDENCES);
  if (impact.severity === 'high' && impact.confidence === 'low') {
    checks.push(check('event.impact.high_low_confidence', 'warning', false, 'high severity with low confidence should be manually reviewed before routing'));
  }
}


function validateRoutingHints(routingHints, checks) {
  if (routingHints === undefined) {
    checks.push(check('event.routing_hints', 'warning', false, 'routing_hints are absent; a router step must classify the event before promotion'));
    return;
  }
  if (!Array.isArray(routingHints)) {
    checks.push(check('event.routing_hints', 'error', false, 'routing_hints must be an array when present'));
    return;
  }
  if (routingHints.length === 0) {
    checks.push(check('event.routing_hints', 'warning', false, 'routing_hints is empty; a router step must classify the event before promotion'));
    return;
  }
  checks.push(check('event.routing_hints', 'info', true, 'routing_hints are present'));
  routingHints.forEach((hint, index) => validateRoutingHint(hint, checks, `event.routing_hints[${index}]`));
}


function validateRoutingHint(hint, checks, prefix) {
  if (!isPlainObject(hint)) {
    checks.push(check(prefix, 'error', false, 'routing hint must be an object'));
    return;
  }
  enumField(hint, 'candidate_kind', `${prefix}.candidate_kind`, checks, CANDIDATE_KINDS);
  enumField(hint, 'target_surface', `${prefix}.target_surface`, checks, TARGET_SURFACES);
  stringField(hint, 'reason', `${prefix}.reason`, checks, { maxLength: 800 });
  if (hint.review_required !== undefined && typeof hint.review_required !== 'boolean') {
    checks.push(check(`${prefix}.review_required`, 'error', false, 'review_required must be a boolean when present'));
  } else if (hint.review_required === false && hint.candidate_kind !== 'noop') {
    checks.push(check(`${prefix}.review_required.boundary`, 'warning', false, 'routed learning events should normally require review unless the result is noop'));
  } else if (hint.review_required !== undefined) {
    checks.push(check(`${prefix}.review_required`, 'info', true, 'review_required is valid'));
  }
  if (hint.candidate_kind === 'unknown') {
    checks.push(check(`${prefix}.candidate_kind.unknown`, 'warning', false, 'candidate_kind is unknown; routing should be clarified before promotion'));
  }
  if (hint.target_surface === 'unknown') {
    checks.push(check(`${prefix}.target_surface.unknown`, 'warning', false, 'target_surface is unknown; owner boundary should be clarified before promotion'));
  }
}


function rejectTranscriptLikeFields(value, checks, pointer = 'event') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectTranscriptLikeFields(entry, checks, `${pointer}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (['transcript', 'messages', 'raw_transcript', 'chat_log', 'raw_log', 'full_text'].includes(key)) {
      checks.push(check(`${pointer}.${key}`, 'error', false, 'learning events must not retain full transcripts, chat logs, or raw logs'));
      continue;
    }
    rejectTranscriptLikeFields(child, checks, `${pointer}.${key}`);
  }
}


function stringField(object, field, id, checks, options = {}) {
  if (typeof object[field] !== 'string' || object[field].trim() === '') {
    checks.push(check(id, 'error', false, `${field} must be a non-empty string`));
    return;
  }
  const value = object[field];
  if (options.exact && value !== options.exact) {
    checks.push(check(id, 'error', false, `${field} must be ${options.exact}`));
    return;
  }
  if (options.pattern && !options.pattern.test(value)) {
    checks.push(check(id, 'error', false, `${field} contains unsupported characters`));
    return;
  }
  if (options.isoDate && Number.isNaN(Date.parse(value))) {
    checks.push(check(id, 'error', false, `${field} must be an ISO-8601 date-time`));
    return;
  }
  if (options.maxLength && value.length > options.maxLength) {
    checks.push(check(id, 'warning', false, `${field} is long; keep learning events compact`, { length: value.length, max_length: options.maxLength }));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}


function enumField(object, field, id, checks, allowedValues) {
  if (typeof object[field] !== 'string' || !allowedValues.has(object[field])) {
    checks.push(check(id, 'error', false, `${field} must be one of: ${[...allowedValues].join(', ')}`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function looksPrivatePath(value) {
  return /(^|[\s"'`])\/(home|root|Users|var|tmp)\//.test(value)
    || /^[A-Za-z]:\\Users\\/.test(value);
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


function buildCheckReport(eventPath, event, checks) {
  const summary = {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length,
    info_count: checks.filter((item) => item.severity === 'info').length,
  };
  return {
    command: 'event check',
    status: summary.error_count > 0 ? 'failed' : summary.warning_count > 0 ? 'warning' : 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    event_path: eventPath,
    event_id: isPlainObject(event) && typeof event.event_id === 'string' ? event.event_id : null,
    event_kind: isPlainObject(event) && typeof event.kind === 'string' ? event.kind : null,
    summary,
    downstream_execution: 'not-run',
    writes: [],
    checks,
  };
}


function buildPromoteRequest(event) {
  const hints = Array.isArray(event.routing_hints) && event.routing_hints.length > 0
    ? event.routing_hints
    : [{
      candidate_kind: 'unknown',
      target_surface: 'unknown',
      review_required: true,
      reason: 'No routing hint was provided by the learning event.',
    }];
  const createdAt = new Date().toISOString();
  const requestId = `${sanitizeId(event.event_id)}__promote`;
  const candidateItems = hints.map((hint, index) => {
    const candidateKind = normalizeCandidateKind(hint.candidate_kind);
    const targetSurface = normalizeTargetSurface(hint.target_surface);
    return {
      id: `event-${index + 1}`,
      summary: event.summary,
      evidence: event.case.evidence,
      candidate_kind: candidateKind,
      target_surface: targetSurface,
      risk: riskFromImpact(event.impact),
      review_required: hint.review_required !== false,
      reason: hint.reason || `Derived from learning event ${event.event_id}.`,
      source_refs: event.source_refs,
    };
  });
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    request_id: requestId,
    created_at: createdAt,
    workspace: event.workspace,
    trigger: {
      kind: triggerKindFromEvent(event.kind),
      summary: `Promote checked learning event: ${event.summary}`,
    },
    source_refs: [
      ...event.source_refs,
      {
        kind: 'file',
        ref: `.noesis/events/${sanitizeId(event.event_id)}.json`,
        summary: `Checked learning-event artifact ${event.event_id}.`,
      },
    ],
    candidate_items: candidateItems,
    requested_outputs: requestedOutputsFromCandidates(candidateItems),
    gate_policy: {
      mode: 'proposal_only',
      allow_apply: false,
      review_required: true,
    },
    expected_regression: expectedRegressionFromEvent(event),
  };
}


function requestedOutputsFromCandidates(candidateItems) {
  const seen = new Set();
  const outputs = [];
  for (const item of candidateItems) {
    const output = outputForCandidate(item);
    const key = `${output.kind}:${output.target_owner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outputs.push(output);
  }
  return outputs.length > 0 ? outputs : [{ kind: 'mixed', target_owner: 'unknown', review_required: true }];
}


function outputForCandidate(item) {
  const mapping = {
    memory: { kind: 'memory_proposal', target_owner: 'pamem' },
    wiki: { kind: 'wiki_proposal', target_owner: 'LoreForge' },
    skill: { kind: 'skill_proposal', target_owner: 'skill-manager' },
    eval: { kind: 'eval_proposal', target_owner: 'evals' },
    compression: { kind: 'compression_proposal', target_owner: 'Noesis' },
    noop: { kind: 'noop', target_owner: 'none' },
  };
  return {
    ...(mapping[item.candidate_kind] || { kind: 'mixed', target_owner: 'unknown' }),
    review_required: item.candidate_kind !== 'noop',
  };
}


function expectedRegressionFromEvent(event) {
  return {
    kind: 'manual_review',
    scenario: event.case.situation,
    acceptance: event.case.desired,
  };
}


function bridgeWarningChecks(request) {
  const checks = [];
  request.candidate_items.forEach((item, index) => {
    if (item.candidate_kind === 'unknown') {
      checks.push(check(`event.promote.candidate_items[${index}].candidate_kind`, 'warning', false, 'candidate_kind is unknown; promote check should warn until routing is clarified'));
    }
    if (item.target_surface === 'unknown') {
      checks.push(check(`event.promote.candidate_items[${index}].target_surface`, 'warning', false, 'target_surface is unknown; promote check should warn until owner boundary is clarified'));
    }
  });
  return checks;
}


function resolvePromoteOutputDir(args, event) {
  if (path.isAbsolute(args.out)) return path.resolve(args.out);
  const base = args.workspace
    ? path.resolve(args.workspace)
    : isPlainObject(event) && typeof event.workspace === 'string' && event.workspace.trim() !== ''
      ? path.resolve(event.workspace)
      : process.cwd();
  return path.resolve(base, args.out);
}


function buildPromoteReport({ status, eventPath, event, outputDir, request, requestPath, eventReport, actions, checks }) {
  const summary = {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length + eventReport.summary.error_count,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length + eventReport.summary.warning_count,
    info_count: checks.filter((item) => item.severity === 'info').length,
    request_count: request ? 1 : 0,
  };
  return {
    command: 'event promote',
    status,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    event_path: eventPath,
    event_id: isPlainObject(event) && typeof event.event_id === 'string' ? event.event_id : null,
    output_dir: outputDir,
    request_path: requestPath,
    request_id: isPlainObject(request) && typeof request.request_id === 'string' ? request.request_id : null,
    downstream_execution: 'not-run',
    writes: actions.filter((action) => action.action === 'wrote' || action.action === 'created').map((action) => action.path),
    actions,
    summary,
    event_check_report: eventReport,
    checks,
  };
}


function triggerKindFromEvent(kind) {
  const mappings = {
    user_correction: 'user_correction',
    task_failure: 'task_failure',
    repeated_workflow: 'repeated_workflow',
    missing_capability: 'missing_capability',
  };
  return mappings[kind] || 'manual';
}


function normalizeCandidateKind(value) {
  return CANDIDATE_KINDS.has(value) ? value : 'unknown';
}


function normalizeTargetSurface(value) {
  return TARGET_SURFACES.has(value) ? value : 'unknown';
}


function riskFromImpact(impact) {
  if (!isPlainObject(impact)) return 'medium';
  if (impact.severity === 'high') return 'high';
  if (impact.severity === 'low') return 'low';
  return 'medium';
}


function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printHuman(report) {
  console.log(`Noesis event check: ${report.status}`);
  console.log(`Event: ${report.event_path}`);
  if (report.event_id) console.log(`Event ID: ${report.event_id}`);
  if (report.event_kind) console.log(`Event kind: ${report.event_kind}`);
  console.log('Downstream execution: not run');
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}


function printPromoteHuman(report) {
  console.log(`Noesis event promote: ${report.status}`);
  console.log(`Event: ${report.event_path}`);
  if (report.event_id) console.log(`Event ID: ${report.event_id}`);
  console.log(`Output directory: ${report.output_dir}`);
  if (report.request_path) console.log(`Promote request: ${report.request_path}`);
  console.log('Downstream execution: not run');
  for (const action of report.actions) {
    console.log(`- ${action.action}: ${action.path}`);
  }
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}


export function printEventUsage() {
  console.log(`Usage: noesis event <command> [args]

Commands:
  check <event-file>            Validate a learning-event artifact without routing or writing proposals.
  promote <event-file>          Convert a checked learning-event into a promote-request artifact.
  help                          Show event command help.

Options:
  -h, --help                    Show this help message.

Examples:
  noesis event check .noesis/events/example.json
  noesis event check .noesis/events/example.json --json
  noesis event promote .noesis/events/example.json --json`);
}


export function printEventCheckUsage() {
  console.log(`Usage: noesis event check <event-file> [--workspace <path>] [--json]

Read-only gate for a learning-event JSON artifact.

Options:
  --workspace <path>            Optional workspace expected by the event.
  --json                        Print machine-readable JSON.

The check validates schema, compact source references, case shape, impact
metadata, optional routing hints, and transcript-retention hazards. It does not
route, write promote requests, write proposal artifacts, or apply downstream
owner changes.`);
}


export function printEventPromoteUsage() {
  console.log(`Usage: noesis event promote <event-file> [--workspace <path>] [--out <dir>] [--force] [--json]

Convert a checked learning-event into a promote-request JSON artifact.

Options:
  --workspace <path>            Optional workspace expected by the event.
  --out <dir>                   Promote-request output directory. Defaults to .noesis/promote-requests.
  --force                       Overwrite an existing promote-request artifact.
  --json                        Print machine-readable JSON.

The promote command reruns the read-only event check first. If check errors are
present, it writes nothing and exits 1. On success it writes one
promote-request artifact only; it does not generate proposals or apply memory,
wiki, skill, or eval changes.`);
}
