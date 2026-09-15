const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/catalog/revisionData.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const helpers = {};
new Function('exports', compiled.outputText)(helpers);
const { revisionChanges, prepareRevisionRestore, canEditRevision } = helpers;

test('history includes structural content, authority IDs and complete translated text', () => {
  const before = { subjects: [{ work_id: 'song' }], contents: [], translations: { ja: { title: 'Song', summary: 'old' } }, pictures: [{ url: 'cover', caption: { en: 'old' } }] };
  const after = { subjects: [{ work_id: 'song', attributes: { role: 'bonus' } }], contents: [{ expression_id: 'recording' }], translations: { ja: { title: 'Song', summary: 'new' } }, pictures: [{ url: 'cover', caption: { en: 'new' } }], external_ids: { isrc: 'code' } };
  const diff = revisionChanges(before, after);
  assert.deepEqual(Object.keys(diff).sort(), ['contents', 'external_ids', 'pictures', 'subjects', 'translations.ja']);
  assert.equal(diff['translations.ja'].new.summary, 'new');
});

test('object key order is irrelevant but list order is meaningful', () => {
  assert.deepEqual(revisionChanges({ attributes: { data: { a: 1, b: 2 } } }, { attributes: { data: { b: 2, a: 1 } } }), {});
  assert.ok(revisionChanges({ contents: ['a', 'b'] }, { contents: ['b', 'a'] }).contents);
  assert.deepEqual(revisionChanges({ version: 1, updated_at: 'old' }, { version: 2, updated_at: 'new' }), {});
});

const current = { id: 'entity', kind: 'track', version: 6, status: 'published', created_by: 'owner', medium_id: 'disc', parent_id: 'side', title: 'Current', attributes: { number: 2 }, contents: [] };
const snapshot = { id: 'entity', kind: 'track', version: 3, status: 'draft', created_by: 'other', medium_id: 'disc', title: 'Historical', attributes: { number: 1 }, contents: [{ expression_id: 'recording', locator: { relative_to: 'track' } }] };

test('restore retains latest lock, lifecycle and owner, restores complete content', () => {
  const restored = prepareRevisionRestore(current, snapshot);
  assert.equal(restored.version, 6);
  assert.equal(restored.status, 'published');
  assert.equal(restored.created_by, 'owner');
  assert.equal(restored.title, 'Historical');
  assert.equal(restored.parent_id, undefined);
  assert.deepEqual(restored.contents, snapshot.contents);
  restored.attributes.number = 9;
  assert.equal(snapshot.attributes.number, 1);
  assert.equal(current.attributes.number, 2);
});

test('restore rejects other identities, incompatible scopes and retired entities', () => {
  for (const patch of [{ id: 'other' }, { kind: 'work' }, { medium_id: 'other' }, { status: 'merged' }]) {
    assert.throws(() => prepareRevisionRestore(current, { ...snapshot, ...patch }), /revision_incompatible/);
  }
  assert.throws(() => prepareRevisionRestore({ ...current, status: 'deleted' }, snapshot));
});

test('restore eligibility respects the existing editing roles', () => {
  assert.equal(canEditRevision(current, undefined), false);
  assert.equal(canEditRevision(current, { id: 'other', role: 'editor' }), true);
  assert.equal(canEditRevision({ ...current, status: 'draft' }, { id: 'other', role: 'editor' }), false);
  assert.equal(canEditRevision(current, { id: 'owner', role: 'user' }), false);
  assert.equal(canEditRevision(current, { id: 'owner', role: 'editor' }), true);
  assert.equal(canEditRevision(current, { id: 'admin', role: 'admin' }), true);
  assert.equal(canEditRevision({ ...current, status: 'draft' }, { id: 'owner', role: 'user' }), true);
});
