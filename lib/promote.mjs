import fs from 'node:fs';
import path from 'node:path';


export class PromoteError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const TRIGGER_KINDS = new Set([
  'user_request',
  'user_correction',
  'task_failure',
  'repeated_workflow',
  'missing_capability',
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
  'manual_note',
]);
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
const RISKS = new Set(['low', 'medium', 'high']);
const OUTPUT_KINDS = new Set([
  'memory_proposal',
  'wiki_proposal',
  'skill_proposal',
  'eval_proposal',
  'compression_proposal',
  'noop',
  'mixed',
]);
const TARGET_OWNERS = new Set([
  'pamem',
  'LoreForge',
  'skill-manager',
  'evals',
  'Noesis',
  'none',
  'unknown',
]);
const GATE_MODES = new Set(['proposal_only']);
const REGRESSION_KINDS = new Set(['golden_case', 'checklist', 'unit_test', 'manual_review']);
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');


export function runPromoteCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printPromoteUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printPromoteUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'check') {
      printPromoteCheckUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'plan') {
      printPromotePlanUsage();
      return 0;
    }
    throw new PromoteError(`unknown help topic: promote ${rest.join(' ')}`);
  }
  if (command === '-h' || command === '--help') {
    printPromoteUsage();
    return 0;
  }
  if (command !== 'check' && command !== 'plan') {
    throw new PromoteError(`unknown promote command: ${command}`);
  }

  if (command === 'check') {
    const args = parseCheckArgs(rest);
    if (args.help) return 0;
    return runPromoteCheck(args);
  }

  const args = parsePlanArgs(rest);
  if (args.help) return 0;
  return runPromotePlan(args);
}


function runPromoteCheck(args) {
  const { request, report } = loadAndCheckRequest(args.requestPath, args.workspace);
  if (args.json) printJson(report);
  else printHuman(report);
  return report.summary.error_count > 0 ? 1 : 0;
}


function runPromotePlan(args) {
  const { request, report: checkReport } = loadAndCheckRequest(args.requestPath, args.workspace);
  if (checkReport.summary.error_count > 0) {
    const report = buildPlanReport({
      status: 'failed',
      requestPath: checkReport.request_path,
      request,
      outputDir: resolveOutputDir(args, request),
      checkReport,
      proposals: [],
      actions: [],
      checks: [
        check('promote.check.errors', 'error', false, 'promote request has check errors; no proposal artifacts were written'),
      ],
    });
    if (args.json) printJson(report);
    else printPlanHuman(report);
    return 1;
  }

  const outputDir = resolveOutputDir(args, request);
  const proposals = buildProposalArtifacts(request, checkReport.request_path, checkReport);
  const actions = [];
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    actions.push({ action: 'created', path: outputDir });
  } else {
    actions.push({ action: 'exists', path: outputDir });
  }

  for (const proposal of proposals) {
    const proposalPath = path.join(outputDir, `${proposal.proposal_id}.json`);
    const existed = fs.existsSync(proposalPath);
    if (existed && !args.force) {
      throw new PromoteError(`proposal already exists: ${proposalPath}; use --force to overwrite`);
    }
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    actions.push({ action: existed ? 'wrote' : 'created', path: proposalPath });
    proposal.path = proposalPath;
  }

  const report = buildPlanReport({
    status: checkReport.summary.warning_count > 0 ? 'warning' : 'ok',
    requestPath: checkReport.request_path,
    request,
    outputDir,
    checkReport,
    proposals,
    actions,
    checks: [
      check('promote.plan.proposal_only', 'info', true, 'proposal artifacts were generated without downstream apply'),
    ],
  });
  if (args.json) printJson(report);
  else printPlanHuman(report);
  return 0;
}


function loadAndCheckRequest(requestPathArg, workspaceArg) {
  const requestPath = path.resolve(requestPathArg);
  const { request, checks } = readRequest(requestPath);
  if (request) validateRequest(request, checks, workspaceArg);
  return {
    request,
    report: buildCheckReport(requestPath, request, checks),
  };
}


function parseCheckArgs(tokens) {
  const args = {
    json: false,
    workspace: null,
    requestPath: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printPromoteCheckUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token.startsWith('-')) {
      throw new PromoteError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (args.help) return args;
  if (positionals.length !== 1) {
    throw new PromoteError('usage: noesis promote check <request-file>');
  }
  args.requestPath = positionals[0];
  return args;
}


function parsePlanArgs(tokens) {
  const args = {
    json: false,
    workspace: null,
    out: DEFAULT_PROPOSAL_DIR,
    force: false,
    requestPath: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printPromotePlanUsage();
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
      throw new PromoteError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new PromoteError('usage: noesis promote plan <request-file>');
  }
  args.requestPath = positionals[0];
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new PromoteError(`missing value for ${option}`);
  }
  return value;
}


function readRequest(requestPath) {
  const checks = [];
  if (!fs.existsSync(requestPath)) {
    checks.push(check('request.exists', 'error', false, 'promote-request file is missing', { path: requestPath }));
    return { request: null, checks };
  }
  checks.push(check('request.exists', 'info', true, 'promote-request file exists', { path: requestPath }));

  let text;
  try {
    text = fs.readFileSync(requestPath, 'utf8');
  } catch (error) {
    checks.push(check('request.read', 'error', false, `failed to read promote-request file: ${error.message}`, { path: requestPath }));
    return { request: null, checks };
  }

  if (text.length > 64 * 1024) {
    checks.push(check('request.size', 'warning', false, 'promote-request file is large; keep artifacts compact and reference external evidence'));
  } else {
    checks.push(check('request.size', 'info', true, 'promote-request file size is compact'));
  }

  try {
    return { request: JSON.parse(text), checks };
  } catch (error) {
    checks.push(check('request.parse', 'error', false, `promote-request file is not valid JSON: ${error.message}`, { path: requestPath }));
    return { request: null, checks };
  }
}


function validateRequest(request, checks, workspaceArg) {
  if (!isPlainObject(request)) {
    checks.push(check('request.shape', 'error', false, 'promote-request root must be a JSON object'));
    return;
  }
  checks.push(check('request.parse', 'info', true, 'promote-request JSON parses'));

  stringField(request, 'schema_version', 'request.schema_version', checks, { exact: SUPPORTED_SCHEMA_VERSION });
  stringField(request, 'request_id', 'request.request_id', checks, { pattern: /^[A-Za-z0-9._:-]+$/ });
  stringField(request, 'created_at', 'request.created_at', checks, { isoDate: true });
  stringField(request, 'workspace', 'request.workspace', checks);
  if (workspaceArg) {
    const requested = path.resolve(workspaceArg);
    const declared = typeof request.workspace === 'string' ? path.resolve(request.workspace) : null;
    if (declared && declared !== requested) {
      checks.push(check('request.workspace.argument', 'warning', false, '--workspace differs from request.workspace', {
        workspace_argument: requested,
        request_workspace: declared,
      }));
    } else if (declared) {
      checks.push(check('request.workspace.argument', 'info', true, '--workspace matches request.workspace'));
    }
  }

  validateTrigger(request.trigger, checks);
  validateSourceRefs(request.source_refs, checks, 'request.source_refs');
  validateCandidateItems(request.candidate_items, checks);
  validateRequestedOutputs(request.requested_outputs, checks);
  validateGatePolicy(request.gate_policy, checks);
  validateExpectedRegression(request.expected_regression, checks);
  rejectTranscriptLikeFields(request, checks);
}


function validateTrigger(trigger, checks) {
  if (!isPlainObject(trigger)) {
    checks.push(check('request.trigger', 'error', false, 'trigger must be an object'));
    return;
  }
  enumField(trigger, 'kind', 'request.trigger.kind', checks, TRIGGER_KINDS);
  stringField(trigger, 'summary', 'request.trigger.summary', checks, { maxLength: 600 });
  optionalStringField(trigger, 'requested_by', 'request.trigger.requested_by', checks, { maxLength: 120 });
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


function validateCandidateItems(candidateItems, checks) {
  if (!Array.isArray(candidateItems) || candidateItems.length === 0) {
    checks.push(check('request.candidate_items', 'error', false, 'candidate_items must be a non-empty array'));
    return;
  }
  checks.push(check('request.candidate_items', 'info', true, 'candidate_items are present'));
  candidateItems.forEach((item, index) => validateCandidateItem(item, checks, `request.candidate_items[${index}]`));
}


function validateCandidateItem(item, checks, prefix) {
  if (!isPlainObject(item)) {
    checks.push(check(prefix, 'error', false, 'candidate item must be an object'));
    return;
  }
  stringField(item, 'id', `${prefix}.id`, checks, { pattern: /^[A-Za-z0-9._:-]+$/ });
  stringField(item, 'summary', `${prefix}.summary`, checks, { maxLength: 800 });
  stringField(item, 'evidence', `${prefix}.evidence`, checks, { maxLength: 600 });
  enumField(item, 'candidate_kind', `${prefix}.candidate_kind`, checks, CANDIDATE_KINDS);
  enumField(item, 'target_surface', `${prefix}.target_surface`, checks, TARGET_SURFACES);
  enumField(item, 'risk', `${prefix}.risk`, checks, RISKS);
  booleanField(item, 'review_required', `${prefix}.review_required`, checks);
  stringField(item, 'reason', `${prefix}.reason`, checks, { maxLength: 800 });

  if (item.review_required !== true) {
    checks.push(check(`${prefix}.review_required.boundary`, 'warning', false, 'promotion changes should normally require review'));
  }
  if (item.risk === 'high' && item.review_required !== true) {
    checks.push(check(`${prefix}.risk.high_review`, 'error', false, 'high-risk candidate items require review_required=true'));
  }
  if (item.candidate_kind === 'unknown') {
    checks.push(check(`${prefix}.candidate_kind.unknown`, 'warning', false, 'candidate_kind is unknown; routing should be clarified before planning'));
  }
  if (item.target_surface === 'unknown') {
    checks.push(check(`${prefix}.target_surface.unknown`, 'warning', false, 'target_surface is unknown; owner boundary should be clarified before planning'));
  }
  if (Array.isArray(item.source_refs)) {
    if (item.source_refs.length === 0) {
      checks.push(check(`${prefix}.source_refs`, 'warning', false, 'item source_refs is empty; omit it or provide short item-specific references'));
    } else {
      item.source_refs.forEach((sourceRef, index) => validateSourceRef(sourceRef, checks, `${prefix}.source_refs[${index}]`));
    }
  }
  checkCandidateOwnerMapping(item, checks, prefix);
}


function checkCandidateOwnerMapping(item, checks, prefix) {
  const mappings = {
    memory: 'pamem',
    wiki: 'loreforge',
    skill: 'skill-manager',
    eval: 'evals',
    noop: 'none',
  };
  const expected = mappings[item.candidate_kind];
  if (!expected || !TARGET_SURFACES.has(item.target_surface)) return;
  if (item.target_surface !== expected) {
    checks.push(check(`${prefix}.target_surface.mapping`, 'warning', false, `${item.candidate_kind} candidates normally target ${expected}`));
  } else {
    checks.push(check(`${prefix}.target_surface.mapping`, 'info', true, `${item.candidate_kind} candidate targets ${expected}`));
  }
}


function validateRequestedOutputs(outputs, checks) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    checks.push(check('request.requested_outputs', 'error', false, 'requested_outputs must be a non-empty array'));
    return;
  }
  checks.push(check('request.requested_outputs', 'info', true, 'requested_outputs are present'));
  outputs.forEach((output, index) => validateRequestedOutput(output, checks, `request.requested_outputs[${index}]`));
}


function validateRequestedOutput(output, checks, prefix) {
  if (!isPlainObject(output)) {
    checks.push(check(prefix, 'error', false, 'requested output must be an object'));
    return;
  }
  enumField(output, 'kind', `${prefix}.kind`, checks, OUTPUT_KINDS);
  enumField(output, 'target_owner', `${prefix}.target_owner`, checks, TARGET_OWNERS);
  booleanField(output, 'review_required', `${prefix}.review_required`, checks);
  if (output.review_required !== true && output.kind !== 'noop') {
    checks.push(check(`${prefix}.review_required.boundary`, 'warning', false, 'proposal outputs should require review unless the output is noop'));
  }
}


function validateGatePolicy(gatePolicy, checks) {
  if (!isPlainObject(gatePolicy)) {
    checks.push(check('request.gate_policy', 'error', false, 'gate_policy must be an object'));
    return;
  }
  enumField(gatePolicy, 'mode', 'request.gate_policy.mode', checks, GATE_MODES);
  booleanField(gatePolicy, 'allow_apply', 'request.gate_policy.allow_apply', checks);
  booleanField(gatePolicy, 'review_required', 'request.gate_policy.review_required', checks);
  if (gatePolicy.allow_apply !== false) {
    checks.push(check('request.gate_policy.allow_apply.boundary', 'error', false, 'promote check requires allow_apply=false'));
  }
  if (gatePolicy.review_required !== true) {
    checks.push(check('request.gate_policy.review_required.boundary', 'error', false, 'promote check requires review_required=true'));
  }
}


function validateExpectedRegression(expectedRegression, checks) {
  if (expectedRegression === undefined) {
    checks.push(check('request.expected_regression', 'warning', false, 'expected_regression is not set; planning should attach a golden case, checklist, unit test, or manual review'));
    return;
  }
  if (!isPlainObject(expectedRegression)) {
    checks.push(check('request.expected_regression', 'error', false, 'expected_regression must be an object when present'));
    return;
  }
  enumField(expectedRegression, 'kind', 'request.expected_regression.kind', checks, REGRESSION_KINDS);
  stringField(expectedRegression, 'scenario', 'request.expected_regression.scenario', checks, { maxLength: 800 });
  stringField(expectedRegression, 'acceptance', 'request.expected_regression.acceptance', checks, { maxLength: 800 });
}


function rejectTranscriptLikeFields(value, checks, pointer = 'request') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectTranscriptLikeFields(entry, checks, `${pointer}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (['transcript', 'messages', 'raw_transcript', 'chat_log'].includes(key)) {
      checks.push(check(`${pointer}.${key}`, 'error', false, 'promote requests must not retain full transcripts or chat logs'));
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
    checks.push(check(id, 'warning', false, `${field} is long; keep promote requests compact`, { length: value.length, max_length: options.maxLength }));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}


function optionalStringField(object, field, id, checks, options = {}) {
  if (object[field] === undefined) return;
  stringField(object, field, id, checks, options);
}


function enumField(object, field, id, checks, allowedValues) {
  if (typeof object[field] !== 'string' || !allowedValues.has(object[field])) {
    checks.push(check(id, 'error', false, `${field} must be one of: ${[...allowedValues].join(', ')}`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}


function booleanField(object, field, id, checks) {
  if (typeof object[field] !== 'boolean') {
    checks.push(check(id, 'error', false, `${field} must be a boolean`));
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


function buildCheckReport(requestPath, request, checks) {
  const summary = {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length,
    info_count: checks.filter((item) => item.severity === 'info').length,
  };
  return {
    command: 'promote check',
    status: summary.error_count > 0 ? 'failed' : summary.warning_count > 0 ? 'warning' : 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    request_path: requestPath,
    request_id: isPlainObject(request) && typeof request.request_id === 'string' ? request.request_id : null,
    summary,
    downstream_execution: 'not-run',
    writes: [],
    checks,
  };
}


function buildProposalArtifacts(request, requestPath, checkReport) {
  const outputs = request.requested_outputs.map((output, index) => ({
    id: `output-${index + 1}`,
    ...output,
  }));
  const candidates = request.candidate_items.map((item, index) => ({
    id: item.id || `item-${index + 1}`,
    summary: item.summary,
    evidence: item.evidence,
    candidate_kind: item.candidate_kind,
    target_surface: item.target_surface,
    risk: item.risk,
    review_required: item.review_required,
    reason: item.reason,
    source_refs: item.source_refs || [],
  }));

  return outputs.map((output, index) => {
    const matchedCandidates = candidates.filter((candidate) => outputMatchesCandidate(output, candidate));
    const proposalId = `${sanitizeId(request.request_id)}__${String(index + 1).padStart(2, '0')}__${output.kind}`;
    return {
      schema_version: '0.1',
      proposal_id: proposalId,
      proposal_type: output.kind,
      status: 'pending_review',
      created_at: new Date().toISOString(),
      request_id: request.request_id,
      request_path: requestPath,
      source_refs: request.source_refs,
      trigger: request.trigger,
      target_owner: output.target_owner,
      target_surface: inferOutputSurface(output),
      review_required: output.review_required,
      risk: maxRisk(matchedCandidates),
      summary: proposalSummary(output, matchedCandidates),
      rationale: proposalRationale(output, matchedCandidates),
      candidate_items: matchedCandidates.length > 0 ? matchedCandidates : candidates,
      requested_output: output,
      acceptance_checks: buildAcceptanceChecks(request, checkReport),
      automation_boundary: {
        mode: 'proposal_only',
        allow_apply: false,
        downstream_execution: 'not-run',
        owner_apply_required: output.kind !== 'noop',
      },
      outcome: {
        status: 'not_applied',
        applied_by: null,
        applied_at: null,
      },
    };
  });
}


function resolveOutputDir(args, request) {
  if (path.isAbsolute(args.out)) return path.resolve(args.out);
  const base = args.workspace
    ? path.resolve(args.workspace)
    : isPlainObject(request) && typeof request.workspace === 'string' && request.workspace.trim() !== ''
      ? path.resolve(request.workspace)
      : process.cwd();
  return path.resolve(base, args.out);
}


function outputMatchesCandidate(output, candidate) {
  const mappings = {
    memory_proposal: 'memory',
    wiki_proposal: 'wiki',
    skill_proposal: 'skill',
    eval_proposal: 'eval',
    compression_proposal: 'compression',
    noop: 'noop',
  };
  const candidateKind = mappings[output.kind];
  if (!candidateKind) return true;
  return candidate.candidate_kind === candidateKind || candidate.candidate_kind === 'mixed';
}


function inferOutputSurface(output) {
  const mappings = {
    pamem: 'pamem',
    LoreForge: 'loreforge',
    'skill-manager': 'skill-manager',
    evals: 'evals',
    Noesis: 'noesis',
    none: 'none',
    unknown: 'unknown',
  };
  return mappings[output.target_owner] || 'unknown';
}


function maxRisk(candidates) {
  const ordered = ['low', 'medium', 'high'];
  return candidates.reduce((current, candidate) => (
    ordered.indexOf(candidate.risk) > ordered.indexOf(current) ? candidate.risk : current
  ), 'low');
}


function proposalSummary(output, candidates) {
  if (output.kind === 'noop') return 'No downstream proposal requested.';
  if (candidates.length === 0) return `${output.kind} requested without a matching candidate item.`;
  if (candidates.length === 1) return candidates[0].summary;
  return `${output.kind} covering ${candidates.length} candidate items.`;
}


function proposalRationale(output, candidates) {
  if (output.kind === 'noop') return 'The request records that no durable owner artifact should be generated.';
  if (candidates.length === 0) return 'No matching candidate item was found; reviewer should inspect the full request before approval.';
  return candidates.map((candidate) => `${candidate.id}: ${candidate.reason}`).join('\n');
}


function buildAcceptanceChecks(request, checkReport) {
  const checks = [
    {
      kind: 'promote_check',
      command: `noesis promote check ${checkReport.request_path} --json`,
      expected: 'status has no errors before owner review',
      status: checkReport.summary.error_count === 0 ? 'passed' : 'failed',
    },
  ];
  if (request.expected_regression) {
    checks.push({
      kind: request.expected_regression.kind,
      scenario: request.expected_regression.scenario,
      acceptance: request.expected_regression.acceptance,
      status: 'pending_owner_review',
    });
  }
  return checks;
}


function buildPlanReport({ status, requestPath, request, outputDir, checkReport, proposals, actions, checks }) {
  const summary = {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length + checkReport.summary.error_count,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length + checkReport.summary.warning_count,
    info_count: checks.filter((item) => item.severity === 'info').length,
    proposal_count: proposals.length,
  };
  return {
    command: 'promote plan',
    status,
    schema_version: '0.1',
    request_path: requestPath,
    request_id: isPlainObject(request) && typeof request.request_id === 'string' ? request.request_id : null,
    output_dir: outputDir,
    downstream_execution: 'not-run',
    writes: actions.filter((action) => action.action === 'wrote' || action.action === 'created').map((action) => action.path),
    actions,
    summary,
    check_report: checkReport,
    proposals: proposals.map((proposal) => ({
      proposal_id: proposal.proposal_id,
      proposal_type: proposal.proposal_type,
      target_owner: proposal.target_owner,
      status: proposal.status,
      path: proposal.path,
    })),
    checks,
  };
}


function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printHuman(report) {
  console.log(`Noesis promote check: ${report.status}`);
  console.log(`Request: ${report.request_path}`);
  if (report.request_id) console.log(`Request ID: ${report.request_id}`);
  console.log('Downstream execution: not run');
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}


function printPlanHuman(report) {
  console.log(`Noesis promote plan: ${report.status}`);
  console.log(`Request: ${report.request_path}`);
  if (report.request_id) console.log(`Request ID: ${report.request_id}`);
  console.log(`Output directory: ${report.output_dir}`);
  console.log('Downstream execution: not run');
  for (const action of report.actions) {
    console.log(`- ${action.action}: ${action.path}`);
  }
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}


export function printPromoteUsage() {
  console.log(`Usage: noesis promote <command> [args]

Commands:
  check <request-file>          Validate a promote-request artifact without writing proposals or applying changes.
  plan <request-file>           Generate proposal-only artifacts for owner review.
  help                          Show promote command help.

Options:
  -h, --help                    Show this help message.

Examples:
  noesis promote check .noesis/promote-requests/example.json
  noesis promote check .noesis/promote-requests/example.json --json
  noesis promote plan .noesis/promote-requests/example.json --out .noesis/proposals/`);
}


export function printPromoteCheckUsage() {
  console.log(`Usage: noesis promote check <request-file> [--workspace <path>] [--json]

Read-only gate for a promote-request JSON artifact.

Options:
  --workspace <path>            Optional workspace expected by the request.
  --json                        Print machine-readable JSON.

The check validates schema, short source references, candidate routing surface,
risk/review boundaries, and transcript-retention hazards. It does not write
proposal artifacts or apply downstream owner changes.`);
}


export function printPromotePlanUsage() {
  console.log(`Usage: noesis promote plan <request-file> [--workspace <path>] [--out <dir>] [--force] [--json]

Generate proposal-only JSON artifacts from a checked promote-request.

Options:
  --workspace <path>            Optional workspace expected by the request.
  --out <dir>                   Proposal output directory. Defaults to .noesis/proposals.
  --force                       Overwrite existing proposal artifacts.
  --json                        Print machine-readable JSON.

The plan command reruns the read-only promote check first. If check errors are
present, it writes nothing and exits 1. On success it writes isolated proposal
artifacts only; it does not apply memory, wiki, skill, or eval changes.`);
}
