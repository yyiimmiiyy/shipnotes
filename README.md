# Shipnotes

Release notes for your GitHub project, written by Claude from what actually changed.

Shipnotes is a small Windows app. You pick a repository and two points in its history, usually your last release and your main branch. It reads the pull requests and commits in between, and Claude turns them into release notes you can edit, copy, save, or send to GitHub as a draft release.

Shipnotes is free and open source, from [Goodhope Technologies](https://goodhopetechnologies.com).

## What it does

- **Reads the real history.** Merged pull requests, their descriptions and labels, plus any commits that did not come through a pull request.
- **Writes for your audience.** Choose notes for the people who use the product, or for developers. Tell it what to emphasise if one change is the headline.
- **Sticks to the record.** Claude is told to describe only changes that appear in the history, to group related ones, and to leave out chores nobody outside the team cares about. Each item links back to its pull request.
- **Flags what breaks.** Breaking changes get their own section, with the steps needed to upgrade.
- **Leaves publishing to you.** The notes open in an editor. From there you can copy them, save a Markdown file, or create a *draft* release on GitHub. Nothing is published, and no tag is created, until you publish the draft yourself.

## Install

Download the latest `.msi` from the [Releases](../../releases) page and run it. Windows 10 or later, 64-bit.

The installer is not code-signed yet, so Windows SmartScreen will warn that the publisher is unknown. Choose **More info**, then **Run anyway**.

## Set up

Shipnotes needs two keys, entered on the Settings screen:

1. **An Anthropic API key**, from <https://console.anthropic.com/settings/keys>. Writing notes is billed to this key.
2. **A GitHub fine-grained access token**, from <https://github.com/settings/personal-access-tokens/new>, with these repository permissions:
   - Contents: read (or read and write, if you want to create draft releases)
   - Pull requests: read

Both are encrypted on your computer using Windows' own credential protection.

## Privacy

Shipnotes has no server. The app talks to two services only:

- **GitHub**, to read the repository's history and to create the draft releases you ask for.
- **Anthropic**, to which it sends the pull request titles and descriptions and the commit messages for the range you chose, so Claude can write the notes. It does not send your source code.

## Limits

- GitHub only, for now.
- It reads up to 500 commits and 80 pull requests per run, and says so when a range is larger.
- It finds pull requests from GitHub's standard merge and squash commit messages. Rebase-merged pull requests appear as plain commits.
- Claude can be wrong. Read the notes against what you shipped before publishing.

## Build from source

```
npm install
npm test
npm start        # run the app
npm run dist     # build the MSI (Windows only)
```

Running the "Build installer" workflow on GitHub Actions builds the MSI and attaches it to a release named after the version in `package.json`.

## Licence

MIT. See [LICENSE](LICENSE).
