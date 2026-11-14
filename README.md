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
  nothing listens on :5173: is the service started?
$ echo $?
1
```

## Install

```sh
brew install ninhache/tap/probe     # macOS, Linux
npm install -g @ninhache/probe      # anywhere with Node >= 22
npx @ninhache/probe check           # no install
```

Use the full name with `npx`: `npx probe` is another package.

## Quick start

1. `probe init` creates `.probe/`.
2. `probe add api -p 3000 --path /health` declares a service.
3. `probe check` checks everything. Exit code is 1 if a service is down.
4. Commit `.probe/config.yml`.

Want `make check` too? See [Makefile](#makefile): it is optional.

## Commands

| Command                                                   | What it does                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `probe init`                                              | Create `.probe/` and the `.gitignore` entries                          |
| `probe add <name> -p <port> [--host] [--path] [--expect]` | Add a service (`--timeout <seconds>` gives it its own timeout)         |
| `probe rm <name>`                                         | Remove a service                                                       |
| `probe ls`                                                | List services                                                          |
| `probe check [name...] [--json] [--timeout <seconds>]`    | Check all services, or the named ones                                  |
| `probe wait [name...] [--json] [--timeout <seconds>]`     | Check again until every service is up, or give up after the timeout    |
| `probe open <name>`                                       | Open the URL of a service in the browser                               |
| `probe curl <name>`                                       | Print the curl command that requests a service                         |
| `probe status`                                            | CLI version, pending migration, Makefile block state, available update |
| `probe sync`                                              | Add or regenerate the Makefile block (optional)                        |
| `probe migrate`                                           | Migrate `.probe/config.yml` to the current schema                      |
| `probe completion <zsh\|bash>`                            | Print the shell completion script                                      |

Exit codes: `0` all up, `1` a service is down, `2` usage or config error.

A service that is down comes with a hint when the cause is a known one: connection refused, timeout, host not
found, unexpected status, certificate rejected after a redirect to https. With `--json` it is the `hint` field,
next to `error`.

`probe wait` is for scripts: `probe wait && pnpm test`. It checks at once, then again after 0.5 s, 1 s, 2 s, 4 s
and every 5 s, for 60 s in total. `--timeout` sets the total, `--interval` the first pause, `--max-interval` the
longest one. Unlike `check --timeout`, which is the time given to each service, `wait --timeout` covers the whole
wait; each check inside it still gets 3 s, or the service's own `timeout`. Progress goes to stderr, the final
report to stdout; exit code `1` names the services still down.

`probe open` uses `open` on macOS and `xdg-open` elsewhere. Without it, the URL is printed and the exit code is
`1`. `probe curl api` prints a command to copy, or to run: `probe curl api | sh`.

`probe` works from any sub-directory: it walks up to the nearest `.probe/`.

## Completion

Tab completes the commands, their options and the names of your services (`probe check a<Tab>`).

```sh
eval "$(probe completion zsh)"     # in ~/.zshrc, after compinit
eval "$(probe completion bash)"    # in ~/.bashrc (macOS: ~/.bash_profile)
```

In zsh you can also save it once instead: `probe completion zsh > ~/.zfunc/_probe`, with `~/.zfunc` in your
`fpath`. It works with the bash 3.2 of macOS.

## Dashboard

`probe` alone, on a terminal, opens a live list of your services and checks them every 2 s
(`probe --interval 5` for another pace). Off a terminal, in CI or in a pipe, nothing changes: use `probe check`.

| Key             | What it does                           |
| --------------- | -------------------------------------- |
| `↑` `↓` `j` `k` | Move                                   |
| `r`             | Check now                              |
| `Enter`         | Open the panel of the selected service |
| `o`             | Options: interval and timeout          |
| `q`             | Quit                                   |

What you change there is saved in `.probe/local.yml`, for your machine only:

```yaml
dashboard: { interval: 5, timeout: 3 }
services:
  db: { skip: true }
```

A skipped service is left out of `probe check`, `probe wait` and the dashboard, and shown as `skipped`. Name it
(`probe check db`) and it is checked anyway.

The panel of a service also sets its timeout. That one is shared: it is written to `.probe/config.yml`, so
commit it.

A change that cannot be saved (a file that is read-only, or not valid YAML) still applies until you quit. The
dashboard shows `not saved: …`, and says it again on stderr when it closes.

## Config

`.probe/config.yml`:

```yaml
schemaVersion: 1
services:
  api: { port: 3000, path: /health }
  front: { port: 5173 }
  admin: { host: 127.0.0.1, port: 8080, expect: [200, 204] }
  db: { port: 5432, timeout: 10 }
```

| Key       | Default     | Meaning                                 |
| --------- | ----------- | --------------------------------------- |
| `port`    | required    | TCP port                                |
| `host`    | `localhost` | Host name or IP                         |
| `path`    | `/`         | Path requested with `GET`               |
| `expect`  | any 2xx     | Expected status, or a list of statuses  |
| `timeout` | 3           | Seconds given to this service to answer |

Which timeout applies: `--timeout` when you pass it, else the service's `timeout`, else 3 s (in the dashboard,
the timeout set in its options). A config with a `timeout` needs `probe` 0.4.0 or later: older versions refuse it.

Redirects are followed and the final status is judged, unless `expect` contains a 3xx: then the first response
is judged as is.

Files in `.probe/`:

- `config.yml`: services. Commit it.
- `lock.yml`: CLI version and hash of the Makefile block. Only there once `probe sync` has run. Commit it.
- `local.yml`: per-machine values (dashboard settings, skipped services). Ignored by git.

Never put secrets in `config.yml` or `lock.yml`.

## Makefile

Optional. `probe sync` writes a block between two markers, in a new `Makefile` or at the end of yours. Everything
outside the block is yours and is never touched. Without a block, no command creates or changes a `Makefile`.

```make
# >>> probe (generated - do not edit, run `probe sync`)
...
# <<< probe
```

Once the block is there, `probe add` and `probe rm` keep it up to date. Commit the `Makefile` and
`.probe/lock.yml`.

Targets: `help`, `check`, `status`, `probe` (opens the [dashboard](#dashboard)) and one `check-<name>` per
service. The block uses `probe` when it is in
your `PATH`, else `npx -y @ninhache/probe@latest`. It works with GNU Make 3.81 (the macOS default).

Edited the block by hand? `probe status` says so and `probe add` / `probe rm` leave it alone. `probe sync`
restores it.

A newer `probe` can add targets to the block: `make probe` came with 0.6.0. A block written before that is
reported as `outdated` by `probe status`. Run `probe sync` once to get the new targets.

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
`sha256` (secret `HOMEBREW_TAP_TOKEN`), which merges itself once the tap's CI is green.
It also creates the GitHub Release, with notes listing the pull requests merged since the previous tag.

What changed in each version: [Releases](https://github.com/Ninhache/probe/releases).

## License

MIT
