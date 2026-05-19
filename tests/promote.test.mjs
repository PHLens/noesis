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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `noesis-promote-${process.pid}-${counter}-`));
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
  const requestId = typeof request.request_id === 'string' ? request.request_id : 'request';
  const requestPath = path.join(requestDir, `${requestId}.json`);
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return requestPath;
}


function validRequest(workspace, overrides = {}) {
  return mergeObjects({
    schema_version: '0.1',
    request_id: '2026-05-19T06-00-00Z__promote',
    created_at: '2026-05-19T06:00:00Z',
    workspace,
    trigger: {
      kind: 'user_request',
      summary: 'User asked to gate a durable workflow correction.',
      requested_by: '@Percy',
    },
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:59062ab8',
        summary: 'Task thread defining the promote-request gate.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Add a read-only promote-request gate before proposal generation.',
        evidence: 'The HS workflow needs a case-to-gate-to-proposal boundary.',
        candidate_kind: 'eval',
        target_surface: 'evals',
        risk: 'medium',
        review_required: true,
        reason: 'Future promote requests should be checked before proposal artifacts are generated.',
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
      scenario: 'A valid promote request is checked through noesis promote check --json.',
      acceptance: 'The command exits 0, reports no errors, and records no downstream writes.',
    },
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


test('promote check accepts a valid request and stays read-only', (t) => {
  const workspace = tempWorkspace(t);
  const proposals = path.join(workspace, '.noesis', 'proposals');
  fs.mkdirSync(proposals, { recursive: true });
  const requestPath = writeRequest(workspace, validRequest(workspace));
  const before = snapshot(workspace);

  const result = runNoesis(['promote', 'check', requestPath, '--json'], { cwd: workspace });
  const after = snapshot(workspace);
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 'ok');
  assert.equal(data.summary.error_count, 0);
  assert.equal(data.summary.warning_count, 0);
  assert.equal(data.downstream_execution, 'not-run');
  assert.deepEqual(data.writes, []);
  assert.deepEqual(after, before);
});


test('promote check fails when required fields are missing', (t) => {
  const workspace = tempWorkspace(t);
  const requestPath = writeRequest(workspace, {
    schema_version: '0.1',
    request_id: 'missing-fields',
  });

  const result = runNoesis(['promote', 'check', requestPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.ok(data.summary.error_count > 0);
  assert.ok(data.checks.find((item) => item.id === 'request.source_refs'));
  assert.ok(data.checks.find((item) => item.id === 'request.gate_policy'));
});


test('promote check rejects apply policy and high risk without review', (t) => {
  const workspace = tempWorkspace(t);
  const request = validRequest(workspace, {
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Install a broad runtime skill automatically.',
        evidence: 'The user asked for a missing capability.',
        candidate_kind: 'skill',
        target_surface: 'skill-manager',
        risk: 'high',
        review_required: false,
        reason: 'A reusable skill may be needed.',
      },
    ],
    gate_policy: {
      mode: 'proposal_only',
      allow_apply: true,
      review_required: false,
    },
  });
  const requestPath = writeRequest(workspace, request);

  const result = runNoesis(['promote', 'check', requestPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.ok(data.checks.find((item) => item.id === 'request.candidate_items[0].risk.high_review'));
  assert.ok(data.checks.find((item) => item.id === 'request.gate_policy.allow_apply.boundary'));
  assert.ok(data.checks.find((item) => item.id === 'request.gate_policy.review_required.boundary'));
});


test('promote check rejects transcript retention fields', (t) => {
  const workspace = tempWorkspace(t);
  const request = validRequest(workspace, {
    source_refs: [
      {
        kind: 'slock_thread',
        ref: '#heuristic-system:59062ab8',
        summary: 'Thread reference only.',
        raw_transcript: 'full conversation should not be retained here',
      },
    ],
  });
  const requestPath = writeRequest(workspace, request);

  const result = runNoesis(['promote', 'check', requestPath, '--json'], { cwd: workspace, check: false });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.status, 'failed');
  assert.ok(data.checks.find((item) => item.id === 'request.source_refs[0].raw_transcript'));
});


test('promote check can pass with warnings for unresolved routing detail', (t) => {
  const workspace = tempWorkspace(t);
  const request = validRequest(workspace, {
    source_refs: [
      {
        kind: 'file',
        ref: '/home/cambricon/private/path/note.md',
        summary: 'Private absolute path should be sanitized before planning.',
      },
    ],
    candidate_items: [
      {
        id: 'item-1',
        summary: 'Unclear durable residue.',
        evidence: 'Needs owner routing.',
        candidate_kind: 'unknown',
        target_surface: 'unknown',
        risk: 'low',
        review_required: true,
        reason: 'The gate should warn but allow triage to continue.',
      },
    ],
    expected_regression: undefined,
  });
  delete request.expected_regression;
  const requestPath = writeRequest(workspace, request);

  const result = runNoesis(['promote', 'check', requestPath, '--json'], { cwd: workspace });
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(data.status, 'warning');
  assert.equal(data.summary.error_count, 0);
  assert.ok(data.summary.warning_count >= 3);
  assert.ok(data.checks.find((item) => item.id === 'request.source_refs[0].ref.private_path'));
  assert.ok(data.checks.find((item) => item.id === 'request.candidate_items[0].candidate_kind.unknown'));
  assert.ok(data.checks.find((item) => item.id === 'request.expected_regression'));
});


test('promote command help is available', (t) => {
  const workspace = tempWorkspace(t);

  assert.match(runNoesis(['help', 'promote'], { cwd: workspace }).stdout, /Usage: noesis promote/);
  assert.match(runNoesis(['help', 'promote', 'check'], { cwd: workspace }).stdout, /Usage: noesis promote check/);
  assert.match(runNoesis(['promote', 'help', 'check'], { cwd: workspace }).stdout, /Usage: noesis promote check/);
  assert.match(runNoesis(['promote', 'check', '--help'], { cwd: workspace }).stdout, /Read-only gate/);
  assert.match(runNoesis(['--help'], { cwd: workspace }).stdout, /noesis promote check/);
});
