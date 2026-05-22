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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-eval-replay-${process.pid}-${counter}-`));
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


function writeGoldenCase(workspace, goldenCase) {
  const casePath = path.join(workspace, 'golden.json');
  fs.writeFileSync(casePath, `${JSON.stringify(goldenCase, null, 2)}\n`);
  return casePath;
}


function validGoldenCase() {
  return {
    schema_version: '0.1',
    case_id: 'route-eval-proposal-test',
    description: 'Route replay creates one eval proposal without owner side effects.',
    input: {
      event: {
        schema_version: '0.1',
        event_id: '2026-05-22T03-10-00Z__route-eval-proposal-test',
        created_at: '2026-05-22T03:10:00Z',
        workspace: '$WORKSPACE',
        kind: 'repeated_workflow',
        summary: 'A route replay should cover route and proposal flow.',
        source_refs: [
          {
            kind: 'slock_thread',
            ref: '#heuristic-system:8aa1f39e',
            summary: 'Task thread for replay runner.',
          },
        ],
        case: {
          situation: 'A learning event should become a proposal-only eval proposal.',
          observed: 'Route composes event promote and promote plan.',
          desired: 'Replay verifies stable proposal semantics.',
          evidence: 'Golden case should catch drift.',
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
            reason: 'The route should be covered by an eval proposal.',
          },
        ],
      },
    },
    expect: {
      status: 'ok',
      downstream_execution: 'not-run',
      summary: {
        request_count: 1,
        proposal_count: 1,
        error_count: 0,
      },
      request: {
        request_id: '2026-05-22T03-10-00Z__route-eval-proposal-test__promote',
        workspace: '$WORKSPACE',
        gate_policy: {
          allow_apply: false,
          review_required: true,
        },
        requested_outputs: [
          {
            kind: 'eval_proposal',
            target_owner: 'evals',
          },
        ],
      },
      proposals: [
        {
          proposal_id: '2026-05-22T03-10-00Z__route-eval-proposal-test__promote__01__eval_proposal',
          proposal_type: 'eval_proposal',
          status: 'pending_review',
          target_owner: 'evals',
          target_surface: 'evals',
          automation_boundary: {
            allow_apply: false,
            downstream_execution: 'not-run',
          },
          outcome: {
            status: 'not_applied',
          },
        },
      ],
      no_owner_state: true,
    },
  };
}


function ownerStateCase(surfaceDir) {
  const goldenCase = validGoldenCase();
  goldenCase.case_id = `route-eval-proposal-with-${surfaceDir.slice(1)}-state`;
  goldenCase.input.event.event_id = `2026-05-22T03-20-00Z__${surfaceDir.slice(1)}-state`;
  goldenCase.input.event.summary = `Replay should fail if ${surfaceDir} state appears.`;
  goldenCase.input.event.routing_hints[0].reason = `Simulate an unexpected ${surfaceDir} workspace surface.`;
  goldenCase.input.extra_owner_state = [surfaceDir];
  goldenCase.expect.request.request_id = `2026-05-22T03-20-00Z__${surfaceDir.slice(1)}-state__promote`;
  goldenCase.expect.proposals[0].proposal_id = `2026-05-22T03-20-00Z__${surfaceDir.slice(1)}-state__promote__01__eval_proposal`;
  return goldenCase;
}


test('eval replay passes a route/proposal golden case without owner side effects', (t) => {
  const workspace = tempWorkspace(t);
  const tmpRoot = path.join(workspace, 'tmp');
  const casePath = writeGoldenCase(workspace, validGoldenCase());

  const result = runNoesis(['eval', 'replay', casePath, '--tmp-root', tmpRoot, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'not-run');
  assert.equal(data.side_effects, 'temporary-workspace-removed');
  assert.deepEqual(data.writes, []);
  assert.equal(data.summary.case_count, 1);
  assert.equal(data.summary.passed_count, 1);
  assert.equal(data.summary.failed_count, 0);
  assert.equal(data.cases[0].status, 'pass');
  assert.equal(data.cases[0].workspace_removed, true);
  assert.equal(data.cases[0].actual.proposal_types[0], 'eval_proposal');
  assert.equal(data.cases[0].actual.downstream_execution, 'not-run');
  assert.equal(fs.existsSync(data.cases[0].workspace), false);
  assert.equal(fs.existsSync(path.join(workspace, '.pamem')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.loreforge')), false);
  assert.equal(fs.existsSync(path.join(workspace, 'evals')), false);
});


test('eval replay fails when skill visibility owner state appears', (t) => {
  const workspace = tempWorkspace(t);
  const casePath = writeGoldenCase(workspace, {
    schema_version: '0.1',
    cases: [
      ownerStateCase('.codex'),
      ownerStateCase('.claude'),
    ],
  });

  const result = runNoesis(['eval', 'replay', casePath, '--tmp-root', path.join(workspace, 'tmp'), '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.summary.case_count, 2);
  assert.equal(data.summary.failed_count, 2);
  assert.equal(data.cases[0].status, 'fail');
  assert.ok(data.cases[0].checks.find((item) => item.id === 'eval.replay.owner_state' && item.status === 'not_ok'));
  assert.ok(data.cases[1].checks.find((item) => item.id === 'eval.replay.owner_state' && item.status === 'not_ok'));
});


test('eval replay can use packaged default golden case', (t) => {
  const workspace = tempWorkspace(t);
  const tmpRoot = path.join(workspace, 'tmp');

  const result = runNoesis(['eval', 'replay', '--tmp-root', tmpRoot, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.summary.case_count, 1);
  assert.equal(data.cases[0].case_id, 'route-eval-proposal-basic');
});


test('eval replay reports golden mismatch as a failed eval', (t) => {
  const workspace = tempWorkspace(t);
  const badCase = validGoldenCase();
  badCase.expect.proposals[0].proposal_type = 'memory_proposal';
  const casePath = writeGoldenCase(workspace, badCase);

  const result = runNoesis(['eval', 'replay', casePath, '--tmp-root', path.join(workspace, 'tmp'), '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.summary.failed_count, 1);
  assert.ok(data.cases[0].checks.find((item) => item.status === 'not_ok' && item.id.endsWith('.proposal_type')));
});


test('eval replay can keep temporary workspaces for inspection', (t) => {
  const workspace = tempWorkspace(t);
  const casePath = writeGoldenCase(workspace, validGoldenCase());

  const result = runNoesis([
    'eval',
    'replay',
    casePath,
    '--tmp-root',
    path.join(workspace, 'tmp'),
    '--keep-workspaces',
    '--json',
  ], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(data.side_effects, 'temporary-workspace-kept');
  assert.notDeepEqual(data.writes, []);
  assert.equal(data.cases[0].workspace_removed, false);
  assert.equal(fs.existsSync(data.cases[0].workspace), true);
  assert.ok(data.writes.find((write) => write.includes('.noesis/events/')));
  assert.equal(fs.existsSync(path.join(data.cases[0].workspace, '.noesis', 'proposals')), true);
});


test('eval replay command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'eval', 'replay'], { cwd: workspace }).stdout, /Usage: noesis eval replay/);
  assert.match(runNoesis(['eval', 'help', 'replay'], { cwd: workspace }).stdout, /route\/proposal golden cases/);
  assert.match(runNoesis(['eval', 'replay', '--help'], { cwd: workspace }).stdout, /temporary workspaces/);
  assert.match(runNoesis(['help', 'eval'], { cwd: workspace }).stdout, /replay/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis eval replay/);
});
