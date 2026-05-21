import fs from 'node:fs';
import path from 'node:path';


export class OwnerHandoffError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');
const DEFAULT_HANDOFF_DIR = path.join('.noesis', 'owner-handoffs');
const KNOWN_OWNERS = new Set(['pamem', 'LoreForge', 'skill-manager', 'evals', 'Noesis']);
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
    throw new OwnerHandoffError(`unknown help topic: owner ${rest.join(' ')}`);
  }
  if (command !== 'handoff') {
    throw new OwnerHandoffError(`unknown owner command: ${command}`);
  }

  const args = parseOwnerHandoffArgs(rest);
  if (args.help) return 0;
  return runOwnerHandoff(args);
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


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new OwnerHandoffError(`missing value for ${option}`);
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


function validateProposal(proposal, proposalPath) {
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
  if (proposal.status !== 'approved') {
    throw new OwnerHandoffError(`owner handoff requires an approved proposal: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.automation_boundary) || proposal.automation_boundary.allow_apply !== false) {
    throw new OwnerHandoffError(`owner handoff only supports proposal-only artifacts with allow_apply=false: ${proposalPath}`);
  }
  if (proposal.automation_boundary.downstream_execution !== 'not-run') {
    throw new OwnerHandoffError(`owner handoff only supports artifacts with downstream_execution=not-run: ${proposalPath}`);
  }
  if (!isPlainObject(proposal.outcome) || proposal.outcome.status !== 'not_applied') {
    throw new OwnerHandoffError(`owner handoff requires outcome.status=not_applied: ${proposalPath}`);
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


export function printOwnerUsage() {
  console.log(`Usage: noesis owner <command> [args]

Commands:
  handoff <proposal-id-or-path>  Write an owner-lane handoff artifact.
  help                           Show owner command help.

Options:
  -h, --help                     Show this help message.

Examples:
  noesis owner handoff 2026-05-19T06-00-00Z__promote__01__memory_proposal --reviewer @Percy
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
