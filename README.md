# probe

[![npm](https://img.shields.io/npm/v/@ninhache/probe)](https://www.npmjs.com/package/@ninhache/probe)
[![Homebrew](https://img.shields.io/badge/homebrew-ninhache%2Ftap-orange)](https://github.com/Ninhache/homebrew-tap)
[![CI](https://github.com/Ninhache/probe/actions/workflows/ci.yml/badge.svg)](https://github.com/Ninhache/probe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@ninhache/probe)](LICENSE)

Declare your project's local services once. Check they are up with one command, or with `make check`.

```console
$ probe check
✓ api    http://localhost:3000/health  200  12ms
✗ front  http://localhost:5173/        connection refused
$ echo $?
1
```

## Install

```sh
brew install ninhache/tap/probe     # macOS, Linux
npm install -g @ninhache/probe      # anywhere with Node >= 20
npx @ninhache/probe check           # no install
```

Use the full name with `npx`: `npx probe` is another package.

## Quick start

1. `probe init` creates `.probe/` and a `probe` block in your `Makefile`.
2. `probe add api -p 3000 --path /health` declares a service.
3. `probe check` or `make check` checks everything. Exit code is 1 if a service is down.
4. Commit `.probe/config.yml`, `.probe/lock.yml` and the `Makefile`.

## Commands

| Command                                                   | What it does                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `probe init`                                              | Create `.probe/`, the Makefile block and the `.gitignore` entries      |
| `probe add <name> -p <port> [--host] [--path] [--expect]` | Add a service                                                          |
| `probe rm <name>`                                         | Remove a service                                                       |
| `probe ls`                                                | List services                                                          |
| `probe check [name...] [--json] [--timeout <seconds>]`    | Check all services, or the named ones                                  |
| `probe status`                                            | CLI version, pending migration, Makefile block state, available update |
| `probe sync`                                              | Regenerate the Makefile block                                          |
| `probe migrate`                                           | Migrate `.probe/config.yml` to the current schema                      |

Exit codes: `0` all up, `1` a service is down, `2` usage or config error.

`probe` works from any sub-directory: it walks up to the nearest `.probe/`.

## Config

`.probe/config.yml`:

```yaml
schemaVersion: 1
services:
  api: { port: 3000, path: /health }
  front: { port: 5173 }
  admin: { host: 127.0.0.1, port: 8080, expect: [200, 204] }
```

| Key      | Default     | Meaning                                |
| -------- | ----------- | -------------------------------------- |
| `port`   | required    | TCP port                               |
| `host`   | `localhost` | Host name or IP                        |
| `path`   | `/`         | Path requested with `GET`              |
| `expect` | any 2xx     | Expected status, or a list of statuses |

Files in `.probe/`:

- `config.yml`: services. Commit it.
- `lock.yml`: CLI version and hash of the Makefile block. Commit it.
- `local.yml`: per-machine values. Ignored by git. Unused for now.

Never put secrets in `config.yml` or `lock.yml`.

## Makefile

`probe init` and `probe sync` write a block between two markers. Everything outside the block is yours and is
never touched.

```make
# >>> probe (generated - do not edit, run `probe sync`)
...
# <<< probe
```

Targets: `help`, `check`, `status` and one `check-<name>` per service. The block uses `probe` when it is in
your `PATH`, else `npx -y @ninhache/probe@latest`. It works with GNU Make 3.81 (the macOS default).

Edited the block by hand? `probe status` says so, `probe sync` restores it.

## Migrations

`config.yml` carries a `schemaVersion`. When a newer `probe` needs a newer schema, the first command you run:

1. Backs up the file to `.probe/config.v<n>.bak.yml` (ignored by git).
2. Migrates it, keeping your comments.
3. Prints what it did.

Commit the migrated `config.yml` so your teammates get it.

- `probe status` shows a pending migration without applying it.
- A config written by a newer `probe` is refused with a message: upgrade `probe`.

## Updates

`probe` looks for a newer version at most once a day, in the background, and prints one line when there is one.
It never updates itself. Turn it off with `PROBE_NO_UPDATE_CHECK=1`. It is off when `CI` is set.

## Development

```sh
pnpm install
pnpm test        # builds, then runs the tests
pnpm lint
```

Try it on the demo project:

```sh
pnpm build
cd examples/demo
node server.mjs &
make check PROBE="node ../../dist/cli.js"
```

Release: bump `version` in `package.json`, merge, then push a `v<version>` tag. The Release workflow publishes
to npm through trusted publishing: no token, the package trusts this repo's `release.yml` (set on npmjs.com,
package Settings, Trusted Publisher). It then opens a PR on `ninhache/homebrew-tap` with the new `url` and
`sha256` (secret `HOMEBREW_TAP_TOKEN`): merge it once the tap's CI is green.

## License

MIT
