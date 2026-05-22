import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOESIS = path.join(REPO_ROOT, 'bin', 'noesis');
let counter = 0;


function tempWorkspace(t) {
  counter += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-compression-${process.pid}-${counter}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}


function runNoesis(args, { cwd, check = true }) {
  const result = spawnSync(process.execPath, [NOESIS, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });
  if (check && result.status !== 0) {
    assert.fail(`noesis failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}


function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}


function writeEvent(workspace, id, overrides = {}) {
  const event = {
    schema_version: '0.1',
    event_id: id,
    created_at: '2026-05-22T02:00:00Z',
    workspace,
    kind: 'repeated_workflow',
    summary: 'Repeated review loop needs stable owner handoff follow-up.',
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:44cea4f3',
        summary: 'Task thread for compression summary.',
      },
    ],
    case: {
      situation: 'Agents keep repeating owner handoff review work.',
      observed: 'The same routing pattern appears across task threads.',
      desired: 'Noesis should surface a stable compression candidate.',
      evidence: 'Repeated learning events have the same summary and target.',
    },
    impact: {
      severity: 'medium',
      recurrence: 'repeated',
      confidence: 'high',
    },
    routing_hints: [
      {
        candidate_kind: 'memory',
        target_surface: 'pamem',
        review_required: true,
        reason: 'This repeated workflow belongs in durable memory.',
      },
    ],
    ...overrides,
  };
  const eventPath = path.join(workspace, '.noesis', 'events', `${id}.json`);
  writeJson(eventPath, event);
  return eventPath;
}


function writeProposal(workspace, id, overrides = {}) {
  const proposal = {
    schema_version: '0.1',
    proposal_id: id,
    proposal_type: 'memory_proposal',
    status: 'pending_review',
    created_at: '2026-05-22T02:15:00Z',
    updated_at: '2026-05-22T02:15:00Z',
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:44cea4f3',
        summary: 'Task thread for compression summary.',
      },
    ],
    summary: 'Repeated review loop needs stable owner handoff follow-up.',
    target_owner: 'pamem',
    target_surface: 'pamem',
    rationale: 'A repeated owner handoff pattern should become a maintained rule.',
    review_required: true,
    risk: 'medium',
    acceptance_checks: [
      {
        kind: 'manual_review',
        description: 'Memory owner reviews the proposed rule before merge.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Repeated review loop needs stable owner handoff follow-up.',
        evidence: 'The same pattern appears in multiple tasks.',
        candidate_kind: 'memory',
        target_surface: 'pamem',
        risk: 'medium',
        review_required: true,
        reason: 'Owner handoff review should be durable.',
      },
    ],
    automation_boundary: {
      mode: 'proposal_only',
      allow_apply: false,
      downstream_execution: 'not-run',
      owner_apply_required: true,
    },
    review_history: [],
    outcome: {
      status: 'not_applied',
      refs: [],
      notes: 'Pending review.',
    },
    ...overrides,
  };
  const proposalPath = path.join(workspace, '.noesis', 'proposals', `${id}.json`);
  writeJson(proposalPath, proposal);
  return proposalPath;
}


test('compression summary surfaces repeated learning artifacts without writing owner state', (t) => {
  const workspace = tempWorkspace(t);
  writeEvent(workspace, '2026-05-22T02-00-00Z__repeat-owner-handoff-1');
  writeEvent(workspace, '2026-05-22T02-01-00Z__repeat-owner-handoff-2');
  writeProposal(workspace, '2026-05-22T02-10-00Z__repeat-owner-handoff-1');
  writeProposal(workspace, '2026-05-22T02-11-00Z__repeat-owner-handoff-2');
  const before = snapshot(workspace);

  const result = runNoesis(['compression', 'summary', '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);

  assert.equal(data.command, 'compression summary');
  assert.equal(data.status, 'warning');
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, []);
  assert.equal(data.summary.event_count, 2);
  assert.equal(data.summary.proposal_count, 2);
  assert.equal(data.summary.candidate_count, 2);
  assert.equal(data.summary.repeated_event_candidate_count, 1);
  assert.equal(data.summary.repeated_proposal_candidate_count, 1);
  assert(data.candidates.some((candidate) => candidate.kind === 'repeated_events' && candidate.suggested_target_owner === 'Noesis'));
  assert(data.candidates.some((candidate) => candidate.kind === 'repeated_proposals' && candidate.suggested_proposal_type === 'compression_proposal'));
  for (const candidate of data.candidates) {
    assert.equal(candidate.downstream_execution, 'not-run');
    assert.equal(candidate.automation_boundary.allow_apply, false);
    assert.equal(candidate.automation_boundary.downstream_execution, 'not-run');
  }
  assert.deepEqual(after, before);
  assertNoOwnerState(workspace);
});


test('compression summary reports stale pending proposals as compression candidates', (t) => {
  const workspace = tempWorkspace(t);
  const stalePath = writeProposal(workspace, '2026-01-01T00-00-00Z__stale-memory-proposal', {
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    summary: 'Old pending memory proposal should be reviewed.',
  });

  const result = runNoesis(['compression', 'summary', '--stale-days', '1', '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'warning');
  assert.equal(data.summary.stale_proposal_count, 1);
  assert.equal(data.summary.stale_proposal_candidate_count, 1);
  assert.equal(data.candidates.length, 1);
  assert.equal(data.candidates[0].kind, 'stale_proposals');
  assert.equal(data.candidates[0].source_refs[0].ref, stalePath);
  assert.equal(data.candidates[0].suggested_action, 'review_stale_proposals_for_reject_or_supersede');
  assert.equal(data.candidates[0].stale_age_days.max >= 1, true);
  assertNoOwnerState(workspace);
});


test('compression summary tolerates invalid artifacts and remains read-only', (t) => {
  const workspace = tempWorkspace(t);
  writeEvent(workspace, '2026-05-22T02-00-00Z__single-event');
  const invalidPath = path.join(workspace, '.noesis', 'proposals', 'invalid.json');
  fs.mkdirSync(path.dirname(invalidPath), { recursive: true });
  fs.writeFileSync(invalidPath, '{not-json\n');
  const before = snapshot(workspace);

  const result = runNoesis(['compression', 'summary', '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'warning');
  assert.equal(data.summary.invalid_count, 1);
  assert.equal(data.summary.error_count, 1);
  assert.equal(data.summary.candidate_count, 0);
  assert(data.warnings.some((warning) => warning.code === 'invalid_proposal_artifact' && warning.path === invalidPath));
  assert.deepEqual(data.writes, []);
  assert.deepEqual(after, before);
  assertNoOwnerState(workspace);
});


test('compression summary supports custom thresholds and command help', (t) => {
  const workspace = tempWorkspace(t);
  writeEvent(workspace, '2026-05-22T02-00-00Z__repeat-owner-handoff-1');
  writeEvent(workspace, '2026-05-22T02-01-00Z__repeat-owner-handoff-2');
  writeEvent(workspace, '2026-05-22T02-02-00Z__repeat-owner-handoff-3');

  const result = runNoesis(['compression', 'summary', '--min-group-size', '3', '--stale-days', '0', '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.summary.repeated_event_candidate_count, 1);
  assert.equal(data.thresholds.min_group_size, 3);
  assert.equal(data.thresholds.stale_after_days, 0);
  assert.match(runNoesis(['help', 'compression'], { cwd: workspace }).stdout, /Usage: noesis compression/);
  assert.match(runNoesis(['help', 'compression', 'summary'], { cwd: workspace }).stdout, /Usage: noesis compression summary/);
  assert.match(runNoesis(['compression', 'help', 'summary'], { cwd: workspace }).stdout, /Summarize repeated learning events/);
  assert.match(runNoesis(['compression', 'summary', '--help'], { cwd: workspace }).stdout, /read-only/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis compression summary/);
});


test('compression summary groups non-ASCII learning summaries', (t) => {
  const workspace = tempWorkspace(t);
  writeEvent(workspace, '2026-05-22T02-00-00Z__slock-runtime-rule-1', {
    summary: 'Slock runtime 后续回复到 thread 里',
  });
  writeEvent(workspace, '2026-05-22T02-01-00Z__slock-runtime-rule-2', {
    summary: 'Slock runtime 后续回复到 thread 里',
  });

  const result = runNoesis(['compression', 'summary', '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.summary.repeated_event_candidate_count, 1);
  assert.equal(data.candidates[0].kind, 'repeated_events');
  assert.match(data.candidates[0].summary, /Slock runtime/);
});


function assertNoOwnerState(workspace) {
  for (const relative of [
    '.pamem',
    '.loreforge',
    '.codex',
    '.claude',
    'evals',
    path.join('.noesis', 'owner-handoffs'),
    path.join('.noesis', 'reports', 'eval-handoffs'),
  ]) {
    assert.equal(fs.existsSync(path.join(workspace, relative)), false, `${relative} should not exist`);
  }
}


function snapshot(root) {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir).sort()) {
      const fullPath = path.join(dir, entry);
      const relative = path.relative(root, fullPath);
      const stat = fs.lstatSync(fullPath);
      entries.push(`${stat.isDirectory() ? 'd' : 'f'}:${relative}`);
      if (stat.isDirectory()) visit(fullPath);
    }
  }
  visit(root);
  return entries;
}
