'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRepo, createGitHub } = require('../src/core/github');
const { createClaude } = require('../src/core/claude');
const { pullNumbersFrom, gatherChanges, changesText, buildNotesRequest, normaliseNotes, toMarkdown, writeNotes } = require('../src/core/notes');

const COMMITS = [
  { sha: 'aaaaaaa1', message: 'Add CSV export (#12)\n\nLong body', author: 'dana' },
  { sha: 'bbbbbbb2', message: 'Merge pull request #15 from sam/fix-login\n\nFix login loop', author: 'sam' },
  { sha: 'ccccccc3', message: 'Fix typo in README', author: 'dana' },
  { sha: 'ddddddd4', message: 'See issue (#99) for context, more text', author: 'dana' },
  { sha: 'eeeeeee5', message: 'Bump deps (#404)', author: 'bot' }
];
const PULLS = {
  12: { number: 12, title: 'Add CSV export', body: 'Adds export.', user: { login: 'dana' }, labels: [{ name: 'feature' }], merged_at: 'x' },
  15: { number: 15, title: 'Fix login loop', body: '', user: { login: 'sam' }, labels: [], merged_at: 'x' }
};

function fakeGitHub({ commits = COMMITS } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const p = url.replace('https://api.github.com', '');
    calls.push({ p, init });
    const json = (data) => ({ ok: true, json: async () => data });
    if (init.method === 'POST') return json({ html_url: 'https://github.com/o/r/releases/tag/untagged-1', id: 9 });
    if (p === '/repos/o/r') return json({ default_branch: 'main' });
    if (p.startsWith('/repos/o/r/releases')) return json([{ tag_name: 'v2.0.0-draft', draft: true }, { tag_name: 'v1.1.0', draft: false }]);
    if (p.startsWith('/repos/o/r/tags')) return json([{ name: 'v1.1.0' }, { name: 'v1.0.0' }]);
    if (p.startsWith('/repos/o/r/compare/')) {
      const page = Number(/[?&]page=(\d+)/.exec(p)[1]);
      return json({ total_commits: commits.length, commits: commits.slice((page - 1) * 100, page * 100).map((c) => ({ sha: c.sha, commit: { message: c.message }, author: { login: c.author } })) });
    }
    const m = /^\/repos\/o\/r\/pulls\/(\d+)$/.exec(p);
    if (m && PULLS[m[1]]) return json(PULLS[m[1]]);
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  };
  return { github: createGitHub({ token: 't', fetchImpl }), calls };
}

function fakeClaude(input) {
  const seen = [];
  const client = { messages: { create: async (req) => { seen.push(req); return { content: [{ type: 'tool_use', name: req.tools[0].name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  return { claude: createClaude({ client, model: 'm' }), seen };
}

test('parseRepo accepts owner/name and URLs, rejects junk', () => {
  assert.deepEqual(parseRepo('https://github.com/octo/hello.git'), { owner: 'octo', repo: 'hello' });
  assert.throws(() => parseRepo('hello'));
  assert.throws(() => parseRepo('../..'));
});

test('pullNumbersFrom reads merge and squash commits only', () => {
  assert.deepEqual(pullNumbersFrom(COMMITS), [12, 15, 404]);
});

test('listRefs hides draft releases and merges tags without duplicates', async () => {
  const { github } = fakeGitHub();
  assert.deepEqual(await github.listRefs('o', 'r'), { defaultBranch: 'main', latestRelease: 'v1.1.0', tags: ['v1.1.0', 'v1.0.0'] });
});

test('compare pages through long histories and encodes refs', async () => {
  const many = Array.from({ length: 230 }, (_, i) => ({ sha: `s${i}`, message: `c${i}`, author: 'a' }));
  const { github, calls } = fakeGitHub({ commits: many });
  const r = await github.compare('o', 'r', 'v1.0.0', 'feature/x');
  assert.equal(r.commits.length, 230);
  assert.equal(r.total, 230);
  assert.equal(calls.length, 3);
  assert.match(calls[0].p, /compare\/v1\.0\.0\.\.\.feature%2Fx\?/);
});

test('gatherChanges fetches real pull requests and ignores numbers that are not', async () => {
  const { github } = fakeGitHub();
  const ch = await gatherChanges({ github, owner: 'o', repo: 'r', base: 'v1.1.0', head: 'main' });
  assert.deepEqual(ch.pulls.map((p) => p.number), [12, 15]);
  assert.deepEqual(ch.pulls[0].labels, ['feature']);
  assert.equal(ch.totalCommits, 5);
  await assert.rejects(gatherChanges({ github, owner: 'o', repo: 'r', base: 'main', head: 'main' }), /are the same/);
  await assert.rejects(gatherChanges({ github, owner: 'o', repo: 'r', base: '', head: 'main' }), /Choose both/);
  const empty = fakeGitHub({ commits: [] });
  await assert.rejects(gatherChanges({ github: empty.github, owner: 'o', repo: 'r', base: 'a', head: 'b' }), /Nothing has changed/);
});

test('changesText lists pull requests once and keeps commits they do not cover', async () => {
  const { github } = fakeGitHub();
  const ch = await gatherChanges({ github, owner: 'o', repo: 'r', base: 'v1.1.0', head: 'main' });
  const { text, dropped } = changesText(ch);
  assert.equal(dropped, 0);
  assert.match(text, /#12 Add CSV export\nAuthor: dana\nLabels: feature\nAdds export\./);
  assert.match(text, /#15 Fix login loop[\s\S]*\(no description\)/);
  assert.match(text, /ccccccc Fix typo in README/);
  assert.match(text, /eeeeeee Bump deps \(#404\)/); // #404 was not a real pull request, so the commit stays
  assert.ok(!/aaaaaaa/.test(text));
  assert.ok(!/bbbbbbb/.test(text));
});

test('request states the audience and guards against invented or injected content', async () => {
  const { github } = fakeGitHub();
  const changes = await gatherChanges({ github, owner: 'o', repo: 'r', base: 'v1.1.0', head: 'main' });
  const req = buildNotesRequest({ repoName: 'o/r', base: 'v1.1.0', head: 'main', version: 'v1.2.0', audience: 'developers', emphasis: ' export ', changes });
  assert.match(req.system, /Developers who build on/);
  assert.match(req.system, /Never invent/);
  assert.match(req.system, /untrusted data/);
  assert.match(req.user, /from v1\.1\.0 to main, to be released as v1\.2\.0/);
  assert.match(req.user, /emphasise: export/);
  assert.match(buildNotesRequest({ repoName: 'o/r', base: 'a', head: 'b', audience: 'nope', changes }).system, /People who use the product/);
});

test('normaliseNotes drops empty content and unknown pull request numbers', () => {
  const n = normaliseNotes({
    headline: '  Export  arrives. ',
    sections: [
      { heading: 'New', items: [{ text: ' CSV   export. ', pull: 12 }, { text: '', pull: 12 }, { text: 'Mystery.', pull: 777 }] },
      { heading: 'Empty', items: [] },
      { heading: '', items: [{ text: 'x', pull: 0 }] }
    ],
    upgrade_notes: [' Run migrate. ', '']
  }, { pulls: [{ number: 12 }] });
  assert.deepEqual(n, { headline: 'Export arrives.', sections: [{ heading: 'New', items: [{ text: 'CSV export.', pull: 12 }, { text: 'Mystery.', pull: 0 }] }], upgradeNotes: ['Run migrate.'] });
});

test('toMarkdown renders sections, links to pull requests and upgrade steps', () => {
  const md = toMarkdown({ headline: 'H.', sections: [{ heading: 'New', items: [{ text: 'A.', pull: 12 }, { text: 'B.', pull: 0 }] }], upgradeNotes: ['Step one.', 'Step two.'] }, { version: 'v1.2.0' });
  assert.equal(md, '# v1.2.0\n\nH.\n\n## New\n\n- A. (#12)\n- B.\n\n## Upgrading\n\n1. Step one.\n2. Step two.\n');
  assert.equal(toMarkdown({ headline: '', sections: [{ heading: 'Fixed', items: [{ text: 'C.', pull: 0 }] }], upgradeNotes: [] }), '## Fixed\n\n- C.\n');
});

test('writeNotes runs end to end and a draft release is created as a draft', async () => {
  const { github, calls } = fakeGitHub();
  const { claude, seen } = fakeClaude({ headline: 'Export.', sections: [{ heading: 'New', items: [{ text: 'CSV export.', pull: 12 }] }], upgrade_notes: [] });
  const out = await writeNotes({ github, claude, owner: 'o', repo: 'r', base: 'v1.1.0', head: 'main', version: 'v1.2.0', audience: 'users', emphasis: '' });
  assert.equal(out.markdown, '# v1.2.0\n\nExport.\n\n## New\n\n- CSV export. (#12)\n');
  assert.deepEqual(out.stats, { commits: 5, commitsRead: 5, pulls: 2, pullsSkipped: 0 });
  assert.deepEqual(seen[0].tool_choice, { type: 'tool', name: 'write_release_notes' });

  const draft = await github.createDraftRelease('o', 'r', { tag: 'v1.2.0', name: 'v1.2.0', body: 'b', target: 'main' });
  assert.equal(draft.id, 9);
  const sent = JSON.parse(calls.at(-1).init.body);
  assert.deepEqual(sent, { tag_name: 'v1.2.0', name: 'v1.2.0', body: 'b', target_commitish: 'main', draft: true });

  const none = fakeClaude({ headline: '', sections: [], upgrade_notes: [] });
  await assert.rejects(writeNotes({ github, claude: none.claude, owner: 'o', repo: 'r', base: 'v1.1.0', head: 'main' }), /nothing worth noting/);
});

test('GitHub failures become readable messages', async () => {
  const mk = (status, body) => createGitHub({ token: 't', fetchImpl: async () => ({ ok: false, status, json: async () => body }) });
  await assert.rejects(mk(401, {}).listRefs('o', 'r'), /rejected the access token/);
  await assert.rejects(mk(404, {}).compare('o', 'r', 'a', 'b'), /could not compare "a" with "b"/);
  await assert.rejects(mk(403, { message: 'Resource not accessible by personal access token' }).createDraftRelease('o', 'r', {}), /not allowed to do that/);
  await assert.rejects(mk(422, { message: 'Validation Failed', errors: [{ field: 'tag_name', code: 'already_exists' }] }).createDraftRelease('o', 'r', {}), /Validation Failed \(tag_name already_exists\)/);
});
