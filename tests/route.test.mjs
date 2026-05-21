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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-route-${process.pid}-${counter}-`));
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


function writeEvent(workspace, event) {
  const eventDir = path.join(workspace, '.noesis', 'events');
  fs.mkdirSync(eventDir, { recursive: true });
  const eventPath = path.join(eventDir, `${event.event_id || 'event'}.json`);
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`);
  return eventPath;
}


function validEvent(workspace, overrides = {}) {
  return mergeObjects({
    schema_version: '0.1',
    event_id: '2026-05-21T06-20-00Z__route',
    created_at: '2026-05-21T06:20:00Z',
    workspace,
    kind: 'user_correction',
    summary: 'User asked to keep event and promote gates but add a high-level route command.',
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:722a58d4',
        summary: 'Thread where the route orchestration command was requested.',
      },
    ],
    case: {
      situation: 'An operator wants to turn a checked learning event into reviewable proposals.',
      observed: 'The operator must manually run event promote and promote plan.',
      desired: 'A high-level command should compose those gates without owner apply.',
      evidence: 'The workflow still needs independent event and promote gates for reviewability.',
    },
    impact: {
      severity: 'medium',
      recurrence: 'repeated',
      confidence: 'high',
    },
    routing_hints: [
      {
        candidate_kind: 'eval',
        target_surface: 'evals',
        review_required: true,
        reason: 'The workflow should be covered by a regression-oriented proposal.',
      },
    ],
  }, overrides);
}


function mergeObjects(base, overrides) {
  if (!isPlainObject(overrides)) return overrides;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = mergeObjects(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


test('route writes request and proposal artifacts without owner apply', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace));

  const result = runNoesis(['route', eventPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'not-run');
  assert.equal(data.summary.request_count, 1);
  assert.equal(data.summary.proposal_count, 1);
  assert.equal(data.event_promote_report.command, 'event promote');
  assert.equal(data.promote_plan_report.command, 'promote plan');
  assert.equal(data.event_promote_report.event_check_report.command, 'event check');
  assert.equal(data.promote_plan_report.check_report.command, 'promote check');
  assert.equal(data.writes.length, 4);

  const request = JSON.parse(fs.readFileSync(data.request_path, 'utf8'));
  const proposal = JSON.parse(fs.readFileSync(data.proposals[0].path, 'utf8'));

  assert.equal(request.gate_policy.allow_apply, false);
  assert.equal(proposal.proposal_type, 'eval_proposal');
  assert.equal(proposal.status, 'pending_review');
  assert.equal(proposal.automation_boundary.allow_apply, false);
  assert.equal(proposal.automation_boundary.downstream_execution, 'not-run');
  assert.equal(proposal.outcome.status, 'not_applied');
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
});


test('route stops before planning when event check has errors', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, {
    schema_version: '0.1',
    event_id: 'bad-route',
  });

  const result = runNoesis(['route', eventPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.summary.request_count, 0);
  assert.equal(data.summary.proposal_count, 0);
  assert.equal(data.promote_plan_report, null);
  assert.deepEqual(data.writes, []);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'promote-requests')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'proposals')), false);
});


test('route refuses to overwrite generated artifacts unless forced', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace));

  runNoesis(['route', eventPath], { cwd: workspace });
  const rejected = runNoesis(['route', eventPath], { cwd: workspace, check: false });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /promote request already exists/);

  const forced = runNoesis(['route', eventPath, '--force', '--json'], { cwd: workspace });
  const data = JSON.parse(forced.stdout);
  assert.equal(data.status, 'ok');
  assert.ok(data.event_promote_report.actions.find((action) => action.action === 'wrote' && action.path === data.request_path));
  assert.ok(data.promote_plan_report.actions.find((action) => action.action === 'wrote'));
});


test('route command help is available', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = path.join(workspace, '.noesis', 'events', 'example.json');

  assert.match(runNoesis(['help', 'route'], { cwd: workspace }).stdout, /Usage: noesis route/);
  assert.match(runNoesis(['route', '--help'], { cwd: workspace }).stdout, /Usage: noesis route/);
  assert.match(runNoesis(['route', 'help'], { cwd: workspace }).stdout, /Usage: noesis route/);
  assert.match(runNoesis(['route', eventPath, '--help'], { cwd: workspace }).stdout, /event-to-proposal/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis route/);
});
