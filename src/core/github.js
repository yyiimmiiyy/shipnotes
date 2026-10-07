'use strict';
// Minimal GitHub REST client: only the calls Shipnotes needs.

const API = 'https://api.github.com';
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function parseRepo(text) {
  const cleaned = String(text || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const repo = (parts[1] || '').replace(/\.git$/i, '');
  if (parts.length < 2 || !NAME.test(parts[0]) || !NAME.test(repo) || /^\.+$/.test(parts[0]) || /^\.+$/.test(repo)) {
    throw new Error('Enter the repository as owner/name, for example octocat/hello-world.');
  }
  return { owner: parts[0], repo };
}

function createGitHub({ token, fetchImpl = fetch } = {}) {
  async function request(path, { method = 'GET', body, notFound } = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Shipnotes' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      let detail = '';
      try {
        const json = await res.json();
        if (json && json.message) detail = json.message;
        if (json && Array.isArray(json.errors) && json.errors[0] && json.errors[0].code) detail += ` (${json.errors[0].field || ''} ${json.errors[0].code})`;
      } catch { /* body was not JSON */ }
      let message = `GitHub returned ${res.status}${detail ? `: ${detail}` : ''}`;
      if (res.status === 401) message = 'GitHub rejected the access token. Check it in Settings.';
      else if (res.status === 404) message = notFound || 'GitHub could not find that. Check the repository name and that your token can see it.';
      else if (res.status === 403 && /not accessible/i.test(detail)) message = 'Your GitHub token is not allowed to do that. Check its permissions in Settings.';
      throw new GitHubError(res.status, message);
    }
    return res.json();
  }

  const base = (owner, repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    // Everything the "from" and "to" pickers need, in one go.
    async listRefs(owner, repo) {
      const [info, releases, tags] = await Promise.all([
        request(base(owner, repo)),
        request(`${base(owner, repo)}/releases?per_page=30`),
        request(`${base(owner, repo)}/tags?per_page=50`)
      ]);
      const published = releases.filter((r) => !r.draft).map((r) => r.tag_name);
      return {
        defaultBranch: info.default_branch,
        latestRelease: published[0] || '',
        tags: [...new Set([...published, ...tags.map((t) => t.name)])]
      };
    },

    // Commits reachable from head but not from base, oldest first.
    async compare(owner, repo, baseRef, headRef, max = 500) {
      const span = `${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`;
      const commits = [];
      let total = 0;
      for (let page = 1; commits.length < max; page++) {
        const data = await request(`${base(owner, repo)}/compare/${span}?per_page=100&page=${page}`, {
          notFound: `GitHub could not compare "${baseRef}" with "${headRef}". Check that both exist in this repository.`
        });
        total = data.total_commits || 0;
        const batch = data.commits || [];
        commits.push(...batch.map((c) => ({
          sha: c.sha,
          message: c.commit ? c.commit.message || '' : '',
          author: c.author ? c.author.login : (c.commit && c.commit.author ? c.commit.author.name : '')
        })));
        if (batch.length < 100) break;
      }
      return { commits: commits.slice(0, max), total: Math.max(total, commits.length) };
    },

    async getPullBrief(owner, repo, number) {
      const p = await request(`${base(owner, repo)}/pulls/${Number(number)}`);
      return {
        number: p.number,
        title: p.title || '',
        body: p.body || '',
        author: p.user ? p.user.login : '',
        labels: (p.labels || []).map((l) => l.name),
        merged: !!p.merged_at
      };
    },

    async createDraftRelease(owner, repo, { tag, name, body, target }) {
      const res = await request(`${base(owner, repo)}/releases`, {
        method: 'POST',
        body: { tag_name: tag, name, body, target_commitish: target, draft: true }
      });
      return { url: res.html_url, id: res.id };
    }
  };
}

module.exports = { createGitHub, parseRepo, GitHubError };
