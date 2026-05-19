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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-proposal-${process.pid}-${counter}-`));
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


function writeRequest(workspace) {
  const request = {
    schema_version: '0.1',
    request_id: '2026-05-19T09-00-00Z__proposal-queue',
    created_at: '2026-05-19T09:00:00Z',
    workspace,
    trigger: {
      kind: 'user_request',
      summary: 'User asked to review a generated proposal queue artifact.',
      requested_by: '@Percy',
    },
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:a12b78f5',
        summary: 'Task thread for proposal queue skeleton.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Track proposal review state without applying owner changes.',
        evidence: 'The HS loop needs visible proposal queue status.',
        candidate_kind: 'eval',
        target_surface: 'evals',
        risk: 'medium',
        review_required: true,
        reason: 'Review metadata should be handled before owner-specific apply flows.',
      },
    ],
    requested_outputs: [
      {
        kind: 'eval_proposal',
        target_owner: 'evals',
        review_required: true,
      },
    ],
    gate_policy: {
      mode: 'proposal_only',
      allow_apply: false,
      review_required: true,
    },
    expected_regression: {
      kind: 'unit_test',
      scenario: 'Proposal queue status can be reviewed without downstream apply.',
      acceptance: 'Updating review status writes only the proposal artifact.',
    },
  };
  const requestDir = path.join(workspace, '.noesis', 'promote-requests');
  fs.mkdirSync(requestDir, { recursive: true });
  const requestPath = path.join(requestDir, `${request.request_id}.json`);
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return requestPath;
}


function createProposal(workspace) {
  const requestPath = writeRequest(workspace);
  const result = runNoesis(['promote', 'plan', requestPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);
  return {
    proposalId: data.proposals[0].proposal_id,
    proposalPath: data.proposals[0].path,
  };
}


test('proposal list shows pending proposal artifacts without writing state', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId } = createProposal(workspace);
  const before = snapshot(workspace);

  const result = runNoesis(['proposal', 'list', '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.summary.proposal_count, 1);
  assert.equal(data.summary.invalid_count, 0);
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, []);
  assert.equal(data.proposals[0].proposal_id, proposalId);
  assert.equal(data.proposals[0].status, 'pending_review');
  assert.deepEqual(after, before);
});


test('proposal show resolves a proposal by id', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId, proposalPath } = createProposal(workspace);

  const result = runNoesis(['proposal', 'show', proposalId, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.proposal_path, proposalPath);
  assert.equal(data.proposal.proposal_id, proposalId);
  assert.equal(data.proposal.status, 'pending_review');
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, []);
});


test('proposal update records review metadata without owner apply', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId, proposalPath } = createProposal(workspace);

  const result = runNoesis([
    'proposal',
    'update',
    proposalId,
    '--status',
    'approved',
    '--reviewer',
    '@Percy',
    '--note',
    'Ready for owner review.',
    '--json',
  ], { cwd: workspace });
  const data = JSON.parse(result.stdout);
  const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));

  assert.equal(data.status, 'ok');
  assert.equal(data.previous_status, 'pending_review');
  assert.equal(data.new_status, 'approved');
  assert.deepEqual(data.writes, [proposalPath]);
  assert.equal(data.downstream_execution, 'not-run');
  assert.equal(proposal.status, 'approved');
  assert.equal(proposal.outcome.status, 'not_applied');
  assert.equal(proposal.automation_boundary.allow_apply, false);
  assert.equal(proposal.automation_boundary.downstream_execution, 'not-run');
  assert.equal(proposal.review_history.length, 1);
  assert.equal(proposal.review_history[0].reviewer, '@Percy');
  assert.equal(proposal.review_history[0].note, 'Ready for owner review.');
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
});


test('proposal update refuses applied status because apply belongs to owner flow', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId, proposalPath } = createProposal(workspace);
  const before = fs.readFileSync(proposalPath, 'utf8');

  const result = runNoesis(['proposal', 'update', proposalId, '--status', 'applied', '--json'], { cwd: workspace, check: false });
  const after = fs.readFileSync(proposalPath, 'utf8');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reserved for a future owner-apply flow/);
  assert.equal(after, before);
});


test('proposal update rejects invalid status transitions', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId } = createProposal(workspace);

  runNoesis(['proposal', 'update', proposalId, '--status', 'rejected'], { cwd: workspace });
  const result = runNoesis(['proposal', 'update', proposalId, '--status', 'approved'], { cwd: workspace, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid proposal status transition: rejected -> approved/);
});


test('proposal update refuses paths outside the proposal queue directory', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalPath } = createProposal(workspace);
  const outsidePath = path.join(workspace, 'outside-proposal.json');
  fs.copyFileSync(proposalPath, outsidePath);
  const before = fs.readFileSync(outsidePath, 'utf8');

  const result = runNoesis(['proposal', 'update', outsidePath, '--status', 'approved', '--json'], { cwd: workspace, check: false });
  const after = fs.readFileSync(outsidePath, 'utf8');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /limited to the proposal queue directory/);
  assert.equal(after, before);
});


test('proposal command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'proposal'], { cwd: workspace }).stdout, /Usage: noesis proposal/);
  assert.match(runNoesis(['help', 'proposal', 'list'], { cwd: workspace }).stdout, /Usage: noesis proposal list/);
  assert.match(runNoesis(['help', 'proposal', 'show'], { cwd: workspace }).stdout, /Usage: noesis proposal show/);
  assert.match(runNoesis(['help', 'proposal', 'update'], { cwd: workspace }).stdout, /Usage: noesis proposal update/);
  assert.match(runNoesis(['proposal', 'help', 'list'], { cwd: workspace }).stdout, /List proposal artifacts/);
  assert.match(runNoesis(['proposal', 'list', '--help'], { cwd: workspace }).stdout, /read-only/);
  assert.match(runNoesis(['proposal', 'update', '--help'], { cwd: workspace }).stdout, /review metadata/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis proposal list/);
});


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
