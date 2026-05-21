import fs from 'node:fs';
import path from 'node:path';


export class EvalHandoffError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');
const DEFAULT_REPORTS_DIR = path.join('.noesis', 'reports', 'eval-handoffs');


export function runEvalCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printEvalUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printEvalUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'handoff') {
      printEvalHandoffUsage();
      return 0;
    }
    throw new EvalHandoffError(`unknown help topic: eval ${rest.join(' ')}`);
  }
  if (command !== 'handoff') {
    throw new EvalHandoffError(`unknown eval command: ${command}`);
  }

  const args = parseEvalHandoffArgs(rest);
  if (args.help) return 0;
  return runEvalHandoff(args);
}


function runEvalHandoff(args) {
  const proposalDir = resolveDir(args.workspace, args.proposalDir);
  const reportsDir = resolveDir(args.workspace, args.out);
  const record = resolveProposalRecord(proposalDir, args.selector);
  if (!record.valid) {
    throw new EvalHandoffError(`proposal is not a valid JSON artifact: ${record.path}: ${record.error}`);
  }
  if (!isPathInside(record.path, proposalDir)) {
    throw new EvalHandoffError(`eval handoff is limited to the proposal queue directory: ${proposalDir}`);
  }
  validateEvalProposal(record.proposal, record.path);

  const report = buildHandoffReport(record, reportsDir, args);
  const reportPath = path.join(reportsDir, `${sanitizeId(report.handoff_id)}.json`);
  if (fs.existsSync(reportPath) && !args.force) {
    throw new EvalHandoffError(`handoff report already exists: ${reportPath}; use --force to overwrite`);
  }
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ ...report, report_path: reportPath }, null, 2)}\n`);

  const envelope = {
    command: 'eval handoff',
    status: 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    reports_dir: reportsDir,
    proposal_path: record.path,
    report_path: reportPath,
    proposal_id: record.proposal.proposal_id,
    handoff_id: report.handoff_id,
    downstream_execution: 'not-run',
    writes: [reportPath],
    report: { ...report, report_path: reportPath },
  };
  if (args.json) printJson(envelope);
  else printHandoffHuman(envelope);
  return 0;
}


function parseEvalHandoffArgs(tokens) {
  const args = {
    workspace: null,
    proposalDir: DEFAULT_PROPOSAL_DIR,
    out: DEFAULT_REPORTS_DIR,
    reviewer: null,
    note: null,
    force: false,
    json: false,
    selector: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printEvalHandoffUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--force') {
      args.force = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--proposal-dir') {
      args.proposalDir = requireValue(tokens, ++index, '--proposal-dir');
    } else if (token.startsWith('--proposal-dir=')) {
      args.proposalDir = token.slice('--proposal-dir='.length);
    } else if (token === '--out') {
      args.out = requireValue(tokens, ++index, '--out');
    } else if (token.startsWith('--out=')) {
      args.out = token.slice('--out='.length);
    } else if (token === '--reviewer') {
      args.reviewer = requireValue(tokens, ++index, '--reviewer');
    } else if (token.startsWith('--reviewer=')) {
      args.reviewer = token.slice('--reviewer='.length);
    } else if (token === '--note') {
      args.note = requireValue(tokens, ++index, '--note');
    } else if (token.startsWith('--note=')) {
      args.note = token.slice('--note='.length);
    } else if (token.startsWith('-')) {
      throw new EvalHandoffError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (positionals.length !== 1) {
    throw new EvalHandoffError('usage: noesis eval handoff <proposal-id-or-path>');
  }
  args.selector = positionals[0];
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new EvalHandoffError(`missing value for ${option}`);
  }
  return value;
}


function resolveDir(workspace, dir) {
  if (path.isAbsolute(dir)) return path.resolve(dir);
  return path.resolve(workspace ? path.resolve(workspace) : process.cwd(), dir);
}


function resolveProposalRecord(proposalDir, selector) {
  const directPath = resolveSelectorPath(proposalDir, selector);
  if (directPath && fs.existsSync(directPath)) return readProposalRecord(directPath);

  const matches = listProposalRecords(proposalDir)
    .filter((record) => record.valid && record.proposal.proposal_id === selector);
  if (matches.length === 0) {
    throw new EvalHandoffError(`proposal not found: ${selector}`);
  }
  if (matches.length > 1) {
    throw new EvalHandoffError(`proposal id is ambiguous: ${selector}`);
  }
  return matches[0];
}


function resolveSelectorPath(proposalDir, selector) {
  const hasPathShape = path.isAbsolute(selector)
    || selector.includes('/')
    || selector.includes('\\')
    || selector.endsWith('.json');
  if (!hasPathShape) return null;
  if (path.isAbsolute(selector)) return path.resolve(selector);
  const cwdPath = path.resolve(selector);
  if (fs.existsSync(cwdPath)) return cwdPath;
  return path.resolve(proposalDir, selector);
}


function listProposalRecords(proposalDir) {
  if (!fs.existsSync(proposalDir)) return [];
  const stat = fs.statSync(proposalDir);
  if (!stat.isDirectory()) throw new EvalHandoffError(`proposal directory is not a directory: ${proposalDir}`);
  return fs.readdirSync(proposalDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readProposalRecord(path.join(proposalDir, entry)));
}


function readProposalRecord(proposalPath) {
  let text;
  try {
    text = fs.readFileSync(proposalPath, 'utf8');
  } catch (error) {
    return { path: proposalPath, valid: false, error: `read failed: ${error.message}` };
  }
  try {
    const proposal = JSON.parse(text);
    if (!isPlainObject(proposal)) {
      return { path: proposalPath, valid: false, error: 'proposal root must be a JSON object' };
    }
    return { path: proposalPath, valid: true, proposal };
  } catch (error) {
    return { path: proposalPath, valid: false, error: `parse failed: ${error.message}` };
  }
}


function validateEvalProposal(proposal, proposalPath) {
  if (!isPlainObject(proposal)) throw new EvalHandoffError(`proposal root must be a JSON object: ${proposalPath}`);
  if (proposal.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new EvalHandoffError(`unsupported proposal schema_version in ${proposalPath}: ${proposal.schema_version}`);
  }
  if (typeof proposal.proposal_id !== 'string' || proposal.proposal_id.trim() === '') {
    throw new EvalHandoffError(`proposal_id is required in ${proposalPath}`);
  }
  if (proposal.proposal_type !== 'eval_proposal') {
    throw new EvalHandoffError(`eval handoff only supports eval_proposal artifacts: ${proposalPath}`);
  }
  if (proposal.target_owner !== 'evals' || proposal.target_surface !== 'evals') {
    throw new EvalHandoffError(`eval handoff requires target_owner=evals and target_surface=evals: ${proposalPath}`);
  }
  if (proposal.status !== 'approved') {
    throw new EvalHandoffError(`eval handoff requires an approved proposal: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.automation_boundary) || proposal.automation_boundary.allow_apply !== false) {
    throw new EvalHandoffError(`eval handoff only supports proposal-only artifacts with allow_apply=false: ${proposalPath}`);
  }
  if (proposal.automation_boundary.downstream_execution !== 'not-run') {
    throw new EvalHandoffError(`eval handoff only supports artifacts with downstream_execution=not-run: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.outcome) || proposal.outcome.status !== 'not_applied') {
    throw new EvalHandoffError(`eval handoff requires outcome.status=not_applied: ${proposalPath}`);
  }
}


function buildHandoffReport(record, reportsDir, args) {
  const proposal = record.proposal;
  const now = new Date().toISOString();
  const handoffId = `${proposal.proposal_id}__eval_handoff`;
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    handoff_id: handoffId,
    created_at: now,
    proposal_id: proposal.proposal_id,
    proposal_path: record.path,
    proposal_type: proposal.proposal_type,
    target_owner: proposal.target_owner,
    target_surface: proposal.target_surface,
    status: 'pending_owner_action',
    owner_action: {
      kind: 'eval_handoff',
      expected_owner: 'evals',
      suggested_artifact: suggestedEvalArtifactPath(proposal),
      required_review: true,
      downstream_execution: 'not-run',
    },
    source_refs: Array.isArray(proposal.source_refs) ? proposal.source_refs : [],
    summary: proposal.summary || null,
    rationale: proposal.rationale || null,
    acceptance_checks: Array.isArray(proposal.acceptance_checks) ? proposal.acceptance_checks : [],
    candidate_items: Array.isArray(proposal.candidate_items) ? proposal.candidate_items : [],
    reviewer: args.reviewer || null,
    note: args.note || null,
    reports_dir: reportsDir,
    automation_boundary: {
      mode: 'owner_handoff_skeleton',
      allow_apply: false,
      downstream_execution: 'not-run',
      owner_apply_required: true,
    },
    writes: [],
  };
}


function suggestedEvalArtifactPath(proposal) {
  return path.join('evals', `${sanitizeId(proposal.proposal_id)}.json`);
}


function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printHandoffHuman(envelope) {
  console.log('Noesis eval handoff: ok');
  console.log(`Proposal ID: ${envelope.proposal_id}`);
  console.log(`Handoff ID: ${envelope.handoff_id}`);
  console.log(`Report: ${envelope.report_path}`);
  console.log('Downstream execution: not run');
}


export function printEvalUsage() {
  console.log(`Usage: noesis eval <command> [args]

Commands:
  handoff <proposal-id-or-path>  Write an eval owner-handoff report.
  help                          Show eval command help.

Options:
  -h, --help                    Show this help message.

Examples:
  noesis eval handoff 2026-05-19T06-00-00Z__promote__01__eval_proposal --reviewer @Percy
  noesis eval handoff .noesis/proposals/proposal.json --json`);
}


export function printEvalHandoffUsage() {
  console.log(`Usage: noesis eval handoff <proposal-id-or-path> [--workspace <path>] [--proposal-dir <dir>] [--out <dir>] [--reviewer <name>] [--note <text>] [--force] [--json]

Write an eval owner-handoff report for an approved eval_proposal.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --proposal-dir <dir>          Proposal directory. Defaults to .noesis/proposals under the workspace.
  --out <dir>                   Handoff report directory. Defaults to .noesis/reports/eval-handoffs.
  --reviewer <name>             Optional reviewer label.
  --note <text>                 Optional compact handoff note.
  --force                       Overwrite an existing handoff report.
  --json                        Print machine-readable JSON.

The handoff command writes a Noesis report only. It does not create eval files,
run evals, mutate proposals, or apply owner changes.`);
}
