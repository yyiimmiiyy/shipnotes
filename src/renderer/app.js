'use strict';
/* Shipnotes window. Talks to the main process only through window.shipnotes. */

const api = window.shipnotes;
const $ = (id) => document.getElementById(id);

const state = {
  view: 'notes',
  repo: '',
  refs: null,          // { defaultBranch, latestRelease, tags }
  settings: null,
  form: { base: '', head: '', version: '', audience: 'users', emphasis: '' },
  result: null,        // { markdown, stats }
  markdown: '',
  draft: null,
  busy: ''
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function call(fn, payload) {
  const res = await fn(payload);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function notify(message, good) {
  const n = $('notice');
  n.textContent = message || '';
  n.hidden = !message;
  n.className = good ? 'notice good' : 'notice';
}

async function guard(label, fn) {
  if (state.busy) return;
  state.busy = label;
  notify('');
  render();
  try {
    await fn();
  } catch (err) {
    notify(err.message);
  } finally {
    state.busy = '';
    render();
  }
}

/* ---------- actions ---------- */

async function loadRepo(text) {
  await guard('Loading', async () => {
    const data = await call(api.loadRepo, { repo: text });
    state.repo = data.repo;
    state.refs = data;
    state.form.base = data.latestRelease || data.tags[0] || '';
    state.form.head = data.defaultBranch;
    state.form.version = '';
    state.result = null;
    state.draft = null;
    $('repo').value = data.repo;
    if (!data.tags.length) notify('This repository has no tags or releases yet. Enter a commit or branch to start from.', true);
  });
}

async function write() {
  await guard('Writing', async () => {
    state.result = await call(api.writeNotes, { repo: state.repo, ...state.form });
    state.markdown = state.result.markdown;
    state.draft = null;
  });
}

async function createDraft() {
  const tag = state.form.version.trim();
  if (!tag) { notify('Enter a version above, for example v1.2.0, to create a draft release.'); return; }
  const ok = window.confirm(`Create a draft release "${tag}" on ${state.repo}?\n\nA draft is visible only to people who can edit the repository. Nothing is published, and no tag is created, until you publish it on GitHub.`);
  if (!ok) return;
  await guard('Creating draft', async () => {
    state.draft = await call(api.createDraft, { repo: state.repo, tag, markdown: state.markdown, target: state.form.head });
    notify('Draft release created on GitHub.', true);
  });
}

/* ---------- views ---------- */

const link = (text, url) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal({ url }); } }, text);

function viewNotes() {
  const head = [h('h1', {}, 'Write release notes'),
    h('p', { class: 'lead' }, 'Shipnotes reads the pull requests and commits between two points in a repository, and Claude writes release notes from what changed.')];
  if (!state.repo) return h('div', {}, head, h('p', { class: 'muted' }, 'Enter a GitHub repository above and choose Load.'));

  const f = state.form;
  const set = (key) => (e) => { f[key] = e.target.value; };
  const options = h('datalist', { id: 'refs' }, [state.refs.defaultBranch, ...state.refs.tags].map((t) => h('option', { value: t })));
  const form = h('div', {}, options,
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'base' }, 'Changes since'),
        h('input', { id: 'base', list: 'refs', value: f.base, oninput: set('base'), spellcheck: 'false', placeholder: 'Tag, branch or commit' }),
        h('span', { class: 'hint' }, state.refs.latestRelease ? `Latest release: ${state.refs.latestRelease}` : 'Usually your last release tag.')),
      h('div', { class: 'field' }, h('label', { for: 'head' }, 'Up to'),
        h('input', { id: 'head', list: 'refs', value: f.head, oninput: set('head'), spellcheck: 'false', placeholder: 'Tag, branch or commit' }),
        h('span', { class: 'hint' }, 'A branch for an upcoming release, or a tag for one already made.')),
      h('div', { class: 'field' }, h('label', { for: 'version' }, 'Version being released (optional)'),
        h('input', { id: 'version', value: f.version, oninput: set('version'), spellcheck: 'false', placeholder: 'v1.2.0' })),
      h('div', { class: 'field' }, h('label', { for: 'aud' }, 'Written for'),
        h('select', { id: 'aud', onchange: set('audience') },
          h('option', { value: 'users', selected: f.audience === 'users' }, 'People who use the product'),
          h('option', { value: 'developers', selected: f.audience === 'developers' }, 'Developers')))),
    h('div', { class: 'field wide' }, h('label', { for: 'emph' }, 'Anything to emphasise? (optional)'),
      h('textarea', { id: 'emph', value: f.emphasis, oninput: set('emphasis'), placeholder: 'For example: the new export feature is the headline.' })),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: write, disabled: !!state.busy }, state.busy === 'Writing' ? 'Writing…' : state.result ? 'Write again' : 'Write release notes'),
      state.busy === 'Writing' ? h('span', { class: 'muted' }, h('span', { class: 'spin' }), 'Claude is reading the changes.') : null));

  if (!state.result) return h('div', {}, head, form);

  const s = state.result.stats;
  const facts = [`${s.commits} commit${s.commits === 1 ? '' : 's'}`, `${s.pulls} pull request${s.pulls === 1 ? '' : 's'} read`];
  if (s.commitsRead < s.commits) facts.push(`only the first ${s.commitsRead} commits were read`);
  if (s.pullsSkipped) facts.push(`${s.pullsSkipped} pull requests not read`);

  return h('div', {}, head, form, h('hr', {}),
    h('h1', {}, 'Draft'),
    h('p', { class: 'stats' }, `${facts.join(' · ')}. Check the notes against what you shipped; edit them here before using them.`),
    h('textarea', { class: 'md', 'aria-label': 'Release notes in Markdown', spellcheck: 'true', value: state.markdown, oninput: (e) => { state.markdown = e.target.value; } }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: !!state.busy, onclick: () => guard('Copying', async () => { await call(api.copyText, { markdown: state.markdown }); notify('Copied to the clipboard.', true); }) }, 'Copy'),
      h('button', { class: 'btn ghost', disabled: !!state.busy, onclick: () => guard('Saving', async () => { const r = await call(api.saveFile, { markdown: state.markdown, version: f.version }); if (r.saved) notify(`Saved to ${r.path}`, true); }) }, 'Save as file'),
      state.draft
        ? link('Open the draft release on GitHub', state.draft.url)
        : h('button', { class: 'btn ghost', disabled: !!state.busy, onclick: createDraft }, state.busy === 'Creating draft' ? 'Creating…' : 'Create draft release on GitHub')));
}

function viewSettings() {
  const s = state.settings || { models: [] };
  const fields = {};
  const save = () => guard('Saving', async () => {
    await call(api.saveSettings, { model: fields.model.value, anthropicKey: fields.key.value, githubToken: fields.token.value });
    state.settings = await call(api.getSettings);
    notify('Settings saved.', true);
  });
  return h('div', {},
    h('h1', {}, 'Settings'),
    h('p', { class: 'lead' }, 'Both keys are encrypted on this computer and are sent only to Anthropic and GitHub. Shipnotes has no server of its own.'),
    h('div', { class: 'field' },
      h('label', { for: 'key' }, 'Anthropic API key'),
      fields.key = h('input', { id: 'key', type: 'password', autocomplete: 'off', placeholder: s.hasAnthropicKey ? 'Saved. Enter a new key to replace it.' : 'sk-ant-…' }),
      h('span', { class: 'hint' }, 'Writing notes is billed to this key. ', link('Get a key', 'https://console.anthropic.com/settings/keys'))),
    h('div', { class: 'field' },
      h('label', { for: 'token' }, 'GitHub access token'),
      fields.token = h('input', { id: 'token', type: 'password', autocomplete: 'off', placeholder: s.hasGithubToken ? 'Saved. Enter a new token to replace it.' : 'github_pat_…' }),
      h('span', { class: 'hint' }, 'A fine-grained token with Contents: read and Pull requests: read. Creating draft releases also needs Contents: write. ', link('Create a token', 'https://github.com/settings/personal-access-tokens/new'))),
    h('div', { class: 'field' },
      h('label', { for: 'model' }, 'Claude model'),
      fields.model = h('select', { id: 'model' }, s.models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.label)))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save, disabled: !!state.busy }, 'Save settings')));
}

function render() {
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.view === state.view);
  $('repoStatus').textContent = state.busy === 'Loading' ? 'Loading…' : '';
  $('view').replaceChildren((state.view === 'settings' ? viewSettings : viewNotes)());
}

/* ---------- start ---------- */

$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  notify('');
  render();
});
$('repoBar').addEventListener('submit', (e) => {
  e.preventDefault();
  loadRepo($('repo').value);
});

(async function start() {
  try {
    state.settings = await call(api.getSettings);
    $('repo').value = state.settings.lastRepo || '';
    if (!state.settings.hasAnthropicKey || !state.settings.hasGithubToken) {
      state.view = 'settings';
      notify('Welcome. Add your two keys to get started.', true);
    }
  } catch (err) {
    notify(err.message);
  }
  render();
})();
