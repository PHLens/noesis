import fs from 'node:fs';
import path from 'node:path';


export class ProposalError extends Error {}


const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');
const SUPPORTED_SCHEMA_VERSION = '0.1';
const TERMINAL_STATUSES = new Set(['superseded']);
const REVIEW_STATUSES = new Set(['pending_review', 'approved', 'rejected', 'superseded']);
const RESERVED_STATUSES = new Set(['applied']);
const STATUS_TRANSITIONS = {
  pending_review: new Set(['approved', 'rejected', 'superseded']),
  approved: new Set(['rejected', 'superseded']),
  rejected: new Set(['superseded']),
  superseded: new Set([]),
};


export function runProposalCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printProposalUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printProposalUsage();
      return 0;
    }
    if (rest.length === 1 && ['list', 'show', 'update'].includes(rest[0])) {
      printProposalCommandUsage(rest[0]);
      return 0;
    }
    throw new ProposalError(`unknown help topic: proposal ${rest.join(' ')}`);
  }
  if (!['list', 'show', 'update'].includes(command)) {
    throw new ProposalError(`unknown proposal command: ${command}`);
  }

  const args = parseProposalArgs(command, rest);
  if (args.help) return 0;
  if (command === 'list') return runProposalList(args);
  if (command === 'show') return runProposalShow(args);
  return runProposalUpdate(args);
}


function runProposalList(args) {
  const proposalDir = resolveProposalDir(args);
  const records = listProposalRecords(proposalDir);
  const filtered = args.status
    ? records.filter((record) => record.status === args.status)
    : records;
  const invalidCount = records.filter((record) => record.valid === false).length;
  const report = {
    command: 'proposal list',
    status: invalidCount > 0 ? 'warning' : 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    summary: {
      proposal_count: filtered.length,
      total_count: records.length,
      invalid_count: invalidCount,
    },
    downstream_execution: 'not-run',
    writes: [],
    proposals: filtered.map((record) => proposalListEntry(record)),
  };
  if (args.json) printJson(report);
  else printListHuman(report);
  return 0;
}


function runProposalShow(args) {
  const proposalDir = resolveProposalDir(args);
  const record = resolveProposalRecord(proposalDir, args.selector);
  if (!record.valid) {
    throw new ProposalError(`proposal is not a valid JSON artifact: ${record.path}: ${record.error}`);
  }
  const report = {
    command: 'proposal show',
    status: 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    proposal_path: record.path,
    downstream_execution: 'not-run',
    writes: [],
    proposal: record.proposal,
  };
  if (args.json) printJson(report);
  else printShowHuman(report);
  return 0;
}


function runProposalUpdate(args) {
  const proposalDir = resolveProposalDir(args);
  const record = resolveProposalRecord(proposalDir, args.selector);
  if (!record.valid) {
    throw new ProposalError(`proposal is not a valid JSON artifact: ${record.path}: ${record.error}`);
  }
  if (!isPathInside(record.path, proposalDir)) {
    throw new ProposalError(`proposal update is limited to the proposal queue directory: ${proposalDir}`);
  }
  const proposal = record.proposal;
  validateProposalForUpdate(proposal, record.path);
  validateRequestedStatus(args.status);
  const previousStatus = proposal.status;
  validateTransition(previousStatus, args.status);

  const now = new Date().toISOString();
  const reviewEntry = {
    reviewed_at: now,
    previous_status: previousStatus,
    status: args.status,
    reviewer: args.reviewer || null,
    note: args.note || null,
    command: 'noesis proposal update',
  };
  proposal.status = args.status;
  proposal.updated_at = now;
  if (!Array.isArray(proposal.review_history)) proposal.review_history = [];
  proposal.review_history.push(reviewEntry);

  fs.writeFileSync(record.path, `${JSON.stringify(proposal, null, 2)}\n`);

  const report = {
    command: 'proposal update',
    status: 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    proposal_path: record.path,
    proposal_id: proposal.proposal_id,
    previous_status: previousStatus,
    new_status: proposal.status,
    downstream_execution: 'not-run',
    writes: [record.path],
    review: reviewEntry,
    proposal,
  };
  if (args.json) printJson(report);
  else printUpdateHuman(report);
  return 0;
}


function parseProposalArgs(command, tokens) {
  const args = {
    command,
    workspace: null,
    dir: DEFAULT_PROPOSAL_DIR,
    json: false,
    status: null,
    reviewer: null,
    note: null,
    selector: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printProposalCommandUsage(command);
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--dir') {
      args.dir = requireValue(tokens, ++index, '--dir');
    } else if (token.startsWith('--dir=')) {
      args.dir = token.slice('--dir='.length);
    } else if (token === '--status') {
      args.status = requireValue(tokens, ++index, '--status');
    } else if (token.startsWith('--status=')) {
      args.status = token.slice('--status='.length);
    } else if (token === '--reviewer') {
      args.reviewer = requireValue(tokens, ++index, '--reviewer');
    } else if (token.startsWith('--reviewer=')) {
      args.reviewer = token.slice('--reviewer='.length);
    } else if (token === '--note') {
      args.note = requireValue(tokens, ++index, '--note');
    } else if (token.startsWith('--note=')) {
      args.note = token.slice('--note='.length);
    } else if (token.startsWith('-')) {
      throw new ProposalError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (command === 'list') {
    if (positionals.length !== 0) throw new ProposalError('usage: noesis proposal list');
    if (args.status) validateStatusFilter(args.status);
    if (args.reviewer) throw new ProposalError('--reviewer is not supported for proposal list');
    if (args.note) throw new ProposalError('--note is not supported for proposal list');
  } else if (command === 'show') {
    args.selector = requirePositionals(positionals, 1, 'show <proposal-id-or-path>')[0];
    if (args.status) throw new ProposalError('--status is not supported for proposal show');
    if (args.reviewer) throw new ProposalError('--reviewer is not supported for proposal show');
    if (args.note) throw new ProposalError('--note is not supported for proposal show');
  } else if (command === 'update') {
    args.selector = requirePositionals(positionals, 1, 'update <proposal-id-or-path> --status <status>')[0];
    if (!args.status) throw new ProposalError('usage: noesis proposal update <proposal-id-or-path> --status <status>');
  }

  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new ProposalError(`missing value for ${option}`);
  }
  return value;
}


function requirePositionals(positionals, count, usage) {
  if (positionals.length !== count) {
    throw new ProposalError(`usage: noesis proposal ${usage}`);
  }
  return positionals;
}


function resolveProposalDir(args) {
  if (path.isAbsolute(args.dir)) return path.resolve(args.dir);
  const base = args.workspace ? path.resolve(args.workspace) : process.cwd();
  return path.resolve(base, args.dir);
}


function listProposalRecords(proposalDir) {
  if (!fs.existsSync(proposalDir)) return [];
  const stat = fs.statSync(proposalDir);
  if (!stat.isDirectory()) throw new ProposalError(`proposal directory is not a directory: ${proposalDir}`);
  return fs.readdirSync(proposalDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readProposalRecord(path.join(proposalDir, entry)))
    .sort(compareProposalRecords);
}


function readProposalRecord(proposalPath) {
  let text;
  try {
    text = fs.readFileSync(proposalPath, 'utf8');
  } catch (error) {
    return { path: proposalPath, valid: false, error: `read failed: ${error.message}`, status: 'invalid' };
  }
  try {
    const proposal = JSON.parse(text);
    if (!isPlainObject(proposal)) {
      return { path: proposalPath, valid: false, error: 'proposal root must be a JSON object', status: 'invalid' };
    }
    return {
      path: proposalPath,
      valid: true,
      proposal,
      proposal_id: stringOrNull(proposal.proposal_id),
      proposal_type: stringOrNull(proposal.proposal_type),
      status: stringOrNull(proposal.status) || 'unknown',
      created_at: stringOrNull(proposal.created_at),
    };
  } catch (error) {
    return { path: proposalPath, valid: false, error: `parse failed: ${error.message}`, status: 'invalid' };
  }
}


function resolveProposalRecord(proposalDir, selector) {
  const directPath = resolveSelectorPath(proposalDir, selector);
  if (directPath && fs.existsSync(directPath)) return readProposalRecord(directPath);

  const records = listProposalRecords(proposalDir)
    .filter((record) => record.valid && record.proposal_id === selector);
  if (records.length === 0) {
    throw new ProposalError(`proposal not found: ${selector}`);
  }
  if (records.length > 1) {
    throw new ProposalError(`proposal id is ambiguous: ${selector}`);
  }
  return records[0];
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


function validateProposalForUpdate(proposal, proposalPath) {
  if (!isPlainObject(proposal)) throw new ProposalError(`proposal root must be a JSON object: ${proposalPath}`);
  if (proposal.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new ProposalError(`unsupported proposal schema_version in ${proposalPath}: ${proposal.schema_version}`);
  }
  if (typeof proposal.proposal_id !== 'string' || proposal.proposal_id.trim() === '') {
    throw new ProposalError(`proposal_id is required in ${proposalPath}`);
  }
  if (typeof proposal.status !== 'string' || proposal.status.trim() === '') {
    throw new ProposalError(`status is required in ${proposalPath}`);
  }
  if (!isPlainObject(proposal.automation_boundary) || proposal.automation_boundary.allow_apply !== false) {
    throw new ProposalError(`proposal update only supports proposal-only artifacts with allow_apply=false: ${proposalPath}`);
  }
  if (proposal.automation_boundary.downstream_execution !== 'not-run') {
    throw new ProposalError(`proposal update only supports artifacts with downstream_execution=not-run: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.outcome) || proposal.outcome.status !== 'not_applied') {
    throw new ProposalError(`proposal update only supports artifacts with outcome.status=not_applied: ${proposalPath}`);
  }
}


function validateStatusFilter(status) {
  if (!REVIEW_STATUSES.has(status) && !RESERVED_STATUSES.has(status) && status !== 'invalid') {
    throw new ProposalError(`unsupported status filter: ${status}`);
  }
}


function validateRequestedStatus(status) {
  if (RESERVED_STATUSES.has(status)) {
    throw new ProposalError(`${status} is reserved for a future owner-apply flow and cannot be set by proposal review`);
  }
  if (!REVIEW_STATUSES.has(status)) {
    throw new ProposalError(`unsupported review status: ${status}`);
  }
}


function validateTransition(previousStatus, nextStatus) {
  if (previousStatus === nextStatus) return;
  if (TERMINAL_STATUSES.has(previousStatus)) {
    throw new ProposalError(`cannot transition terminal proposal status ${previousStatus} to ${nextStatus}`);
  }
  const allowed = STATUS_TRANSITIONS[previousStatus];
  if (!allowed) throw new ProposalError(`unknown current proposal status: ${previousStatus}`);
  if (!allowed.has(nextStatus)) {
    throw new ProposalError(`invalid proposal status transition: ${previousStatus} -> ${nextStatus}`);
  }
}


function proposalListEntry(record) {
  if (!record.valid) {
    return {
      status: 'invalid',
      valid: false,
      path: record.path,
      error: record.error,
    };
  }
  return {
    proposal_id: record.proposal.proposal_id || null,
    proposal_type: record.proposal.proposal_type || null,
    status: record.proposal.status || 'unknown',
    target_owner: record.proposal.target_owner || null,
    target_surface: record.proposal.target_surface || null,
    risk: record.proposal.risk || null,
    review_required: record.proposal.review_required ?? null,
    created_at: record.proposal.created_at || null,
    updated_at: record.proposal.updated_at || null,
    summary: record.proposal.summary || null,
    path: record.path,
    valid: true,
  };
}


function compareProposalRecords(left, right) {
  const leftCreated = left.created_at || '';
  const rightCreated = right.created_at || '';
  if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
  return left.path.localeCompare(right.path);
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}


function stringOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printListHuman(report) {
  console.log(`Noesis proposal list: ${report.status}`);
  console.log(`Proposal directory: ${report.proposal_dir}`);
  console.log(`Proposals: ${report.summary.proposal_count}`);
  for (const proposal of report.proposals) {
    if (proposal.valid === false) {
      console.log(`- invalid ${proposal.path}: ${proposal.error}`);
    } else {
      console.log(`- ${proposal.status} ${proposal.proposal_id} (${proposal.proposal_type}, owner=${proposal.target_owner})`);
    }
  }
}


function printShowHuman(report) {
  const proposal = report.proposal;
  console.log(`Noesis proposal show: ${proposal.status}`);
  console.log(`Proposal ID: ${proposal.proposal_id}`);
  console.log(`Type: ${proposal.proposal_type}`);
  console.log(`Owner: ${proposal.target_owner}`);
  console.log(`Path: ${report.proposal_path}`);
  console.log('Downstream execution: not run');
}


function printUpdateHuman(report) {
  console.log('Noesis proposal update: ok');
  console.log(`Proposal ID: ${report.proposal_id}`);
  console.log(`Status: ${report.previous_status} -> ${report.new_status}`);
  console.log(`Path: ${report.proposal_path}`);
  console.log('Downstream execution: not run');
}


export function printProposalUsage() {
  console.log(`Usage: noesis proposal <command> [args]

Commands:
  list                          List proposal artifacts in the local proposal queue.
  show <proposal-id-or-path>    Show one proposal artifact.
  update <proposal-id-or-path>  Update review metadata on one proposal artifact.
  help                          Show proposal command help.

Options:
  -h, --help                    Show this help message.

Examples:
  noesis proposal list --workspace /path/to/workspace
  noesis proposal show 2026-05-19T06-00-00Z__promote__01__eval_proposal --json
  noesis proposal update 2026-05-19T06-00-00Z__promote__01__eval_proposal --status approved --reviewer @Percy`);
}


export function printProposalCommandUsage(command) {
  if (command === 'list') {
    console.log(`Usage: noesis proposal list [--workspace <path>] [--dir <dir>] [--status <status>] [--json]

List proposal artifacts from .noesis/proposals.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --dir <dir>                   Proposal directory. Defaults to .noesis/proposals under the workspace.
  --status <status>             Optional status filter.
  --json                        Print machine-readable JSON.

The list command is read-only and does not apply owner changes.`);
    return;
  }
  if (command === 'show') {
    console.log(`Usage: noesis proposal show <proposal-id-or-path> [--workspace <path>] [--dir <dir>] [--json]

Show one proposal artifact by proposal_id or JSON file path.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --dir <dir>                   Proposal directory. Defaults to .noesis/proposals under the workspace.
  --json                        Print machine-readable JSON.

The show command is read-only and does not apply owner changes.`);
    return;
  }
  if (command === 'update') {
    console.log(`Usage: noesis proposal update <proposal-id-or-path> --status <status> [--reviewer <name>] [--note <text>] [--workspace <path>] [--dir <dir>] [--json]

Update review metadata on one proposal artifact.

Options:
  --status <status>             Review status: pending_review, approved, rejected, or superseded.
  --reviewer <name>             Optional reviewer label.
  --note <text>                 Optional compact review note.
  --workspace <path>            Workspace root. Defaults to the current directory.
  --dir <dir>                   Proposal directory. Defaults to .noesis/proposals under the workspace.
  --json                        Print machine-readable JSON.

The update command only writes the proposal artifact's review metadata. It does
not apply memory, wiki, skill, or eval changes. The applied status is reserved
for a future owner-apply flow.`);
    return;
  }
  throw new ProposalError(`unknown proposal command: ${command}`);
}
