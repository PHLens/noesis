import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteReport } from './route.mjs';


export class EvalReplayError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_GOLDEN_CASE = fileURLToPath(new URL('../examples/eval-replay.route-proposal.golden.json', import.meta.url));


export function runEvalReplayCommand(tokens) {
  const args = parseEvalReplayArgs(tokens);
  if (args.help) return 0;
  const report = runEvalReplay(args);
  if (args.json) printJson(report);
  else printReplayHuman(report);
  return report.summary.failed_count > 0 ? 1 : 0;
}


export function runEvalReplay(args) {
  const casePaths = args.casePaths.length > 0 ? args.casePaths : [DEFAULT_GOLDEN_CASE];
  const cases = casePaths.flatMap((casePath) => loadGoldenCases(casePath));
  const results = cases.map((goldenCase) => replayCase(goldenCase, args));
  const failed = results.filter((result) => result.status !== 'pass');
  const keptWrites = results
    .filter((result) => !result.workspace_removed)
    .flatMap((result) => result.temporary_writes);
  return {
    command: 'eval replay',
    status: failed.length > 0 ? 'failed' : 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    case_files: casePaths.map((casePath) => path.resolve(casePath)),
    downstream_execution: 'not-run',
    side_effects: args.keepWorkspaces ? 'temporary-workspace-kept' : 'temporary-workspace-removed',
    writes: keptWrites,
    summary: {
      case_count: results.length,
      passed_count: results.length - failed.length,
      failed_count: failed.length,
      error_count: results.reduce((total, result) => total + result.summary.error_count, 0),
      warning_count: results.reduce((total, result) => total + result.summary.warning_count, 0),
      info_count: results.reduce((total, result) => total + result.summary.info_count, 0),
    },
    cases: results,
  };
}


function parseEvalReplayArgs(tokens) {
  const args = {
    json: false,
    tmpRoot: null,
    keepWorkspaces: false,
    casePaths: [],
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printEvalReplayUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--tmp-root') {
      args.tmpRoot = requireValue(tokens, ++index, '--tmp-root');
    } else if (token.startsWith('--tmp-root=')) {
      args.tmpRoot = token.slice('--tmp-root='.length);
    } else if (token === '--keep-workspaces') {
      args.keepWorkspaces = true;
    } else if (token.startsWith('-')) {
      throw new EvalReplayError(`unknown option: ${token}`);
    } else {
      args.casePaths.push(token);
    }
  }
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new EvalReplayError(`missing value for ${option}`);
  }
  return value;
}


function loadGoldenCases(casePathArg) {
  const casePath = path.resolve(casePathArg);
  let text;
  try {
    text = fs.readFileSync(casePath, 'utf8');
  } catch (error) {
    throw new EvalReplayError(`failed to read golden case file ${casePath}: ${error.message}`);
  }

  let root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    throw new EvalReplayError(`golden case file is not valid JSON ${casePath}: ${error.message}`);
  }

  const cases = Array.isArray(root) ? root : Array.isArray(root.cases) ? root.cases : [root];
  if (cases.length === 0) {
    throw new EvalReplayError(`golden case file has no cases: ${casePath}`);
  }
  return cases.map((goldenCase, index) => normalizeGoldenCase(goldenCase, casePath, index));
}


function normalizeGoldenCase(goldenCase, casePath, index) {
  if (!isPlainObject(goldenCase)) {
    throw new EvalReplayError(`golden case must be a JSON object: ${casePath}#${index + 1}`);
  }
  if (goldenCase.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new EvalReplayError(`unsupported golden case schema_version in ${casePath}#${index + 1}: ${goldenCase.schema_version}`);
  }
  if (typeof goldenCase.case_id !== 'string' || goldenCase.case_id.trim() === '') {
    throw new EvalReplayError(`case_id is required in ${casePath}#${index + 1}`);
  }
  if (!isPlainObject(goldenCase.input) || !isPlainObject(goldenCase.input.event)) {
    throw new EvalReplayError(`input.event is required in ${casePath}#${index + 1}`);
  }
  return {
    ...goldenCase,
    source_path: casePath,
  };
}


function replayCase(goldenCase, args) {
  const tmpRoot = path.resolve(args.tmpRoot || os.tmpdir());
  fs.mkdirSync(tmpRoot, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(tmpRoot, `noesis-eval-replay-${sanitizeId(goldenCase.case_id)}-`));
  const checks = [];
  let routeReport = null;
  let request = null;
  let proposals = [];
  let temporaryWrites = [];
  let workspaceRemoved = false;

  try {
    const event = replaceWorkspaceToken(deepClone(goldenCase.input.event), workspace);
    if (typeof event.workspace !== 'string' || event.workspace.trim() === '') {
      event.workspace = workspace;
    }
    const eventPath = writeEvent(workspace, event);
    temporaryWrites = [eventPath];
    createExtraOwnerState(workspace, goldenCase.input.extra_owner_state, temporaryWrites);
    routeReport = createRouteReport({
      eventPath,
      workspace,
      requestOut: path.join('.noesis', 'promote-requests'),
      proposalOut: path.join('.noesis', 'proposals'),
      force: true,
    });
    temporaryWrites = [...temporaryWrites, ...(routeReport.writes || [])];
    request = readOptionalJson(routeReport.request_path);
    proposals = (routeReport.proposals || [])
      .map((proposal) => readOptionalJson(proposal.path))
      .filter(Boolean);
    evaluateExpectations(goldenCase, routeReport, request, proposals, workspace, checks);
  } catch (error) {
    checks.push(check('eval.replay.exception', 'error', false, error.message));
  } finally {
    if (!args.keepWorkspaces) {
      fs.rmSync(workspace, { recursive: true, force: true });
      workspaceRemoved = true;
    }
  }

  const summary = summarizeChecks(checks);
  return {
    case_id: goldenCase.case_id,
    description: goldenCase.description || null,
    source_path: goldenCase.source_path,
    status: summary.error_count > 0 ? 'fail' : 'pass',
    workspace,
    workspace_removed: workspaceRemoved,
    downstream_execution: 'not-run',
    temporary_writes: temporaryWrites,
    actual: summarizeActual(routeReport, request, proposals),
    summary,
    checks,
  };
}


function createExtraOwnerState(workspace, extraOwnerState, temporaryWrites) {
  if (!Array.isArray(extraOwnerState)) return;
  for (const entry of extraOwnerState) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new EvalReplayError('input.extra_owner_state entries must be non-empty strings');
    }
    const target = path.resolve(workspace, entry);
    if (!isPathInside(target, workspace)) {
      throw new EvalReplayError(`input.extra_owner_state must stay inside the temporary workspace: ${entry}`);
    }
    fs.mkdirSync(target, { recursive: true });
    temporaryWrites.push(target);
  }
}


function writeEvent(workspace, event) {
  const eventDir = path.join(workspace, '.noesis', 'events');
  fs.mkdirSync(eventDir, { recursive: true });
  const eventId = typeof event.event_id === 'string' && event.event_id.trim() !== ''
    ? event.event_id
    : 'event';
  const eventPath = path.join(eventDir, `${sanitizeId(eventId)}.json`);
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`);
  return eventPath;
}


function readOptionalJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}


function evaluateExpectations(goldenCase, routeReport, request, proposals, workspace, checks) {
  const expect = isPlainObject(goldenCase.expect) ? replaceWorkspaceToken(deepClone(goldenCase.expect), workspace) : {};
  checks.push(check(
    'eval.replay.downstream_execution',
    'error',
    routeReport?.downstream_execution === 'not-run',
    'route replay must not run downstream owner execution',
    { actual: routeReport?.downstream_execution || null },
  ));
  checks.push(check(
    'eval.replay.owner_state',
    'error',
    ownerStateAbsent(workspace),
    'route replay must not create owner state outside Noesis temp artifacts',
  ));

  if (expect.status !== undefined) {
    checks.push(check(
      'eval.replay.status',
      'error',
      routeReport?.status === expect.status,
      `route status should be ${expect.status}`,
      { actual: routeReport?.status || null, expected: expect.status },
    ));
  }
  if (isPlainObject(expect.summary)) {
    comparePartial(expect.summary, routeReport?.summary, 'eval.replay.summary', checks);
  }
  if (expect.downstream_execution !== undefined) {
    checks.push(check(
      'eval.replay.expected_downstream_execution',
      'error',
      routeReport?.downstream_execution === expect.downstream_execution,
      `downstream_execution should be ${expect.downstream_execution}`,
      { actual: routeReport?.downstream_execution || null, expected: expect.downstream_execution },
    ));
  }
  if (isPlainObject(expect.request)) {
    comparePartial(expect.request, request, 'eval.replay.request', checks);
  }
  if (Array.isArray(expect.proposals)) {
    checks.push(check(
      'eval.replay.proposals.length',
      'error',
      proposals.length === expect.proposals.length,
      `proposal count should be ${expect.proposals.length}`,
      { actual: proposals.length, expected: expect.proposals.length },
    ));
    expect.proposals.forEach((expectedProposal, index) => {
      comparePartial(expectedProposal, proposals[index], `eval.replay.proposals[${index}]`, checks);
    });
  }
  if (expect.no_owner_state !== undefined) {
    checks.push(check(
      'eval.replay.expected_no_owner_state',
      'error',
      ownerStateAbsent(workspace) === expect.no_owner_state,
      `no_owner_state should be ${expect.no_owner_state}`,
      { actual: ownerStateAbsent(workspace), expected: expect.no_owner_state },
    ));
  }
}


function comparePartial(expected, actual, id, checks) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      checks.push(check(id, 'error', false, `${id} should be an array`, { actual_type: typeName(actual) }));
      return;
    }
    checks.push(check(
      `${id}.length`,
      'error',
      actual.length === expected.length,
      `${id} length should be ${expected.length}`,
      { actual: actual.length, expected: expected.length },
    ));
    expected.forEach((item, index) => comparePartial(item, actual[index], `${id}[${index}]`, checks));
    return;
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      checks.push(check(id, 'error', false, `${id} should be an object`, { actual_type: typeName(actual) }));
      return;
    }
    for (const [field, value] of Object.entries(expected)) {
      comparePartial(value, actual[field], `${id}.${field}`, checks);
    }
    return;
  }
  checks.push(check(
    id,
    'error',
    Object.is(actual, expected),
    `${id} should match the golden value`,
    { actual, expected },
  ));
}


function ownerStateAbsent(workspace) {
  return [
    path.join(workspace, '.pamem'),
    path.join(workspace, '.loreforge'),
    path.join(workspace, '.codex'),
    path.join(workspace, '.claude'),
    path.join(workspace, '.noesis', 'owner-handoffs'),
    path.join(workspace, '.noesis', 'reports', 'eval-handoffs'),
    path.join(workspace, 'evals'),
  ].every((candidate) => !fs.existsSync(candidate));
}


function summarizeActual(routeReport, request, proposals) {
  return {
    route_status: routeReport?.status || null,
    request_id: request?.request_id || null,
    request_output_kinds: Array.isArray(request?.requested_outputs)
      ? request.requested_outputs.map((output) => output.kind)
      : [],
    proposal_ids: proposals.map((proposal) => proposal.proposal_id),
    proposal_types: proposals.map((proposal) => proposal.proposal_type),
    proposal_statuses: proposals.map((proposal) => proposal.status),
    downstream_execution: routeReport?.downstream_execution || null,
  };
}


function summarizeChecks(checks) {
  return {
    error_count: checks.filter((item) => item.severity === 'error' && item.status !== 'ok').length,
    warning_count: checks.filter((item) => item.severity === 'warning' && item.status !== 'ok').length,
    info_count: checks.filter((item) => item.severity === 'info').length,
  };
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


function replaceWorkspaceToken(value, workspace) {
  if (typeof value === 'string') return value.replaceAll('$WORKSPACE', workspace);
  if (Array.isArray(value)) return value.map((item) => replaceWorkspaceToken(item, workspace));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, replaceWorkspaceToken(child, workspace)]),
  );
}


function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}


function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}


function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}


function typeName(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printReplayHuman(report) {
  console.log(`Noesis eval replay: ${report.status}`);
  console.log(`Cases: ${report.summary.passed_count} passed, ${report.summary.failed_count} failed`);
  console.log('Downstream execution: not run');
  for (const result of report.cases) {
    console.log(`- ${result.status} ${result.case_id}: ${result.description || 'golden case'}`);
    for (const item of result.checks.filter((entry) => entry.status !== 'ok')) {
      console.log(`  - ${item.severity} ${item.id}: ${item.message}`);
    }
  }
}


export function printEvalReplayUsage() {
  console.log(`Usage: noesis eval replay [case-file...] [--tmp-root <dir>] [--keep-workspaces] [--json]

Replay route/proposal golden cases in isolated temporary workspaces.

Options:
  --tmp-root <dir>              Directory where temporary replay workspaces are created. Defaults to the OS temp directory.
  --keep-workspaces             Keep temporary workspaces for inspection. By default they are removed.
  --json                        Print machine-readable JSON.

When no case-file is provided, the packaged route/proposal golden case is used.
The replay command writes only temporary Noesis artifacts, does not call owner
commands, does not create owner artifacts, and keeps downstream_execution=not-run.`);
}
