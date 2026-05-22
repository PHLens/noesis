import fs from 'node:fs';
import path from 'node:path';


export class CompressionError extends Error {}


const SUPPORTED_SCHEMA_VERSION = '0.1';
const DEFAULT_EVENT_DIR = path.join('.noesis', 'events');
const DEFAULT_PROPOSAL_DIR = path.join('.noesis', 'proposals');
const CANDIDATE_TARGET_OWNER = {
  memory: 'pamem',
  wiki: 'LoreForge',
  skill: 'skill-manager',
  eval: 'evals',
  compression: 'Noesis',
  mixed: 'Noesis',
  noop: 'none',
  unknown: 'unknown',
};
const PROPOSAL_TARGET_OWNER = {
  memory_proposal: 'pamem',
  wiki_proposal: 'LoreForge',
  skill_proposal: 'skill-manager',
  eval_proposal: 'evals',
  compression_proposal: 'Noesis',
  noop_proposal: 'none',
};
const OWNER_TARGET_SURFACE = {
  pamem: 'pamem',
  LoreForge: 'loreforge',
  'skill-manager': 'skill-manager',
  evals: 'evals',
  Noesis: 'noesis',
  none: 'none',
  unknown: 'unknown',
};
const RISK_RANK = {
  low: 1,
  medium: 2,
  high: 3,
};


export function runCompressionCommand(tokens) {
  const [command, ...rest] = tokens;
  if (!command || command === '-h' || command === '--help') {
    printCompressionUsage();
    return 0;
  }
  if (command === 'help') {
    if (rest.length === 0) {
      printCompressionUsage();
      return 0;
    }
    if (rest.length === 1 && rest[0] === 'summary') {
      printCompressionSummaryUsage();
      return 0;
    }
    throw new CompressionError(`unknown help topic: compression ${rest.join(' ')}`);
  }
  if (command !== 'summary') {
    throw new CompressionError(`unknown compression command: ${command}`);
  }

  const args = parseSummaryArgs(rest);
  if (args.help) return 0;
  return runCompressionSummary(args);
}


function runCompressionSummary(args) {
  const report = createCompressionSummaryReport(args);
  if (args.json) printJson(report);
  else printSummaryHuman(report);
  return 0;
}


export function createCompressionSummaryReport(args) {
  const workspace = args.workspace ? path.resolve(args.workspace) : process.cwd();
  const eventDir = resolveDir(args.eventDir, workspace);
  const proposalDir = resolveDir(args.proposalDir, workspace);
  const now = new Date();
  const eventRecords = listArtifactRecords(eventDir, 'learning_event');
  const proposalRecords = listArtifactRecords(proposalDir, 'proposal');
  const warnings = [
    ...validationWarnings(eventRecords, 'event'),
    ...validationWarnings(proposalRecords, 'proposal'),
  ];
  const validEvents = eventRecords.filter((record) => record.valid);
  const validProposals = proposalRecords.filter((record) => record.valid);
  const stale = buildStaleProposalCandidates(validProposals, { now, staleDays: args.staleDays });
  warnings.push(...stale.warnings);

  const candidates = [
    ...buildRepeatedEventCandidates(validEvents, args.minGroupSize),
    ...buildRepeatedProposalCandidates(validProposals, args.minGroupSize),
    ...stale.candidates,
  ].sort(compareCandidates);

  const warningCount = warnings.filter((warning) => warning.severity === 'warning').length;
  const errorCount = warnings.filter((warning) => warning.severity === 'error').length;
  const repeatedEventCount = candidates.filter((candidate) => candidate.kind === 'repeated_events').length;
  const repeatedProposalCount = candidates.filter((candidate) => candidate.kind === 'repeated_proposals').length;
  const staleProposalCount = candidates.filter((candidate) => candidate.kind === 'stale_proposals').length;
  const summary = {
    event_count: eventRecords.length,
    proposal_count: proposalRecords.length,
    valid_event_count: validEvents.length,
    valid_proposal_count: validProposals.length,
    invalid_count: eventRecords.filter((record) => !record.valid).length
      + proposalRecords.filter((record) => !record.valid).length,
    candidate_count: candidates.length,
    repeated_event_candidate_count: repeatedEventCount,
    repeated_proposal_candidate_count: repeatedProposalCount,
    stale_proposal_candidate_count: staleProposalCount,
    stale_proposal_count: stale.sourceCount,
    by_candidate_kind: countBy(candidates, (candidate) => candidate.kind),
    by_artifact_target_owner: countBy(candidates, (candidate) => candidate.artifact_target_owner || 'unknown'),
    by_artifact_target_surface: countBy(candidates, (candidate) => candidate.artifact_target_surface || 'unknown'),
    warning_count: warningCount,
    error_count: errorCount,
  };

  return {
    command: 'compression summary',
    status: candidates.length > 0 || warnings.length > 0 ? 'warning' : 'ok',
    schema_version: SUPPORTED_SCHEMA_VERSION,
    workspace,
    event_dir: eventDir,
    proposal_dir: proposalDir,
    generated_at: now.toISOString(),
    thresholds: {
      min_group_size: args.minGroupSize,
      stale_after_days: args.staleDays,
    },
    summary,
    downstream_execution: 'not-run',
    writes: [],
    warnings,
    candidates,
  };
}


function parseSummaryArgs(tokens) {
  const args = {
    workspace: null,
    eventDir: DEFAULT_EVENT_DIR,
    proposalDir: DEFAULT_PROPOSAL_DIR,
    minGroupSize: 2,
    staleDays: 30,
    json: false,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printCompressionSummaryUsage();
      return { help: true };
    }
    if (token === '--json') {
      args.json = true;
    } else if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--event-dir') {
      args.eventDir = requireValue(tokens, ++index, '--event-dir');
    } else if (token.startsWith('--event-dir=')) {
      args.eventDir = token.slice('--event-dir='.length);
    } else if (token === '--proposal-dir') {
      args.proposalDir = requireValue(tokens, ++index, '--proposal-dir');
    } else if (token.startsWith('--proposal-dir=')) {
      args.proposalDir = token.slice('--proposal-dir='.length);
    } else if (token === '--min-group-size') {
      args.minGroupSize = parsePositiveInteger(requireValue(tokens, ++index, '--min-group-size'), '--min-group-size');
    } else if (token.startsWith('--min-group-size=')) {
      args.minGroupSize = parsePositiveInteger(token.slice('--min-group-size='.length), '--min-group-size');
    } else if (token === '--stale-days') {
      args.staleDays = parseNonNegativeNumber(requireValue(tokens, ++index, '--stale-days'), '--stale-days');
    } else if (token.startsWith('--stale-days=')) {
      args.staleDays = parseNonNegativeNumber(token.slice('--stale-days='.length), '--stale-days');
    } else if (token.startsWith('-')) {
      throw new CompressionError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 0) {
    throw new CompressionError('usage: noesis compression summary');
  }
  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new CompressionError(`missing value for ${option}`);
  }
  return value;
}


function parsePositiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CompressionError(`${option} must be a positive integer`);
  }
  return number;
}


function parseNonNegativeNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new CompressionError(`${option} must be a non-negative number`);
  }
  return number;
}


function resolveDir(dir, workspace) {
  if (path.isAbsolute(dir)) return path.resolve(dir);
  return path.resolve(workspace, dir);
}


function listArtifactRecords(dir, artifactType) {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new CompressionError(`${artifactType} directory is not a directory: ${dir}`);
  }
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readArtifactRecord(path.join(dir, entry), artifactType))
    .sort(compareRecords);
}


function readArtifactRecord(artifactPath, artifactType) {
  let text;
  try {
    text = fs.readFileSync(artifactPath, 'utf8');
  } catch (error) {
    return invalidRecord(artifactPath, artifactType, `read failed: ${error.message}`);
  }
  try {
    const artifact = JSON.parse(text);
    if (!isPlainObject(artifact)) {
      return invalidRecord(artifactPath, artifactType, `${artifactType} root must be a JSON object`);
    }
    if (artifactType === 'learning_event') return eventRecord(artifactPath, artifact);
    return proposalRecord(artifactPath, artifact);
  } catch (error) {
    return invalidRecord(artifactPath, artifactType, `parse failed: ${error.message}`);
  }
}


function invalidRecord(artifactPath, artifactType, error) {
  return {
    artifact_type: artifactType,
    path: artifactPath,
    valid: false,
    error,
    id: null,
    created_at: null,
  };
}


function eventRecord(artifactPath, event) {
  const hint = Array.isArray(event.routing_hints)
    ? event.routing_hints.find((item) => isPlainObject(item)) || {}
    : {};
  const candidateKind = stringOrUnknown(hint.candidate_kind);
  const targetOwner = CANDIDATE_TARGET_OWNER[candidateKind] || 'unknown';
  return {
    artifact_type: 'learning_event',
    path: artifactPath,
    valid: true,
    artifact: event,
    id: stringOrNull(event.event_id),
    summary: summaryText(event),
    created_at: stringOrNull(event.created_at),
    schema_version: event.schema_version,
    event_kind: stringOrUnknown(event.kind),
    candidate_kind: candidateKind,
    artifact_target_owner: targetOwner,
    artifact_target_surface: stringOrNull(hint.target_surface) || OWNER_TARGET_SURFACE[targetOwner] || 'unknown',
    risk: event.impact && stringOrNull(event.impact.severity) ? event.impact.severity : 'unknown',
    normalized_summary: normalizeText(summaryText(event)),
  };
}


function proposalRecord(artifactPath, proposal) {
  const proposalType = stringOrUnknown(proposal.proposal_type);
  const targetOwner = stringOrNull(proposal.target_owner) || PROPOSAL_TARGET_OWNER[proposalType] || 'unknown';
  return {
    artifact_type: 'proposal',
    path: artifactPath,
    valid: true,
    artifact: proposal,
    id: stringOrNull(proposal.proposal_id),
    summary: summaryText(proposal),
    created_at: stringOrNull(proposal.created_at),
    updated_at: stringOrNull(proposal.updated_at),
    schema_version: proposal.schema_version,
    proposal_type: proposalType,
    status: stringOrUnknown(proposal.status),
    artifact_target_owner: targetOwner,
    artifact_target_surface: stringOrNull(proposal.target_surface) || OWNER_TARGET_SURFACE[targetOwner] || 'unknown',
    risk: stringOrNull(proposal.risk) || 'unknown',
    normalized_summary: normalizeText(summaryText(proposal)),
  };
}


function validationWarnings(records, label) {
  const warnings = [];
  for (const record of records) {
    if (!record.valid) {
      warnings.push({
        severity: 'error',
        code: `invalid_${label}_artifact`,
        artifact_type: record.artifact_type,
        id: record.id,
        path: record.path,
        message: `${label} artifact is not valid JSON: ${record.error}`,
      });
      continue;
    }
    if (record.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      warnings.push({
        severity: 'warning',
        code: `unsupported_${label}_schema_version`,
        artifact_type: record.artifact_type,
        id: record.id,
        path: record.path,
        message: `Unsupported ${label} schema_version: ${record.schema_version}`,
      });
    }
    if (!record.normalized_summary) {
      warnings.push({
        severity: 'warning',
        code: `missing_${label}_summary`,
        artifact_type: record.artifact_type,
        id: record.id,
        path: record.path,
        message: `${label} artifact has no compact summary to group for compression.`,
      });
    }
  }
  return warnings;
}


function buildRepeatedEventCandidates(records, minGroupSize) {
  const groups = groupRecords(records.filter((record) => record.normalized_summary), (record) => [
    record.candidate_kind,
    record.artifact_target_owner,
    record.artifact_target_surface,
    record.normalized_summary,
  ]);
  return Array.from(groups.values())
    .filter((group) => group.records.length >= minGroupSize)
    .map((group) => repeatedEventCandidate(group));
}


function buildRepeatedProposalCandidates(records, minGroupSize) {
  const groups = groupRecords(records.filter((record) => record.normalized_summary), (record) => [
    record.proposal_type,
    record.artifact_target_owner,
    record.artifact_target_surface,
    record.normalized_summary,
  ]);
  return Array.from(groups.values())
    .filter((group) => group.records.length >= minGroupSize)
    .map((group) => repeatedProposalCandidate(group));
}


function buildStaleProposalCandidates(records, { now, staleDays }) {
  const warnings = [];
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const staleRecords = [];
  for (const record of records) {
    if (record.status !== 'pending_review') continue;
    const createdAt = parseDate(record.created_at);
    if (!createdAt) {
      warnings.push({
        severity: 'warning',
        code: 'invalid_proposal_created_at',
        artifact_type: record.artifact_type,
        id: record.id,
        path: record.path,
        message: `Pending proposal created_at is invalid: ${record.created_at}`,
      });
      continue;
    }
    if (now.getTime() - createdAt.getTime() > staleMs) {
      staleRecords.push({ ...record, age_days: ageDays(now, createdAt) });
    }
  }
  const groups = groupRecords(staleRecords, (record) => [
    record.proposal_type,
    record.artifact_target_owner,
    record.artifact_target_surface,
  ]);
  const candidates = Array.from(groups.values()).map((group) => staleProposalCandidate(group));
  return { candidates, warnings, sourceCount: staleRecords.length };
}


function repeatedEventCandidate(group) {
  const { records } = group;
  const first = records[0];
  return compressionCandidate({
    kind: 'repeated_events',
    key: group.key,
    artifactType: 'learning_event',
    artifactTargetOwner: first.artifact_target_owner,
    artifactTargetSurface: first.artifact_target_surface,
    risk: maxRisk(records),
    sourceCount: records.length,
    summary: `${records.length} similar learning events target ${first.artifact_target_surface}: ${displaySummary(first.summary)}`,
    rationale: 'Multiple learning events share the same route and summary. Review whether they should be consolidated into one maintained owner artifact.',
    suggestedAction: 'consolidate_repeated_learning_events',
    records,
  });
}


function repeatedProposalCandidate(group) {
  const { records } = group;
  const first = records[0];
  return compressionCandidate({
    kind: 'repeated_proposals',
    key: group.key,
    artifactType: 'proposal',
    artifactTargetOwner: first.artifact_target_owner,
    artifactTargetSurface: first.artifact_target_surface,
    proposalType: first.proposal_type,
    risk: maxRisk(records),
    sourceCount: records.length,
    summary: `${records.length} similar ${first.proposal_type} artifacts target ${first.artifact_target_owner}: ${displaySummary(first.summary)}`,
    rationale: 'Multiple proposals repeat the same owner lane and summary. Review whether the queue should be compressed into a stable update or superseded proposal set.',
    suggestedAction: 'consolidate_repeated_proposals',
    records,
  });
}


function staleProposalCandidate(group) {
  const { records } = group;
  const first = records[0];
  return compressionCandidate({
    kind: 'stale_proposals',
    key: group.key,
    artifactType: 'proposal',
    artifactTargetOwner: first.artifact_target_owner,
    artifactTargetSurface: first.artifact_target_surface,
    proposalType: first.proposal_type,
    risk: maxRisk(records),
    sourceCount: records.length,
    summary: `${records.length} stale pending ${first.proposal_type} proposal(s) target ${first.artifact_target_owner}`,
    rationale: 'Pending proposals past the stale threshold should be reviewed for rejection, supersession, or consolidation before owner handoff.',
    suggestedAction: 'review_stale_proposals_for_reject_or_supersede',
    records,
    stale_age_days: {
      min: Math.min(...records.map((record) => record.age_days)),
      max: Math.max(...records.map((record) => record.age_days)),
    },
  });
}


function compressionCandidate({
  kind,
  key,
  artifactType,
  artifactTargetOwner,
  artifactTargetSurface,
  proposalType = null,
  risk,
  sourceCount,
  summary,
  rationale,
  suggestedAction,
  records,
  stale_age_days: staleAgeDays = null,
}) {
  const candidate = {
    candidate_id: `compression__${kind}__${sanitizeId(key).slice(0, 120)}`,
    kind,
    status: 'candidate',
    artifact_type: artifactType,
    artifact_target_owner: artifactTargetOwner,
    artifact_target_surface: artifactTargetSurface,
    proposal_type: proposalType,
    source_count: sourceCount,
    risk,
    summary,
    rationale,
    suggested_action: suggestedAction,
    suggested_proposal_type: 'compression_proposal',
    suggested_target_owner: 'Noesis',
    suggested_target_surface: 'noesis',
    automation_boundary: {
      allow_apply: false,
      downstream_execution: 'not-run',
    },
    downstream_execution: 'not-run',
    source_refs: records.map((record) => sourceRef(record)),
    artifacts: records.map((record) => artifactEntry(record)),
  };
  if (staleAgeDays) candidate.stale_age_days = staleAgeDays;
  return candidate;
}


function groupRecords(records, keyPartsForRecord) {
  const groups = new Map();
  for (const record of records) {
    const key = keyPartsForRecord(record).map((part) => String(part || 'unknown')).join('__');
    if (!groups.has(key)) groups.set(key, { key, records: [] });
    groups.get(key).records.push(record);
  }
  return groups;
}


function sourceRef(record) {
  return {
    kind: 'file',
    ref: record.path,
    summary: displaySummary(record.summary || record.id || path.basename(record.path)),
  };
}


function artifactEntry(record) {
  const entry = {
    artifact_type: record.artifact_type,
    id: record.id,
    path: record.path,
    summary: record.summary || null,
    created_at: record.created_at || null,
    artifact_target_owner: record.artifact_target_owner || null,
    artifact_target_surface: record.artifact_target_surface || null,
    risk: record.risk || null,
  };
  if (record.artifact_type === 'learning_event') {
    entry.event_kind = record.event_kind;
    entry.candidate_kind = record.candidate_kind;
  } else {
    entry.proposal_type = record.proposal_type;
    entry.status = record.status;
    entry.updated_at = record.updated_at || null;
  }
  return entry;
}


function summaryText(artifact) {
  if (stringOrNull(artifact.summary)) return artifact.summary.trim();
  if (isPlainObject(artifact.case)) {
    return stringOrNull(artifact.case.desired)
      || stringOrNull(artifact.case.observed)
      || stringOrNull(artifact.case.situation)
      || '';
  }
  return '';
}


function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}


function displaySummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137)}...`;
}


function sanitizeId(value) {
  const text = normalizeText(value).replace(/\s+/g, '-');
  return text || 'unknown';
}


function maxRisk(records) {
  let selected = 'unknown';
  let selectedRank = 0;
  for (const record of records) {
    const risk = record.risk || 'unknown';
    const rank = RISK_RANK[risk] || 0;
    if (rank > selectedRank) {
      selected = risk;
      selectedRank = rank;
    }
  }
  return selected;
}


function ageDays(now, createdAt) {
  return Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
}


function parseDate(value) {
  if (!stringOrNull(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}


function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}


function compareRecords(left, right) {
  const leftCreated = left.created_at || '';
  const rightCreated = right.created_at || '';
  if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
  return left.path.localeCompare(right.path);
}


function compareCandidates(left, right) {
  return left.candidate_id.localeCompare(right.candidate_id);
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function stringOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}


function stringOrUnknown(value) {
  return stringOrNull(value) || 'unknown';
}


function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


function printSummaryHuman(report) {
  console.log(`Noesis compression summary: ${report.status}`);
  console.log(`Workspace: ${report.workspace}`);
  console.log(`Events: ${report.summary.event_count} (${report.summary.valid_event_count} valid)`);
  console.log(`Proposals: ${report.summary.proposal_count} (${report.summary.valid_proposal_count} valid)`);
  console.log(`Candidates: ${report.summary.candidate_count}; warnings: ${report.summary.warning_count}; errors: ${report.summary.error_count}`);
  for (const candidate of report.candidates) {
    console.log(`- ${candidate.kind} ${candidate.candidate_id}: ${candidate.summary}`);
  }
  if (report.warnings.length > 0) {
    for (const warning of report.warnings) {
      console.log(`- [${warning.severity}] ${warning.code} ${warning.id || warning.path}: ${warning.message}`);
    }
  }
  console.log('Downstream execution: not run');
}


export function printCompressionUsage() {
  console.log(`Usage: noesis compression <command> [args]

Commands:
  summary                       Summarize repeated and stale learning artifacts.
  help                          Show compression command help.

Options:
  -h, --help                    Show this help message.

Examples:
  noesis compression summary --workspace /path/to/workspace --json`);
}


export function printCompressionSummaryUsage() {
  console.log(`Usage: noesis compression summary [--workspace <path>] [--event-dir <dir>] [--proposal-dir <dir>] [--min-group-size <n>] [--stale-days <days>] [--json]

Summarize repeated learning events, repeated proposals, and stale pending
proposals as Noesis-owned compression candidates.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --event-dir <dir>             Learning-event directory. Defaults to .noesis/events.
  --proposal-dir <dir>          Proposal queue directory. Defaults to .noesis/proposals.
  --min-group-size <n>          Similar-artifact threshold. Defaults to 2.
  --stale-days <days>           Pending-review age threshold. Defaults to 30.
  --json                        Print machine-readable JSON.

The summary command is read-only. It does not create compression proposals,
owner handoffs, memory entries, wiki drafts, skill links, or eval files.`);
}
