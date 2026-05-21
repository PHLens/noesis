import fs from 'node:fs';
import path from 'node:path';


export class OwnerHandoffError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');
const DEFAULT_HANDOFF_DIR = path.join('.noesis', 'owner-handoffs');
const KNOWN_OWNERS = new Set(['pamem', 'LoreForge', 'skill-manager', 'evals', 'Noesis']);
const OUTCOME_STATUSES = new Set(['owner_pending', 'materialized', 'merged', 'rejected', 'failed']);
const OUTCOME_REF_KINDS = new Set(['pr', 'draft', 'commit', 'report', 'url', 'handoff']);
const PROPOSAL_OWNER = {
  memory_proposal: 'pamem',
  wiki_proposal: 'LoreForge',
  skill_proposal: 'skill-manager',
  eval_proposal: 'evals',
  compression_proposal: 'Noesis',
};
const OWNER_ACTIONS = {
  pamem: {
    kind: 'memory_owner_review',
    expected_owner: 'pamem',
    suggested_command: 'pamem check <handoff.artifact.proposal_path> --workspace <workspace> --json',
    suggested_artifact: 'memory-owner-review',
  },
  LoreForge: {
    kind: 'wiki_owner_review',
    expected_owner: 'LoreForge',
    suggested_command: 'loreforge validate --json',
    suggested_artifact: 'wiki-owner-review',
  },
  'skill-manager': {
    kind: 'skill_owner_review',
    expected_owner: 'skill-manager',
    suggested_command: 'noesis skill verify --workspace <workspace> --json',
    suggested_artifact: 'skill-owner-review',
  },
  evals: {
    kind: 'eval_owner_review',
    expected_owner: 'evals',
    suggested_command: 'noesis eval handoff <proposal-id-or-path> --json',
    suggested_artifact: 'eval-owner-review',
  },
  Noesis: {
    kind: 'noesis_owner_review',
    expected_owner: 'Noesis',
    suggested_command: 'noesis proposal show <proposal-id-or-path> --json',
    suggested_artifact: 'noesis-owner-review',
  },
};


export function runOwnerCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printOwnerUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printOwnerUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'handoff') {
      printOwnerHandoffUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'outcome') {
      printOwnerOutcomeUsage();
      return 0;
    }
    throw new OwnerHandoffError(`unknown help topic: owner ${rest.join(' ')}`);
  }
  if (!['handoff', 'outcome'].includes(command)) {
    throw new OwnerHandoffError(`unknown owner command: ${command}`);
  }

  const args = command === 'handoff'
    ? parseOwnerHandoffArgs(rest)
    : parseOwnerOutcomeArgs(rest);
  if (args.help) return 0;
  if (command === 'handoff') return runOwnerHandoff(args);
  return runOwnerOutcome(args);
}


function runOwnerHandoff(args) {
  const proposalDir = resolveDir(args.workspace, args.proposalDir);
  const handoffRoot = resolveDir(args.workspace, args.out);
  const record = resolveProposalRecord(proposalDir, args.selector);
  if (!record.valid) {
    throw new OwnerHandoffError(`proposal is not a valid JSON artifact: ${record.path}: ${record.error}`);
  }
  if (!isPathInside(record.path, proposalDir)) {
    throw new OwnerHandoffError(`owner handoff is limited to the proposal queue directory: ${proposalDir}`);
  }
  validateProposal(record.proposal, record.path);

  const handoff = buildHandoff(record, args);
  const handoffDir = path.join(handoffRoot, sanitizePathSegment(handoff.target_owner), 'pending');
  const handoffPath = path.join(handoffDir, `${sanitizeId(handoff.handoff_id)}.json`);
  if (fs.existsSync(handoffPath) && !args.force) {
    throw new OwnerHandoffError(`owner handoff already exists: ${handoffPath}; use --force to overwrite`);
  }
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(handoffPath, `${JSON.stringify({ ...handoff, handoff_path: handoffPath }, null, 2)}\n`);

  const envelope = {
    command: 'owner handoff',
    status: 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    handoff_root: handoffRoot,
    proposal_path: record.path,
    handoff_path: handoffPath,
    proposal_id: record.proposal.proposal_id,
    handoff_id: handoff.handoff_id,
    target_owner: handoff.target_owner,
    downstream_execution: 'not-run',
    writes: [handoffPath],
    handoff: { ...handoff, handoff_path: handoffPath },
  };
  if (args.json) printJson(envelope);
  else printHandoffHuman(envelope);
  return 0;
}


function runOwnerOutcome(args) {
  const proposalDir = resolveDir(args.workspace, args.proposalDir);
  const handoffRoot = resolveDir(args.workspace, args.handoffRoot);
  const record = resolveProposalRecord(proposalDir, args.selector);
  if (!record.valid) {
    throw new OwnerHandoffError(`proposal is not a valid JSON artifact: ${record.path}: ${record.error}`);
  }
  if (!isPathInside(record.path, proposalDir)) {
    throw new OwnerHandoffError(`owner outcome is limited to the proposal queue directory: ${proposalDir}`);
  }
  validateProposalForOutcome(record.proposal, record.path);

  const handoffPath = resolveHandoffPath(record.proposal, handoffRoot, args.handoff);
  validateHandoffForOutcome(record.proposal, handoffPath);

  const proposal = record.proposal;
  const previousOutcome = isPlainObject(proposal.outcome) ? proposal.outcome : null;
  const now = new Date().toISOString();
  const refs = [
    { kind: 'handoff', ref: handoffPath },
    ...args.refs,
  ];
  const outcome = {
    status: args.status,
    recorded_at: now,
    recorded_by: args.reviewer || null,
    target_owner: proposal.target_owner,
    handoff_path: handoffPath,
    refs,
    note: args.note || null,
    downstream_execution: 'not-run',
    applied_by: args.status === 'merged' ? (args.owner || proposal.target_owner) : null,
    applied_at: args.status === 'merged' ? now : null,
  };
  proposal.outcome = outcome;
  proposal.updated_at = now;
  if (!Array.isArray(proposal.outcome_history)) proposal.outcome_history = [];
  proposal.outcome_history.push({
    recorded_at: now,
    previous_status: previousOutcome && previousOutcome.status ? previousOutcome.status : null,
    status: args.status,
    recorded_by: args.reviewer || null,
    target_owner: proposal.target_owner,
    handoff_path: handoffPath,
    refs,
    note: args.note || null,
    command: 'noesis owner outcome',
  });

  fs.writeFileSync(record.path, `${JSON.stringify(proposal, null, 2)}\n`);

  const envelope = {
    command: 'owner outcome',
    status: 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_dir: proposalDir,
    handoff_root: handoffRoot,
    proposal_path: record.path,
    handoff_path: handoffPath,
    proposal_id: proposal.proposal_id,
    target_owner: proposal.target_owner,
    outcome_status: args.status,
    downstream_execution: 'not-run',
    writes: [record.path],
    outcome,
    proposal,
  };
  if (args.json) printJson(envelope);
  else printOutcomeHuman(envelope);
  return 0;
}


function parseOwnerHandoffArgs(tokens) {
  const args = {
    workspace: null,
    proposalDir: DEFAULT_PROPOSAL_DIR,
    out: DEFAULT_HANDOFF_DIR,
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
      printOwnerHandoffUsage();
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
      throw new OwnerHandoffError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (positionals.length !== 1) {
    throw new OwnerHandoffError('usage: noesis owner handoff <proposal-id-or-path>');
  }
  args.selector = positionals[0];
  return args;
}


function parseOwnerOutcomeArgs(tokens) {
  const args = {
    workspace: null,
    proposalDir: DEFAULT_PROPOSAL_DIR,
    handoffRoot: DEFAULT_HANDOFF_DIR,
    handoff: null,
    status: null,
    refs: [],
    owner: null,
    reviewer: null,
    note: null,
    json: false,
    selector: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printOwnerOutcomeUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--proposal-dir') {
      args.proposalDir = requireValue(tokens, ++index, '--proposal-dir');
    } else if (token.startsWith('--proposal-dir=')) {
      args.proposalDir = token.slice('--proposal-dir='.length);
    } else if (token === '--handoff-root') {
      args.handoffRoot = requireValue(tokens, ++index, '--handoff-root');
    } else if (token.startsWith('--handoff-root=')) {
      args.handoffRoot = token.slice('--handoff-root='.length);
    } else if (token === '--handoff') {
      args.handoff = requireValue(tokens, ++index, '--handoff');
    } else if (token.startsWith('--handoff=')) {
      args.handoff = token.slice('--handoff='.length);
    } else if (token === '--status') {
      args.status = requireValue(tokens, ++index, '--status');
    } else if (token.startsWith('--status=')) {
      args.status = token.slice('--status='.length);
    } else if (token === '--ref') {
      args.refs.push(parseOutcomeRef(requireValue(tokens, ++index, '--ref')));
    } else if (token.startsWith('--ref=')) {
      args.refs.push(parseOutcomeRef(token.slice('--ref='.length)));
    } else if (token === '--owner') {
      args.owner = requireValue(tokens, ++index, '--owner');
    } else if (token.startsWith('--owner=')) {
      args.owner = token.slice('--owner='.length);
    } else if (token === '--reviewer') {
      args.reviewer = requireValue(tokens, ++index, '--reviewer');
    } else if (token.startsWith('--reviewer=')) {
      args.reviewer = token.slice('--reviewer='.length);
    } else if (token === '--note') {
      args.note = requireValue(tokens, ++index, '--note');
    } else if (token.startsWith('--note=')) {
      args.note = token.slice('--note='.length);
    } else if (token.startsWith('-')) {
      throw new OwnerHandoffError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (positionals.length !== 1) {
    throw new OwnerHandoffError('usage: noesis owner outcome <proposal-id-or-path>');
  }
  if (!OUTCOME_STATUSES.has(args.status)) {
    throw new OwnerHandoffError(`--status must be one of: ${Array.from(OUTCOME_STATUSES).join(', ')}`);
  }
  if (args.refs.length === 0) {
    throw new OwnerHandoffError('owner outcome requires at least one --ref <kind>:<value>');
  }
  args.selector = positionals[0];
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new OwnerHandoffError(`missing value for ${option}`);
  }
  return value;
}


function parseOutcomeRef(value) {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new OwnerHandoffError('--ref must use <kind>:<value>');
  }
  const kind = value.slice(0, separator);
  const ref = value.slice(separator + 1);
  if (!OUTCOME_REF_KINDS.has(kind)) {
    throw new OwnerHandoffError(`unsupported owner outcome ref kind: ${kind}`);
  }
  return { kind, ref };
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
    throw new OwnerHandoffError(`proposal not found: ${selector}`);
  }
  if (matches.length > 1) {
    throw new OwnerHandoffError(`proposal id is ambiguous: ${selector}`);
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
  if (!stat.isDirectory()) throw new OwnerHandoffError(`proposal directory is not a directory: ${proposalDir}`);
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


function validateProposal(proposal, proposalPath, options = {}) {
  const requireNotApplied = options.requireNotApplied !== false;
  if (!isPlainObject(proposal)) throw new OwnerHandoffError(`proposal root must be a JSON object: ${proposalPath}`);
  if (proposal.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new OwnerHandoffError(`unsupported proposal schema_version in ${proposalPath}: ${proposal.schema_version}`);
  }
  if (typeof proposal.proposal_id !== 'string' || proposal.proposal_id.trim() === '') {
    throw new OwnerHandoffError(`proposal_id is required in ${proposalPath}`);
  }
  if (typeof proposal.proposal_type !== 'string' || proposal.proposal_type.trim() === '') {
    throw new OwnerHandoffError(`proposal_type is required in ${proposalPath}`);
  }
  if (proposal.proposal_type === 'noop') {
    throw new OwnerHandoffError(`owner handoff does not support noop proposals: ${proposalPath}`);
  }
  if (!KNOWN_OWNERS.has(proposal.target_owner)) {
    throw new OwnerHandoffError(`owner handoff requires a known target_owner in ${proposalPath}: ${proposal.target_owner}`);
  }
  if (PROPOSAL_OWNER[proposal.proposal_type] !== proposal.target_owner) {
    throw new OwnerHandoffError(`owner handoff target mismatch in ${proposalPath}: ${proposal.proposal_type} requires target_owner=${PROPOSAL_OWNER[proposal.proposal_type] || 'unknown'}, got ${proposal.target_owner}`);
  }
  if (proposal.status !== 'approved') {
    throw new OwnerHandoffError(`owner handoff requires an approved proposal: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.automation_boundary) || proposal.automation_boundary.allow_apply !== false) {
    throw new OwnerHandoffError(`owner handoff only supports proposal-only artifacts with allow_apply=false: ${proposalPath}`);
  }
  if (proposal.automation_boundary.downstream_execution !== 'not-run') {
    throw new OwnerHandoffError(`owner handoff only supports artifacts with downstream_execution=not-run: ${proposalPath}`);
  }
  if (requireNotApplied && (!isPlainObject(proposal.outcome) || proposal.outcome.status !== 'not_applied')) {
    throw new OwnerHandoffError(`owner handoff requires outcome.status=not_applied: ${proposalPath}`);
  }
}


function validateProposalForOutcome(proposal, proposalPath) {
  validateProposal(proposal, proposalPath, { requireNotApplied: false });
  if (!isPlainObject(proposal.outcome) || proposal.outcome.status !== 'not_applied') {
    throw new OwnerHandoffError(`owner outcome can only be recorded once while outcome.status=not_applied: ${proposalPath}`);
  }
}


function resolveHandoffPath(proposal, handoffRoot, explicitPath) {
  if (explicitPath) return path.isAbsolute(explicitPath) ? path.resolve(explicitPath) : path.resolve(explicitPath);
  const handoffId = `${proposal.proposal_id}__owner_handoff`;
  return path.join(handoffRoot, sanitizePathSegment(proposal.target_owner), 'pending', `${sanitizeId(handoffId)}.json`);
}


function validateHandoffForOutcome(proposal, handoffPath) {
  if (!fs.existsSync(handoffPath)) {
    throw new OwnerHandoffError(`owner outcome requires an existing owner handoff artifact: ${handoffPath}`);
  }
  let handoff;
  try {
    handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  } catch (error) {
    throw new OwnerHandoffError(`owner handoff is not valid JSON: ${handoffPath}: ${error.message}`);
  }
  if (!isPlainObject(handoff)) {
    throw new OwnerHandoffError(`owner handoff root must be a JSON object: ${handoffPath}`);
  }
  if (handoff.proposal_id !== proposal.proposal_id) {
    throw new OwnerHandoffError(`owner handoff proposal mismatch: expected ${proposal.proposal_id}, got ${handoff.proposal_id}`);
  }
  if (handoff.target_owner !== proposal.target_owner) {
    throw new OwnerHandoffError(`owner handoff owner mismatch: expected ${proposal.target_owner}, got ${handoff.target_owner}`);
  }
  if (handoff.status !== 'pending_owner_action') {
    throw new OwnerHandoffError(`owner handoff must be pending_owner_action before recording outcome: ${handoffPath}`);
  }
  if (!isPlainObject(handoff.automation_boundary) || handoff.automation_boundary.allow_apply !== false || handoff.automation_boundary.downstream_execution !== 'not-run') {
    throw new OwnerHandoffError(`owner handoff must preserve allow_apply=false and downstream_execution=not-run: ${handoffPath}`);
  }
}


function buildHandoff(record, args) {
  const proposal = record.proposal;
  const now = new Date().toISOString();
  const handoffId = `${proposal.proposal_id}__owner_handoff`;
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
    owner_action: ownerActionForProposal(proposal),
    artifact: {
      kind: 'owner_handoff',
      proposal_id: proposal.proposal_id,
      proposal_path: record.path,
      proposal_type: proposal.proposal_type,
      target_owner: proposal.target_owner,
      target_surface: proposal.target_surface,
      requested_output: proposal.requested_output || null,
      source_refs: Array.isArray(proposal.source_refs) ? proposal.source_refs : [],
      candidate_items: Array.isArray(proposal.candidate_items) ? proposal.candidate_items : [],
      acceptance_checks: Array.isArray(proposal.acceptance_checks) ? proposal.acceptance_checks : [],
    },
    reviewer: args.reviewer || null,
    note: args.note || null,
    automation_boundary: {
      mode: 'owner_handoff',
      allow_apply: false,
      downstream_execution: 'not-run',
      owner_apply_required: true,
    },
    writes: [],
  };
}


function ownerActionForProposal(proposal) {
  const template = OWNER_ACTIONS[proposal.target_owner] || OWNER_ACTIONS.Noesis;
  return {
    ...template,
    proposal_type: proposal.proposal_type,
    target_surface: proposal.target_surface,
    required_review: true,
    downstream_execution: 'not-run',
  };
}


function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}


function sanitizePathSegment(value) {
  return sanitizeId(value).replaceAll('.', '-');
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
  console.log('Noesis owner handoff: ok');
  console.log(`Proposal ID: ${envelope.proposal_id}`);
  console.log(`Target owner: ${envelope.target_owner}`);
  console.log(`Handoff ID: ${envelope.handoff_id}`);
  console.log(`Handoff: ${envelope.handoff_path}`);
  console.log('Downstream execution: not run');
}


function printOutcomeHuman(envelope) {
  console.log('Noesis owner outcome: ok');
  console.log(`Proposal ID: ${envelope.proposal_id}`);
  console.log(`Target owner: ${envelope.target_owner}`);
  console.log(`Outcome: ${envelope.outcome_status}`);
  console.log(`Proposal: ${envelope.proposal_path}`);
  console.log('Downstream execution: not run');
}


export function printOwnerUsage() {
  console.log(`Usage: noesis owner <command> [args]

Commands:
  handoff <proposal-id-or-path>  Write an owner-lane handoff artifact.
  outcome <proposal-id-or-path>  Record owner outcome refs on a proposal.
  help                           Show owner command help.

Options:
  -h, --help                     Show this help message.

Examples:
  noesis owner handoff 2026-05-19T06-00-00Z__promote__01__memory_proposal --reviewer @Percy
  noesis owner outcome 2026-05-19T06-00-00Z__promote__01__memory_proposal --status owner_pending --ref pr:https://github.com/org/repo/pull/1
  noesis owner handoff .noesis/proposals/proposal.json --json`);
}


export function printOwnerHandoffUsage() {
  console.log(`Usage: noesis owner handoff <proposal-id-or-path> [--workspace <path>] [--proposal-dir <dir>] [--out <dir>] [--reviewer <name>] [--note <text>] [--force] [--json]

Write a generic owner-lane handoff artifact for an approved proposal.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --proposal-dir <dir>          Proposal directory. Defaults to .noesis/proposals under the workspace.
  --out <dir>                   Handoff root. Defaults to .noesis/owner-handoffs.
  --reviewer <name>             Optional reviewer label.
  --note <text>                 Optional compact handoff note.
  --force                       Overwrite an existing handoff artifact.
  --json                        Print machine-readable JSON.

The handoff command writes a Noesis-owned artifact only. It does not call owner
commands, mutate proposals, apply memory/wiki/skill/eval changes, or mark the
proposal applied.`);
}


export function printOwnerOutcomeUsage() {
  console.log(`Usage: noesis owner outcome <proposal-id-or-path> --status <status> --ref <kind>:<value> [--ref <kind>:<value>...] [--workspace <path>] [--proposal-dir <dir>] [--handoff-root <dir>] [--handoff <path>] [--reviewer <name>] [--note <text>] [--json]

Record owner-side outcome references on an approved, handed-off proposal.

Options:
  --status <status>             owner_pending, materialized, merged, rejected, or failed.
  --ref <kind>:<value>          Owner reference. Kinds: pr, draft, commit, report, url, handoff.
  --workspace <path>            Workspace root. Defaults to the current directory.
  --proposal-dir <dir>          Proposal directory. Defaults to .noesis/proposals under the workspace.
  --handoff-root <dir>          Handoff root. Defaults to .noesis/owner-handoffs.
  --handoff <path>              Explicit handoff artifact path. Defaults to the matching pending handoff.
  --reviewer <name>             Optional recorder label.
  --note <text>                 Optional compact outcome note.
  --json                        Print machine-readable JSON.

The outcome command writes only the proposal artifact's outcome record. It does
not call owner commands, apply memory/wiki/skill/eval changes, or create owner
PRs, drafts, commits, or reports.`);
}
