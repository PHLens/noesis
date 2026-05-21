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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-eval-handoff-${process.pid}-${counter}-`));
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


function createApprovedEvalProposal(workspace) {
  const request = validRequest(workspace);
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


function validRequest(workspace) {
  return {
    schema_version: '0.1',
    request_id: '2026-05-21T03-40-00Z__eval-handoff',
    created_at: '2026-05-21T03:40:00Z',
    workspace,
    trigger: {
      kind: 'user_request',
      summary: 'User asked Noesis to hand off an approved eval proposal.',
      requested_by: '@Percy',
    },
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:56a021a1',
        summary: 'Task thread for eval-proposal owner handoff skeleton.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Add an eval owner handoff report for an approved proposal.',
        evidence: 'Approved eval proposals need a visible owner-action artifact without Noesis applying changes.',
        candidate_kind: 'eval',
        target_surface: 'evals',
        risk: 'medium',
        review_required: true,
        reason: 'The eval owner should receive a compact report before creating regression artifacts.',
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
      scenario: 'Approved eval proposal is handed off without downstream apply.',
      acceptance: 'The handoff command writes only a Noesis report and leaves the proposal outcome not_applied.',
    },
  };
}


test('eval handoff writes a report for an approved eval proposal without owner apply', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalPath, proposalId } = createApprovedEvalProposal(workspace);
  const beforeProposal = fs.readFileSync(proposalPath, 'utf8');

  const result = runNoesis(['eval', 'handoff', proposalId, '--reviewer', '@Percy', '--note', 'Hand off to eval owner.', '--json'], { cwd: workspace });
  const afterProposal = fs.readFileSync(proposalPath, 'utf8');
  const data = JSON.parse(result.stdout);
  const report = JSON.parse(fs.readFileSync(data.report_path, 'utf8'));

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, [data.report_path]);
  assert.equal(data.proposal_id, proposalId);
  assert.equal(report.status, 'pending_owner_action');
  assert.equal(report.owner_action.kind, 'eval_handoff');
  assert.equal(report.owner_action.downstream_execution, 'not-run');
  assert.equal(report.automation_boundary.allow_apply, false);
  assert.equal(report.automation_boundary.owner_apply_required, true);
  assert.equal(report.reviewer, '@Percy');
  assert.equal(report.note, 'Hand off to eval owner.');
  assert.equal(afterProposal, beforeProposal);
  assert.equal(fs.existsSync(path.join(workspace, 'evals')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
});


test('eval handoff refuses pending or non-eval proposals', (t) => {
  const workspace = tempWorkspace(t);
  const requestPath = writeRequest(workspace, validRequest(workspace));
  const plan = runNoesis(['promote', 'plan', requestPath, '--json'], { cwd: workspace });
  const proposalPath = JSON.parse(plan.stdout).proposals[0].path;

  const pending = runNoesis(['eval', 'handoff', proposalPath, '--json'], { cwd: workspace, check: false });
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /requires an approved proposal/);

  const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
  proposal.status = 'approved';
  proposal.proposal_type = 'memory_proposal';
  proposal.target_owner = 'pamem';
  proposal.target_surface = 'pamem';
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);

  const nonEval = runNoesis(['eval', 'handoff', proposalPath, '--json'], { cwd: workspace, check: false });
  assert.equal(nonEval.status, 1);
  assert.match(nonEval.stderr, /only supports eval_proposal/);
});


test('eval handoff refuses overwrite unless forced', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalId } = createApprovedEvalProposal(workspace);

  const first = runNoesis(['eval', 'handoff', proposalId, '--json'], { cwd: workspace });
  const second = runNoesis(['eval', 'handoff', proposalId, '--json'], { cwd: workspace, check: false });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists/);

  const forced = runNoesis(['eval', 'handoff', proposalId, '--force', '--json'], { cwd: workspace });
  assert.equal(JSON.parse(forced.stdout).report_path, JSON.parse(first.stdout).report_path);
});


test('eval handoff refuses paths outside the proposal queue directory', (t) => {
  const workspace = tempWorkspace(t);
  const { proposalPath } = createApprovedEvalProposal(workspace);
  const outsidePath = path.join(workspace, 'outside-proposal.json');
  fs.copyFileSync(proposalPath, outsidePath);

  const result = runNoesis(['eval', 'handoff', outsidePath, '--json'], { cwd: workspace, check: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /limited to the proposal queue directory/);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'reports', 'eval-handoffs')), false);
});


test('eval command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'eval'], { cwd: workspace }).stdout, /Usage: noesis eval/);
  assert.match(runNoesis(['help', 'eval', 'handoff'], { cwd: workspace }).stdout, /Usage: noesis eval handoff/);
  assert.match(runNoesis(['eval', 'help', 'handoff'], { cwd: workspace }).stdout, /approved eval_proposal/);
  assert.match(runNoesis(['eval', 'handoff', '--help'], { cwd: workspace }).stdout, /Noesis report only/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis eval handoff/);
});
