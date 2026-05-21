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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-event-${process.pid}-${counter}-`));
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
  const eventId = typeof event.event_id === 'string' ? event.event_id : 'event';
  const eventPath = path.join(eventDir, `${eventId}.json`);
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`);
  return eventPath;
}


function validEvent(workspace, overrides = {}) {
  return mergeObjects({
    schema_version: '0.1',
    event_id: '2026-05-19T09-30-00Z__learning-event',
    created_at: '2026-05-19T09:30:00Z',
    workspace,
    kind: 'user_correction',
    summary: 'User corrected a workflow boundary before it became durable behavior.',
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:b3d21266',
        summary: 'Thread where the correction and desired boundary were discussed.',
      },
    ],
    case: {
      situation: 'An agent is deciding whether a chat correction should become durable behavior.',
      observed: 'The correction was only discussed in the thread and had no structured intake artifact.',
      desired: 'Capture a compact event that can later be routed into a promote request.',
      evidence: 'The HS workflow needs event intake before router and proposal generation can run.',
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
        reason: 'The behavior should become a checkable regression before any owner apply flow.',
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


test('event check accepts a valid learning event and stays read-only', (t) => {
  const workspace = tempWorkspace(t);
  const proposals = path.join(workspace, '.noesis', 'proposals');
  fs.mkdirSync(proposals, { recursive: true });
  const eventPath = writeEvent(workspace, validEvent(workspace));
  const before = snapshot(workspace);

  const result = runNoesis(['event', 'check', eventPath, '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.summary.error_count, 0);
  assert.equal(data.summary.warning_count, 0);
  assert.equal(data.event_id, '2026-05-19T09-30-00Z__learning-event');
  assert.equal(data.event_kind, 'user_correction');
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, []);
  assert.deepEqual(after, before);
});


test('event check fails when required fields are missing', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, {
    schema_version: '0.1',
    event_id: 'missing-fields',
  });

  const result = runNoesis(['event', 'check', eventPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.ok(data.summary.error_count > 0);
  assert.ok(data.checks.find((item) => item.id === 'event.source_refs'));
  assert.ok(data.checks.find((item) => item.id === 'event.case'));
  assert.ok(data.checks.find((item) => item.id === 'event.impact'));
});


test('event check rejects transcript and raw log retention fields', (t) => {
  const workspace = tempWorkspace(t);
  const event = validEvent(workspace, {
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:b3d21266',
        summary: 'Thread reference only.',
        raw_transcript: 'full conversation should not be retained here',
      },
    ],
    case: {
      evidence: 'Compact evidence only.',
      raw_log: 'raw runtime output should not be retained here',
    },
  });
  const eventPath = writeEvent(workspace, event);

  const result = runNoesis(['event', 'check', eventPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.ok(data.checks.find((item) => item.id === 'event.source_refs[0].raw_transcript'));
  assert.ok(data.checks.find((item) => item.id === 'event.case.raw_log'));
});


test('event check allows missing routing hints as warning-only intake', (t) => {
  const workspace = tempWorkspace(t);
  const event = validEvent(workspace, {
    routing_hints: undefined,
  });
  delete event.routing_hints;
  const eventPath = writeEvent(workspace, event);

  const result = runNoesis(['event', 'check', eventPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(data.status, 'warning');
  assert.equal(data.summary.error_count, 0);
  assert.ok(data.checks.find((item) => item.id === 'event.routing_hints'));
});


test('event check warns for private paths and unresolved routing hints', (t) => {
  const workspace = tempWorkspace(t);
  const event = validEvent(workspace, {
    source_refs: [
      {
        kind: 'file',
        ref: '/home/cambricon/private/path/note.md',
        summary: 'Private absolute path should be sanitized before promotion.',
      },
    ],
    routing_hints: [
      {
        candidate_kind: 'unknown',
        target_surface: 'unknown',
        review_required: true,
        reason: 'The router has not classified this event yet.',
      },
    ],
  });
  const eventPath = writeEvent(workspace, event);

  const result = runNoesis(['event', 'check', eventPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(data.status, 'warning');
  assert.equal(data.summary.error_count, 0);
  assert.ok(data.checks.find((item) => item.id === 'event.source_refs[0].ref.private_path'));
  assert.ok(data.checks.find((item) => item.id === 'event.routing_hints[0].candidate_kind.unknown'));
  assert.ok(data.checks.find((item) => item.id === 'event.routing_hints[0].target_surface.unknown'));
});


test('event promote writes a promote-request artifact without planning proposals', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace, {
    event_id: '2026-05-21T02-40-00Z__event-to-promote',
    kind: 'user_correction',
    routing_hints: [
      {
        candidate_kind: 'memory',
        target_surface: 'pamem',
        review_required: true,
        reason: 'The correction should be reviewed by the memory owner.',
      },
      {
        candidate_kind: 'eval',
        target_surface: 'evals',
        review_required: true,
        reason: 'The same behavior should become a regression check.',
      },
    ],
  }));
  const before = snapshot(workspace);

  const result = runNoesis(['event', 'promote', eventPath, '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);
  const request = JSON.parse(fs.readFileSync(data.request_path, 'utf8'));

  assert.equal(data.status, 'ok');
  assert.equal(data.downstream_execution, 'not-run');
  assert.equal(data.summary.request_count, 1);
  assert.deepEqual(data.writes.sort(), [path.dirname(data.request_path), data.request_path].sort());
  assert.deepEqual(after.filter((entry) => !before.includes(entry)).sort(), [
    'd:.noesis/promote-requests',
    `f:${path.relative(workspace, data.request_path)}`,
  ].sort());
  assert.equal(fs.existsSync(path.join(workspace, '.noesis', 'proposals')), false);
  assert.equal(request.schema_version, '0.1');
  assert.equal(request.request_id, '2026-05-21T02-40-00Z__event-to-promote__promote');
  assert.equal(request.trigger.kind, 'user_correction');
  assert.equal(request.candidate_items.length, 2);
  assert.equal(request.candidate_items[0].candidate_kind, 'memory');
  assert.equal(request.candidate_items[0].target_surface, 'pamem');
  assert.equal(request.candidate_items[0].risk, 'medium');
  assert.equal(request.requested_outputs[0].kind, 'memory_proposal');
  assert.equal(request.requested_outputs[0].target_owner, 'pamem');
  assert.equal(request.requested_outputs[1].kind, 'eval_proposal');
  assert.equal(request.requested_outputs[1].target_owner, 'evals');
  assert.equal(request.gate_policy.allow_apply, false);
  assert.equal(request.gate_policy.review_required, true);
  assert.equal(request.expected_regression.kind, 'manual_review');

  const check = runNoesis(['promote', 'check', data.request_path, '--json'], { cwd: workspace });
  assert.equal(JSON.parse(check.stdout).summary.error_count, 0);
});


test('event promote defaults to request workspace for output', (t) => {
  const workspace = tempWorkspace(t);
  const cwd = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace));

  const result = runNoesis(['event', 'promote', eventPath, '--json'], { cwd });
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.output_dir, path.join(workspace, '.noesis', 'promote-requests'));
  assert.equal(data.request_path.startsWith(data.output_dir), true);
  assert.equal(fs.existsSync(path.join(cwd, '.noesis')), false);
});


test('event promote writes nothing when event check has errors', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, {
    schema_version: '0.1',
    event_id: 'bad-event',
  });
  const outDir = path.join(workspace, '.noesis', 'promote-requests');

  const result = runNoesis(['event', 'promote', eventPath, '--out', outDir, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.equal(data.summary.request_count, 0);
  assert.deepEqual(data.writes, []);
  assert.equal(fs.existsSync(outDir), false);
});


test('event promote warns but writes when routing hints are unresolved', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace, {
    routing_hints: undefined,
  }));

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  delete event.routing_hints;
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`);

  const result = runNoesis(['event', 'promote', eventPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);
  const request = JSON.parse(fs.readFileSync(data.request_path, 'utf8'));

  assert.equal(result.status, 0);
  assert.equal(data.status, 'warning');
  assert.equal(data.summary.error_count, 0);
  assert.equal(request.candidate_items[0].candidate_kind, 'unknown');
  assert.equal(request.candidate_items[0].target_surface, 'unknown');
  assert.equal(request.requested_outputs[0].kind, 'mixed');
  assert.equal(request.requested_outputs[0].target_owner, 'unknown');
});


test('event promote refuses to overwrite existing requests unless forced', (t) => {
  const workspace = tempWorkspace(t);
  const eventPath = writeEvent(workspace, validEvent(workspace));

  runNoesis(['event', 'promote', eventPath], { cwd: workspace });
  const rejected = runNoesis(['event', 'promote', eventPath], { cwd: workspace, check: false });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /promote request already exists/);

  const forced = runNoesis(['event', 'promote', eventPath, '--force', '--json'], { cwd: workspace });
  const data = JSON.parse(forced.stdout);
  assert.equal(data.status, 'ok');
  assert.ok(data.actions.find((action) => action.action === 'wrote' && action.path === data.request_path));
});


test('event command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'event'], { cwd: workspace }).stdout, /Usage: noesis event/);
  assert.match(runNoesis(['help', 'event', 'check'], { cwd: workspace }).stdout, /Usage: noesis event check/);
  assert.match(runNoesis(['help', 'event', 'promote'], { cwd: workspace }).stdout, /Usage: noesis event promote/);
  assert.match(runNoesis(['event', 'help', 'check'], { cwd: workspace }).stdout, /Usage: noesis event check/);
  assert.match(runNoesis(['event', 'help', 'promote'], { cwd: workspace }).stdout, /Usage: noesis event promote/);
  assert.match(runNoesis(['event', 'check', '--help'], { cwd: workspace }).stdout, /Read-only gate/);
  assert.match(runNoesis(['event', 'promote', '--help'], { cwd: workspace }).stdout, /promote-request/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis event check/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis event promote/);
});
