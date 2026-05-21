import path from 'node:path';
import { createEventPromoteReport } from './event.mjs';
import { createPromotePlanReport } from './promote.mjs';


export class RouteError extends Error {}


const DEFAULT_REQUEST_DIR = path.join('.noesis', 'promote-requests');
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');


export function runRouteCommand(tokens) {
  if (tokens.length === 0 || tokens[0] === '-h' || tokens[0] === '--help') {
    printRouteUsage();
    return 0;
  }
  if (tokens[0] === 'help') {
    if (tokens.length === 1) {
      printRouteUsage();
      return 0;
    }
    throw new RouteError(`unknown help topic: route ${tokens.slice(1).join(' ')}`);
  }

  const args = parseArgs(tokens);
  if (args.help) return 0;
  return runRoute(args);
}


function runRoute(args) {
  const report = createRouteReport(args);
  if (args.json) printJson(report);
  else printRouteHuman(report);
  return report.summary.error_count > 0 ? 1 : 0;
}


export function createRouteReport(args) {
  const eventPromoteResult = createEventPromoteReport({
    eventPath: args.eventPath,
    workspace: args.workspace,
    out: args.requestOut,
    force: args.force,
  });
  const eventPromoteReport = eventPromoteResult.report;
  let promotePlanResult = null;
  let promotePlanReport = null;
  const checks = [
    check('route.boundary', 'info', true, 'route orchestrates existing gates without owner apply'),
  ];

  if (eventPromoteReport.summary.error_count > 0) {
    checks.push(check('route.event_promote', 'error', false, 'event promote failed; promote plan was not run'));
  } else {
    promotePlanResult = createPromotePlanReport({
      requestPath: eventPromoteReport.request_path,
      workspace: args.workspace,
      out: args.proposalOut,
      force: args.force,
    });
    promotePlanReport = promotePlanResult.report;
    if (promotePlanReport.summary.error_count > 0) {
      checks.push(check('route.promote_plan', 'error', false, 'promote plan failed'));
    } else {
      checks.push(check('route.promote_plan', 'info', true, 'promote plan completed without check errors'));
    }
  }

  return buildRouteReport({
    eventPromoteReport,
    promotePlanReport,
    checks,
  });
}


function parseArgs(tokens) {
  const args = {
    json: false,
    workspace: null,
    requestOut: DEFAULT_REQUEST_DIR,
    proposalOut: DEFAULT_PROPOSAL_DIR,
    force: false,
    eventPath: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printRouteUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--request-out') {
      args.requestOut = requireValue(tokens, ++index, '--request-out');
    } else if (token.startsWith('--request-out=')) {
      args.requestOut = token.slice('--request-out='.length);
    } else if (token === '--proposal-out') {
      args.proposalOut = requireValue(tokens, ++index, '--proposal-out');
    } else if (token.startsWith('--proposal-out=')) {
      args.proposalOut = token.slice('--proposal-out='.length);
    } else if (token === '--force') {
      args.force = true;
    } else if (token.startsWith('-')) {
      throw new RouteError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new RouteError('usage: noesis route <event-file>');
  }
  args.eventPath = positionals[0];
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new RouteError(`missing value for ${option}`);
  }
  return value;
}


function buildRouteReport({ eventPromoteReport, promotePlanReport, checks }) {
  const reports = [eventPromoteReport, promotePlanReport].filter(Boolean);
  const summary = {
    error_count: sumReports(reports, 'error_count') + countChecks(checks, 'error'),
    warning_count: sumReports(reports, 'warning_count') + countChecks(checks, 'warning'),
    info_count: sumReports(reports, 'info_count') + checks.filter((item) => item.severity === 'info').length,
    request_count: eventPromoteReport.summary.request_count || 0,
    proposal_count: promotePlanReport?.summary.proposal_count || 0,
  };
  return {
    command: 'route',
    status: summary.error_count > 0 ? 'failed' : summary.warning_count > 0 ? 'warning' : 'ok',
    schema_version: '0.1',
    event_path: eventPromoteReport.event_path,
    event_id: eventPromoteReport.event_id,
    request_path: eventPromoteReport.request_path,
    request_id: eventPromoteReport.request_id,
    proposal_output_dir: promotePlanReport?.output_dir || null,
    downstream_execution: 'not-run',
    writes: uniquePaths([
      ...eventPromoteReport.writes,
      ...(promotePlanReport?.writes || []),
    ]),
    summary,
    event_promote_report: eventPromoteReport,
    promote_plan_report: promotePlanReport,
    proposals: promotePlanReport?.proposals || [],
    checks,
  };
}


function sumReports(reports, field) {
  return reports.reduce((total, report) => total + (report.summary?.[field] || 0), 0);
}


function countChecks(checks, severity) {
  return checks.filter((item) => item.severity === severity && item.status !== 'ok').length;
}


function uniquePaths(paths) {
  return [...new Set(paths)];
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


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printRouteHuman(report) {
  console.log(`Noesis route: ${report.status}`);
  console.log(`Event: ${report.event_path}`);
  if (report.event_id) console.log(`Event ID: ${report.event_id}`);
  if (report.request_path) console.log(`Promote request: ${report.request_path}`);
  if (report.proposal_output_dir) console.log(`Proposal directory: ${report.proposal_output_dir}`);
  console.log('Downstream execution: not run');
  for (const item of report.checks) {
    const marker = item.status === 'ok' ? 'ok' : item.severity;
    console.log(`- ${marker} ${item.id}: ${item.message}`);
  }
}


export function printRouteUsage() {
  console.log(`Usage: noesis route <event-file> [--workspace <path>] [--request-out <dir>] [--proposal-out <dir>] [--force] [--json]

Run the high-level event-to-proposal route orchestration for one learning-event artifact.

Options:
  --workspace <path>            Optional workspace expected by generated artifacts.
  --request-out <dir>           Promote-request output directory. Defaults to .noesis/promote-requests.
  --proposal-out <dir>          Proposal output directory. Defaults to .noesis/proposals.
  --force                       Overwrite existing request and proposal artifacts.
  --json                        Print machine-readable JSON.

The command composes the existing gates: event check/promote, then promote
check/plan. If a gate has errors, later steps are not run. Successful route
writes only Noesis promote-request and proposal artifacts; it does not apply
memory, wiki, skill, or eval owner changes.`);
}
