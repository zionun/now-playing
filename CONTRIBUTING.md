# Contributing

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the
  approach.
- Security problems: see [SECURITY.md](SECURITY.md), not a public issue.

## Development

See [Development](docs/GUIDE.md#development) in the guide for the setup and the project
structure.

## Pull requests

- Branch from `main` and open the pull request against `main`; it is merged once CI is
  green and it has been reviewed.
- Before pushing, run in both `server/` and `client/`:
  ```bash
  npm run lint
  npm run format:check
  npm test
  ```
  and `npm run build` in `client/`.
- Code, comments, logs and commit messages are in English. Interface text goes in
  `client/src/i18n/messages.js`, in every language (a test checks that the keys match).
- Commit messages: a short summary line (at most 50 characters, e.g.
  `fix(kiosk): ...`), a blank line, then what changed and why, wrapped at 72 characters.
- Add or update tests for the behaviour you change, and a line in the `Unreleased`
  section of [CHANGELOG.md](CHANGELOG.md).

By contributing you agree that your work is released under the [MIT License](LICENSE).
