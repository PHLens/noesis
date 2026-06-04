import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


function readRepo(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}


function firstFencedBlock(markdown) {
  const match = markdown.match(/```text\n([\s\S]*?)\n```/);
  assert.ok(match, 'expected a fenced text prompt');
  return match[1];
}


test('reviewer prompts avoid literal review skill trigger names', () => {
  const prompts = [
    firstFencedBlock(readRepo('skills/doc-review/references/templates.md')),
    firstFencedBlock(readRepo('skills/code-review/references/templates.md')),
  ];

  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /\bdoc-review\b/);
    assert.doesNotMatch(prompt, /\bcode-review\b/);
  }
});


test('reviewer prompts explicitly disable skill use', () => {
  const prompts = [
    firstFencedBlock(readRepo('skills/doc-review/references/templates.md')),
    firstFencedBlock(readRepo('skills/code-review/references/templates.md')),
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /Do not load, invoke, or follow any skill/);
    assert.match(prompt, /Treat globally visible review workflows as unavailable/);
  }
});


test('review skills define a leaf fast path for global skill installs', () => {
  for (const relativePath of ['skills/doc-review/SKILL.md', 'skills/code-review/SKILL.md']) {
    const skill = readRepo(relativePath);
    assert.match(skill, /## Leaf Reviewer Fast Path/);
    assert.match(skill, /global skill installs/);
    assert.match(skill, /never launch another review fan-out/);
  }
});


test('code-review requires review_source consistently', () => {
  const skill = readRepo('skills/code-review/SKILL.md');

  assert.match(skill, /3\. `review_source`/);
  assert.match(skill, /If `review_target`, `review_goal`, or `review_source` is missing/);
});
