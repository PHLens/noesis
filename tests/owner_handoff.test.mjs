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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-owner-handoff-${process.pid}-${counter}-`));
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


function writeRequest(workspace, request) {
  const requestDir = path.join(workspace, '.noesis', 'promote-requests');
  fs.mkdirSync(requestDir, { recursive: true });
  const requestPath = path.join(requestDir, `${request.request_id}.json`);
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return requestPath;
}


function createProposal(workspace, output = memoryOutput()) {
  const request = validRequest(workspace, output);
  const requestPath = writeRequest(workspace, request);
  const plan = runNoesis(['promote', 'plan', requestPath, '--json'], { cwd: workspace });
  const proposalPath = JSON.parse(plan.stdout).proposals[0].path;
  const update = runNoesis([
    'proposal',
    'update',
    proposalPath,
    '--status',
    'approved',
    '--reviewer',
    '@Percy',
    '--json',
  ], { cwd: workspace });
  const proposal = JSON.parse(update.stdout).proposal;
  return { proposalPath, proposalId: proposal.proposal_id };
}


function memoryOutput() {
  return {
    kind: 'memory_proposal',
    target_owner: 'pamem',
    review_required: true,
  };
}


function validRequest(workspace, output) {
  const candidateKind = {
    memory_proposal: 'memory',
    wiki_proposal: 'wiki',
    skill_proposal: 'skill',
    eval_proposal: 'eval',
    compression_proposal: 'compression',
    noop: 'noop',
  }[output.kind] || 'unknown';
  return {
    schema_version: '0.1',
    request_id: `2026-05-22T00-20-00Z__${candidateKind}-handoff`,
    created_at: '2026-05-22T00:20:00Z',
    workspace,
    trigger: {
      kind: 'user_request',
      summary: 'User asked Noesis to hand off an approved proposal to an owner lane.',
      requested_by: '@Percy',
    },
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:b8a810c7',
        summary: 'Task thread for generic owner handoff.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Create a visible owner handoff artifact.',
        evidence: 'Approved proposals need a lane handoff before owner materialization.',
        candidate_kind: candidateKind,
        target_surface: output.target_owner === 'LoreForge' ? 'loreforge' : output.target_owner,
        risk: 'medium',
        review_required: true,
        reason: 'The owner should receive compact proposal context without Noesis applying changes.',
      },
    ],
    requested_outputs: [output],
    gate_policy: {
      mode: 'proposal_only',
      allow_apply: false,
      review_required: true,
    },
    expected_regression: {
      kind: 'unit_test',
      scenario: 'Approved proposal is handed off without downstream apply.',
      acceptance: 'The handoff command writes only a Noesis handoff artifact and leaves the proposal unchanged.',
    },
  };
}


test('owner handoff writes a pending owner-lane artifact without owner apply', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalPath, proposalId } = createProposal(workspace);
  const beforeProposal = fs.readFileSync(proposalPath, 'utf8');

  const result = runNoesis(['owner', 'handoff', proposalId, '--reviewer', '@Percy', '--note', 'Ready for memory owner.', '--json'], { cwd: workspace });
  const afterProposal = fs.readFileSync(proposalPath, 'utf8');
  const data = JSON.parse(result.stdout);
  const handoff = JSON.parse(fs.readFileSync(data.handoff_path, 'utf8'));

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, [data.handoff_path]);
  assert.equal(data.target_owner, 'pamem');
  assert.equal(data.handoff_path, path.join(workspace, '.noesis', 'owner-handoffs', 'pamem', 'pending', `${proposalId}__owner_handoff.json`));
  assert.equal(handoff.status, 'pending_owner_action');
  assert.equal(handoff.owner_action.kind, 'memory_owner_review');
  assert.equal(handoff.owner_action.downstream_execution, 'not-run');
  assert.equal(handoff.automation_boundary.allow_apply, false);
  assert.equal(handoff.automation_boundary.owner_apply_required, true);
  assert.equal(handoff.reviewer, '@Percy');
  assert.equal(handoff.note, 'Ready for memory owner.');
  assert.equal(handoff.artifact.proposal_id, proposalId);
  assert.equal(afterProposal, beforeProposal);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
});


test('owner handoff routes different owners to separate pending queues', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId } = createProposal(workspace, {
    kind: 'wiki_proposal',
    target_owner: 'LoreForge',
    review_required: true,
  });

  const result = runNoesis(['owner', 'handoff', proposalId, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);
  const handoff = JSON.parse(fs.readFileSync(data.handoff_path, 'utf8'));

  assert.equal(data.target_owner, 'LoreForge');
  assert.equal(data.handoff_path, path.join(workspace, '.noesis', 'owner-handoffs', 'LoreForge', 'pending', `${proposalId}__owner_handoff.json`));
  assert.equal(handoff.owner_action.kind, 'wiki_owner_review');
  assert.equal(handoff.owner_action.expected_owner, 'LoreForge');
});


test('owner handoff refuses pending, noop, and unknown-owner proposals', (t) => {
  const workspace = tempWorkspace(t);
  const requestPath = writeRequest(workspace, validRequest(workspace, memoryOutput()));
  const plan = runNoesis(['promote', 'plan', requestPath, '--json'], { cwd: workspace });
  const proposalPath = JSON.parse(plan.stdout).proposals[0].path;

  const pending = runNoesis(['owner', 'handoff', proposalPath, '--json'], { cwd: workspace, check: false });
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /requires an approved proposal/);

  const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
  proposal.status = 'approved';
  proposal.proposal_type = 'noop';
  proposal.target_owner = 'none';
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const noop = runNoesis(['owner', 'handoff', proposalPath, '--json'], { cwd: workspace, check: false });
  assert.equal(noop.status, 1);
  assert.match(noop.stderr, /does not support noop proposals/);

  proposal.proposal_type = 'memory_proposal';
  proposal.target_owner = 'unknown';
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const unknown = runNoesis(['owner', 'handoff', proposalPath, '--json'], { cwd: workspace, check: false });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /requires a known target_owner/);
});


test('owner handoff refuses overwrite unless forced', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId } = createProposal(workspace);

  const first = runNoesis(['owner', 'handoff', proposalId, '--json'], { cwd: workspace });
  const second = runNoesis(['owner', 'handoff', proposalId, '--json'], { cwd: workspace, check: false });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists/);

  const forced = runNoesis(['owner', 'handoff', proposalId, '--force', '--json'], { cwd: workspace });
  assert.equal(JSON.parse(forced.stdout).handoff_path, JSON.parse(first.stdout).handoff_path);
});


test('owner handoff refuses paths outside the proposal queue directory', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalPath } = createProposal(workspace);
  const outsidePath = path.join(workspace, 'outside-proposal.json');
  fs.copyFileSync(proposalPath, outsidePath);

  const result = runNoesis(['owner', 'handoff', outsidePath, '--json'], { cwd: workspace, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /limited to the proposal queue directory/);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'owner-handoffs')), false);
});


test('owner command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'owner'], { cwd: workspace }).stdout, /Usage: noesis owner/);
  assert.match(runNoesis(['help', 'owner', 'handoff'], { cwd: workspace }).stdout, /Usage: noesis owner handoff/);
  assert.match(runNoesis(['owner', 'help', 'handoff'], { cwd: workspace }).stdout, /approved proposal/);
  assert.match(runNoesis(['owner', 'handoff', '--help'], { cwd: workspace }).stdout, /Noesis-owned artifact only/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis owner handoff/);
});
