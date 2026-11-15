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
| `probe add <name> -p <port> [--host] [--path] [--expect]` | Add a service (`--timeout <seconds>`, `-X <method>` for its own)       |
| `probe add <name> --url <url> [--expect]`                 | Add a service by its full URL, `http` or `https`                       |
| `probe rm <name> [--yes]`                                 | Remove a service                                                       |
| `probe ls`                                                | List services                                                          |
| `probe check [name...] [--json] [--timeout <seconds>]`    | Check all services, or the named ones                                  |
| `probe wait [name...] [--json] [--timeout <seconds>]`     | Check again until every service is up, or give up after the timeout    |
| `probe open <name>`                                       | Open the URL of a service in the browser                               |
| `probe curl <name>`                                       | Print the curl command that requests a service                         |
| `probe var [name] [--unset]`                              | List the variables the headers use, or set one for this machine        |
| `probe status`                                            | CLI version, pending migration, Makefile block state, available update |
| `probe sync`                                              | Add or regenerate the Makefile block (optional)                        |
| `probe migrate`                                           | Migrate `.probe/config.yml` to the current schema                      |
| `probe completion <zsh\|bash\|fish>`                      | Print the shell completion script                                      |

Exit codes: `0` all up, `1` a service is down, `2` usage or config error.

A service that is down comes with a hint when the cause is a known one: connection refused, timeout, host not
found, unexpected status, certificate rejected after a redirect to https. With `--json` it is the `hint` field,
next to `error`.

`probe wait` is for scripts: `probe wait && pnpm test`. It checks at once, then again after 0.5 s, 1 s, 2 s, 4 s
and every 5 s, for 60 s in total. `--timeout` sets the total, `--interval` the first pause, `--max-interval` the
longest one. Unlike `check --timeout`, which is the time given to each service, `wait --timeout` covers the whole
wait; each check inside it still gets 3 s, or the service's own `timeout`. Progress goes to stderr, the final
report to stdout; exit code `1` names the services still down.

`probe add` alone, on a terminal, asks for the name, the port, the path and the expected status, one at a time:
Enter alone keeps the default, Ctrl+C adds nothing. Off a terminal it needs its arguments, as before.

On a terminal, `probe init` and `probe add` alone first show the services they find in the project, as a list to
tick. Nothing is ticked at first, and nothing is written unless you tick it. They look at:

- the compose file (`compose.yaml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`) and its
  `override` file: the ports a service publishes (`"8080:80"`), under the name of the service. A variable in a
  port takes its value from `.env`. Https, mail, database, cache and broker ports are left out.
- `.env` and `.env.local`: `PORT`, and the `*_URL` that point to `http://localhost`. Only the host, the port and
  the path are kept: no other value is kept, shown or written.
- `package.json`: the port a script names (`--port 4000`), or the usual one of its dev server (vite, next, nuxt,
  astro, angular).
- the local ports 3000, 3001, 4200, 4321, 5173, 8000 and 8080, when an HTTP server answers there (one `GET /`
  each, redirects not followed).
  `PROBE_DETECT_PORTS=4000,4001` tries other ports, `PROBE_DETECT_PORTS=` none.

`probe rm` deletes something, so on a terminal it asks first, with "No" selected: `--yes`
(`-y`) skips the question. Off a terminal, in a script or in CI, it removes at once, as before.

`probe open` uses `open` on macOS and `xdg-open` elsewhere. Without it, the URL is printed and the exit code is
`1`. `probe curl api` prints a command to copy, or to run: `probe curl api | sh`.

`probe` works from any sub-directory: it walks up to the nearest `.probe/`. When there is none, on a terminal,
it offers to create it where you are, then runs your command. Off a terminal it stops with exit code `2`.

## Completion

Tab completes the commands, their options and the names of your services (`probe check a<Tab>`).

```sh
eval "$(probe completion zsh)"     # in ~/.zshrc, after compinit
eval "$(probe completion bash)"    # in ~/.bashrc (macOS: ~/.bash_profile)
probe completion fish | source     # in ~/.config/fish/config.fish
```

In zsh you can also save it once instead: `probe completion zsh > ~/.zfunc/_probe`, with `~/.zfunc` in your
`fpath`; in fish, `probe completion fish > ~/.config/fish/completions/probe.fish`. It works with the bash 3.2
of macOS.

## Dashboard

`probe` alone, on a terminal, opens a live list of your services and checks them every 2 s
(`probe --interval 5` for another pace). Off a terminal, in CI or in a pipe, nothing changes: use `probe check`.

| Key             | What it does                                   |
| --------------- | ---------------------------------------------- |
| `↑` `↓` `j` `k` | Move                                           |
| `r`             | Check now                                      |
| `Enter`         | Open the detail of the selected service        |
| `u`             | Open its URL in the browser                    |
| `c`             | Copy its curl command                          |
| `/`             | Filter by name; `Enter` keeps it, `Esc` clears |
| `a`             | Add a service                                  |
| `e`             | Edit the selected service                      |
| `d`             | Remove the selected service, after a question  |
| `:`             | Find a command by what it does; `Enter` runs   |
| `o`             | Options: interval, timeout and notifications   |
| `?`             | Every key; `?` or `Esc` closes                 |
| `q`             | Quit                                           |

The bar at the bottom shows the keys you need first; `?` lists them all.

`c` uses `pbcopy` on macOS, `wl-copy` or `xclip` on Linux. Without one of them, the command is shown instead,
to copy by hand.

`a` and `e` open a form: name, port, host, path, expected status, method, then one line per [header](#headers) as
`Name: value`, with an empty one at the end to add another. `↑` `↓` or `Tab` change field, `Enter` saves, `Esc`
cancels, `Ctrl+U` empties the field: a header left empty is removed. A field left empty takes its default.

A secret typed in a header (`Authorization: Bearer abc123`) is drawn as dots and never reaches `config.yml`:
on `Enter` the form asks under which variable to keep it, proposes a name (`API_TOKEN`), writes
`Bearer ${API_TOKEN}` in `config.yml` and the value in `.probe/local.yml`. `d` asks first: only `y` removes. All three write
`.probe/config.yml` the way `probe add` and `probe rm` do: comments kept, [Makefile](#makefile) block kept up to
date. While you type, in the filter, the form or the command palette, `q` and `?` are letters.

`Enter` shows the last answer of the selected service above its settings: status, latencies of this
session, headers and the first lines of the body; for a service that is down, what failed and what to try. The
value of a header that can carry a secret (`Authorization`, `Set-Cookie`, anything named after a token or a key)
is replaced by `(hidden)`. None of it is written anywhere, and `probe check --json` prints what it printed before.

Under the two settings, the panel lists the variables the headers of the service use, and where each is set.
`Enter` on one asks for its value, hidden, and keeps it in `.probe/local.yml`, as `probe var` does. A variable
set in the environment is not changed there: the environment is read first.

The panels save what you change in `.probe/local.yml`, for your machine only:

```yaml
dashboard: { interval: 5, timeout: 3, notify: true }
services:
  db: { skip: true }
```

With `notify` on, a desktop notification says when a service goes down or comes back: one per round of checks
that saw a change, none when the dashboard starts. It names the services and nothing else, and needs
`notify-send` on Linux (`osascript`, already there, on macOS); without it the dashboard says so once and goes on.

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
  secure: { url: https://localhost:8443/health }
  db: { port: 5432, timeout: 10 }
```

| Key       | Default     | Meaning                                 |
| --------- | ----------- | --------------------------------------- |
| `port`    | required    | TCP port                                |
| `host`    | `localhost` | Host name or IP                         |
| `path`    | `/`         | Path requested                          |
| `url`     | none        | Full URL, instead of the three above    |
| `expect`  | any 2xx     | Expected status, or a list of statuses  |
| `method`  | `GET`       | Method of the request, without a body   |
| `timeout` | 3           | Seconds given to this service to answer |
| `headers` | none        | Headers sent with the request           |

Which timeout applies: `--timeout` when you pass it, else the service's `timeout`, else 3 s (in the dashboard,
the timeout set in its options). A config with a `timeout` needs `probe` 0.4.0 or later: older versions refuse it.

A service is found by `port` (with `host` and `path`, over `http`) or by `url`, never both. `url` is the way to
check `https`: `url: https://localhost:8443/health`. It takes no user or password: `config.yml` is shared. A
config with a `url` needs `probe` 0.12.0 or later: older versions refuse it. The dashboard does not edit a
service declared by `url`: change it in `config.yml`.

`method` is one of `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`: `probe add hook -p 8080 -X POST`.
The request never has a body.

- Every check sends it again, and the dashboard checks every few seconds: a `POST` or a `DELETE` that changes
  something changes it at each pass. Point it at a route that is safe to repeat.
- Only `GET` and `HEAD` follow redirects. Any other method is sent once: a `302` is the answer, add it to
  `expect` if that is what the route gives.

A config with a `method` needs `probe` 0.14.0 or later: older versions refuse it.

Over `https` the certificate is checked, against what Node trusts and what the system trusts, so a local CA
installed on the machine (`mkcert -install`) works as it does in a browser (on a Node that can read the system
store: the latest 22, 24 or later). A certificate that is expired, made
for another host or not trusted makes the service down, with the reason. For a CA that is only in a file, set
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

Redirects are followed and the final status is judged, unless `expect` contains a 3xx: then the first response
is judged as is.

### Headers

A service behind an API key or a login gets its headers in `config.yml`:

```yaml
services:
  api:
    url: https://dev.example.com/health
    headers:
      Accept: application/json
      Authorization: Bearer ${API_TOKEN}
```

`probe add api --url https://dev.example.com/health -H 'Authorization: Bearer ${API_TOKEN}'` writes the same
(`-H` can be repeated; keep the single quotes, or the shell fills the variable in).
Written on one line between `{ }`, a value with a variable needs quotes: `headers: { X-Api-Key: '${API_KEY}' }`.

`${API_TOKEN}` is a variable: its value is never written in `config.yml`. `probe` takes it from the environment,
else from `.probe/local.yml`, which stays on your machine:

```sh
probe var API_TOKEN            # asks for the value, hidden, and keeps it in .probe/local.yml
probe var API_TOKEN < key.txt  # or reads it from a file or a pipe
probe var                      # which variables are used, and where each is set
```

The [dashboard](#dashboard) does both: `e` edits the headers of a service, `Enter` then `Enter` on a variable
sets its value.

- A header whose name says secret (`Authorization`, `Cookie`, `X-Api-Key`, anything with `token`, `key`,
  `secret`...) must use a variable: a value written as is makes the config invalid.
- A variable that is not set makes the service down, with the command that sets it. No request is sent.
- The value is never printed: not by `check`, `--json`, `probe curl` (which writes `$API_TOKEN` for the shell
  to fill in) nor the dashboard, which masks it if the service repeats it in its response.
- With headers, a redirect is followed on the same host and port only. One that leaves for another origin
  makes the service down and names it: the headers are never sent there.

A config with `headers` needs `probe` 0.13.0 or later: older versions refuse it.

Files in `.probe/`:

- `config.yml`: services. Commit it.
- `lock.yml`: CLI version and hash of the Makefile block. Only there once `probe sync` has run. Commit it.
- `local.yml`: per-machine values (dashboard settings, skipped services, variables). Ignored by git, readable
  by you only.

Never put secrets in `config.yml` or `lock.yml`.

## Makefile

Optional. `probe sync` writes a block between two markers, in a new `Makefile` or at the end of yours. Everything
outside the block is yours and is never touched. Without a block, no command creates or changes a `Makefile`.

```make
# >>> probe (generated - do not edit, run `probe sync`)
...
# <<< probe
```

Once the block is there, `probe add`, `probe rm` and the dashboard keep it up to date. Commit the `Makefile` and
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
