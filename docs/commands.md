# Commands

`probe <command> --help` prints the same options, with examples.

- `probe` works from any sub-directory: it uses the nearest `.probe/` above you.
- When there is none, on a terminal, it offers to create it where you are, then runs your command. Off a
  terminal it stops with exit code `2`.
- Exit codes: `0` all up, `1` a service is down, `2` usage or config error.

| Declare               | Check                     | Use                   | Maintain                          |
| --------------------- | ------------------------- | --------------------- | --------------------------------- |
| [`init`](#probe-init) | [`check`](#probe-check)   | [`open`](#probe-open) | [`status`](#probe-status)         |
| [`add`](#probe-add)   | [`wait`](#probe-wait)     | [`curl`](#probe-curl) | [`sync`](#probe-sync)             |
| [`rm`](#probe-rm)     | [`doctor`](#probe-doctor) | [`var`](#probe-var)   | [`migrate`](#probe-migrate)       |
| [`ls`](#probe-ls)     | [`probe`](#probe)         | [`env`](#probe-env)   | [`completion`](#probe-completion) |

## probe

Opens the [dashboard](features/dashboard.md), on a terminal. Off a terminal, or with `--once`, it checks once,
prints the table and exits: `0` all up, `1` a service is down.

| Option                 | Default | Meaning                       |
| ---------------------- | ------- | ----------------------------- |
| `--interval <seconds>` | 2       | Seconds between two refreshes |
| `--once`               | off     | Check once, print the table   |

## probe init

Creates `.probe/` in this directory and adds the `.gitignore` entries. On a terminal it then proposes the
services it finds: see [Discover](features/discover.md).

## probe add

```sh
probe add api -p 3000 --path /health
probe add secure --url https://localhost:8443/health
```

| Option                    | Default     | Meaning                                                                        |
| ------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `-p`, `--port <port>`     | required    | Port                                                                           |
| `--host <host>`           | `localhost` | Host name or IP                                                                |
| `--path <path>`           | `/`         | Path to request                                                                |
| `--url <url>`             | none        | Full URL, `http` or `https`, instead of the three above                        |
| `--expect <status>`       | any 2xx     | Expected status: `200`, or `200,204`                                           |
| `--contains <text>`       | none        | Text the body must [contain](config.md#contains): `--contains '"status":"ok"'` |
| `--timeout <seconds>`     | 3           | Seconds given to this service                                                  |
| `-X`, `--method <method>` | `GET`       | Method of the request, sent without a body                                     |
| `-H`, `--header <h>`      | none        | Header to send, repeatable: `-H 'X-Api-Key: ${API_KEY}'`                       |
| `--hint <text>`           | none        | What to do when it is down: `--hint 'run: make api'`                           |
| `--tag <a,b>`             | none        | [Tags](features/tags.md) to select it with: `--tag back,infra`                 |

- `probe add` alone, on a terminal, asks for each value: see [Discover](features/discover.md).
- What each value means: [Config](config.md). Headers and their secrets: [Headers](features/headers.md).

## probe rm

`probe rm api` removes a service. On a terminal it asks first, with "No" selected. Off a terminal it removes at
once.

| Option        | Meaning               |
| ------------- | --------------------- |
| `-y`, `--yes` | Remove without asking |

## probe ls

Lists the services, their URL and what each one declares, such as `expect`, `contains` or [tags](features/tags.md).

| Option               | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| `--env <name>`       | List an [environment](features/environments.md) instead |
| `--set <name=value>` | Value of a [parameter](features/parameters.md)          |

## probe check

```sh
probe check            # every service
probe check api db     # these two only
probe check --tag back # those tagged back
```

| Option                | Default                   | Meaning                                                      |
| --------------------- | ------------------------- | ------------------------------------------------------------ |
| `--json`              | off                       | Print results as JSON                                        |
| `--env <name>`        | local                     | Check an [environment](features/environments.md) instead     |
| `--tag <a,b>`         | none                      | Only the services with one of these [tags](features/tags.md) |
| `--set <name=value>`  | its first value           | Value of a [parameter](features/parameters.md)               |
| `--timeout <seconds>` | the service's own, else 3 | Seconds given to each service                                |

A service that is down comes with a hint: the one you gave it (`hint` in the [config](config.md)), else one for
the known causes (connection refused, timeout, host not found, unexpected status, certificate rejected). With
`--json` it is the `hint` field, next to `error`.

On a terminal that supports links (iTerm2, kitty, WezTerm, Ghostty, VS Code, GNOME Terminal…), the URL of a
service opens with Cmd/Ctrl+click.

## probe wait

Checks again until every service is up, for scripts: `probe wait && pnpm test`. See
[Wait](features/wait.md).

| Option                     | Default         | Meaning                                                      |
| -------------------------- | --------------- | ------------------------------------------------------------ |
| `--timeout <seconds>`      | 60              | Seconds to wait in total before giving up                    |
| `--interval <seconds>`     | 0.5             | Seconds before the second check; the pause then doubles      |
| `--max-interval <seconds>` | 5               | Longest pause between two checks                             |
| `--json`                   | off             | Print the final results as JSON                              |
| `--env <name>`             | local           | Wait for an [environment](features/environments.md)          |
| `--tag <a,b>`              | none            | Only the services with one of these [tags](features/tags.md) |
| `--set <name=value>`       | its first value | Value of a [parameter](features/parameters.md)               |

## probe doctor

Says why a service is down: who holds the port, which container is stopped. See
[Doctor](features/doctor.md).

| Option                | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `--json`              | Print the diagnosis as JSON                                  |
| `--env <name>`        | Look at an [environment](features/environments.md) instead   |
| `--tag <a,b>`         | Only the services with one of these [tags](features/tags.md) |
| `--set <name=value>`  | Value of a [parameter](features/parameters.md)               |
| `--timeout <seconds>` | Seconds given to each service                                |

## probe open

`probe open front` opens the URL of a service in the browser. It uses `open` on macOS and `xdg-open` elsewhere.
Without it, the URL is printed and the exit code is `1`.

| Option               | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| `--set <name=value>` | Value of a [parameter](features/parameters.md) |

## probe curl

`probe curl api` prints the curl command that requests a service, to copy or to run: `probe curl api | sh`.

| Option               | Meaning                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `--env <name>`       | The service of an [environment](features/environments.md) instead |
| `--set <name=value>` | Value of a [parameter](features/parameters.md)                    |

## probe var

Lists the variables the headers use, or sets one for this machine. See [Headers](features/headers.md).

```sh
probe var                # list them, and where each is set
probe var API_TOKEN      # type its value, hidden
```

| Option         | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `--unset`      | Forget the value kept for this variable                             |
| `--env <name>` | Keep the value for one [environment](features/environments.md) only |

## probe env

`probe env` lists the environments. `probe env staging` creates one. See
[Environments](features/environments.md).

| Option          | Default | Meaning                                             |
| --------------- | ------- | --------------------------------------------------- |
| `--from <name>` | local   | Environment whose services are copied               |
| `--empty`       |         | Create it with no service (conflicts with `--from`) |

## probe status

Prints the version, a pending migration, the state of the Makefile block and an available update.

`probe` looks for a newer version at most once a day, in the background, and prints one line when there is one.
It never updates itself. Turn it off with `PROBE_NO_UPDATE_CHECK=1`. It is off when `CI` is set.

`PROBE_ASCII=1` makes the dashboard and the command output use ASCII only (`ok` and `x` for `✓` and `✗`, `->` for `→`, `-` for `·`), for a UTF-8 terminal whose font lacks some glyphs. Only `1` counts. A non-UTF-8 locale and `TERM=linux` do the same. `--json` is not affected.

After an update, the first run in a terminal shows what is new, once, on stderr: the versions you skipped,
the items that need an action (`!`: a schema change, a stale saved completion) first, then the others (`+`),
about 8 lines at most. A first install shows nothing. It stays silent with `--json`, when stderr is not a
terminal, for `probe completion`, `--help` and `--version`, and under the same switches as the update
check. In the dashboard the same notes open as a "What's new" window, and `⇧w` (Shift+w) opens them again.

## probe sync

Adds or regenerates the block of the Makefile. See [Makefile](features/makefile.md).

## probe migrate

Brings `.probe/config.yml` up to date with the current schema. See [Config](config.md#migrations).

## probe completion

`probe completion zsh|bash|fish` prints the completion script. See [Completion](features/completion.md).
