# probe

[![npm](https://img.shields.io/npm/v/@ninhache/probe)](https://www.npmjs.com/package/@ninhache/probe)
[![Homebrew](https://img.shields.io/badge/homebrew-ninhache%2Ftap-orange)](https://github.com/Ninhache/homebrew-tap)
[![CI](https://github.com/Ninhache/probe/actions/workflows/ci.yml/badge.svg)](https://github.com/Ninhache/probe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@ninhache/probe)](LICENSE)

Declare your project's local services once. Check they are up with one command.

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

## Windows

probe runs on Windows from PowerShell or Windows Terminal, installed with npm like anywhere else.

- The [Makefile](docs/features/makefile.md) needs `make` (Git Bash, WSL, or a make you install). Without it, probe
  says so and points to `probe check`, which does the same.
- For a [command service](docs/config.md#command-services), prefer the list form. A `.cmd` program (`npm`, `pnpm`)
  needs the string form.
- Shell completion: `probe completion powershell | Out-String | Invoke-Expression` (see [completion](docs/features/completion.md)).
- `probe doctor` names the process that holds a port, and the dashboard's notifications are Windows toasts.

## Quick start

1. `probe init` creates `.probe/` and offers the services it finds in the project.
2. `probe add api -p 3000 --path /health` declares one by hand.
3. `probe check` checks everything. Exit code is 1 if a service is down.
4. Commit `.probe/config.yml`: your teammates get the same checks.

## Commands

| Command            | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `probe`            | Open the [dashboard](docs/features/dashboard.md)       |
| `probe init`       | Create `.probe/` in this directory                     |
| `probe add <name>` | Add a service                                          |
| `probe rm <name>`  | Remove a service                                       |
| `probe ls`         | List services                                          |
| `probe check`      | Check all services, or the named ones                  |
| `probe wait`       | Check again until every service is up                  |
| `probe doctor`     | Say why a service is down                              |
| `probe open`       | Open the URL of a service in the browser               |
| `probe curl`       | Print the curl command that requests a service         |
| `probe var`        | Set a variable the headers or env use, on this machine |
| `probe env`        | List the environments, or create one                   |
| `probe status`     | Version, pending migration, Makefile block, update     |
| `probe sync`       | Add or regenerate the Makefile block                   |
| `probe migrate`    | Migrate `.probe/config.yml` to the current schema      |
| `probe completion` | Print the shell completion script                      |

Every option of every command: [docs/commands.md](docs/commands.md), or `probe <command> --help`.

Exit codes: `0` all up, `1` a service is down, `2` usage or config error.

## Features

| Feature                                               | In one line                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| [Dashboard](docs/features/dashboard.md)               | A live screen of your services: add, edit, inspect, save a trace   |
| [Discover](docs/features/discover.md)                 | `probe init` proposes the services of your compose file, `.env`... |
| [Wait](docs/features/wait.md)                         | `probe wait && pnpm test`: go on once everything is up             |
| [Doctor](docs/features/doctor.md)                     | Who holds the port, which container is stopped                     |
| [Environments](docs/features/environments.md)         | `--env prod`: the same checks elsewhere, editable in the dashboard |
| [Command services](docs/config.md#command-services)   | `type: command`: up when a command exits 0, e.g. `pg_isready`      |
| [Database services](docs/config.md#database-services) | `type: postgres`, `mysql`, `redis`: up when the client logs in     |
| [Tags](docs/features/tags.md)                         | `probe check --tag back`: check a group of services                |
| [Parameters](docs/features/parameters.md)             | One tenant or API version for every service: `--set tenant=acme`   |
| [Headers and secrets](docs/features/headers.md)       | Check a service behind an API key without writing the key in git   |
| [Makefile](docs/features/makefile.md)                 | `make check`, kept up to date for you                              |
| [Completion](docs/features/completion.md)             | Tab completes commands, options and service names                  |

## Config

```yaml
# .probe/config.yml
schemaVersion: 1
services:
  api: { port: 3000, path: /health }
  front: { port: 5173, hint: "start it with: make front" }
  secure: { url: https://localhost:8443/health }
```

Every key, and the files of `.probe/`: [docs/config.md](docs/config.md).

## More

- What changed in each version: [Releases](https://github.com/Ninhache/probe/releases).
- Working on probe itself: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
