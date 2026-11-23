# Config

Everything lives in `.probe/`, at the root of your project.

| File         | What it holds                                                                                                                          | Git            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `config.yml` | The services                                                                                                                           | Commit it      |
| `lock.yml`   | State of the Makefile block. Only there once `probe sync` has run                                                                      | Commit it      |
| `local.yml`  | Values of your machine: dashboard options and parameter values, [service values](#values-of-your-machine), skipped services, variables | Ignored by git |
| `envs/*.yml` | The services of another [environment](features/environments.md)                                                                        | Commit them    |

Never put secrets in `config.yml`, `lock.yml` or `envs/`: use a [variable](features/headers.md).

## Editor support

`probe init` starts `config.yml` with a link to its JSON Schema. Since 0.24.0.

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@ninhache/probe@latest/schema/config.v1.json
schemaVersion: 1
```

- VS Code, with the YAML extension by Red Hat, and JetBrains IDEs complete the keys and underline a misspelled one.
- A config made before 0.24.0 has no link: paste the first line above at the top of it.
- The schema follows the latest release of probe, and some rules stay with probe: a value of `urls` that no
  parameter declares, two parameters that set the same header. `probe check` still reports them.

## Services

```yaml
# .probe/config.yml
schemaVersion: 1
services:
  api: { port: 3000, path: /health }
  front: { port: 5173, hint: "start it with: make front" }
  admin: { host: 127.0.0.1, port: 8080, expect: [200, 204] }
  secure: { url: https://localhost:8443/health }
  db: { port: 5432, timeout: 10 }
```

| Key        | Default     | Meaning                                                                                      | Since  |
| ---------- | ----------- | -------------------------------------------------------------------------------------------- | ------ |
| `port`     | required    | TCP port                                                                                     |        |
| `host`     | `localhost` | Host name or IP                                                                              |        |
| `path`     | `/`         | Path requested                                                                               |        |
| `url`      | none        | Full URL, instead of the three above                                                         | 0.12.0 |
| `urls`     | none        | Its address for a value of a [`url` parameter](features/parameters.md#one-address-per-value) | 0.21.0 |
| `expect`   | any 2xx     | Expected status, or a list of statuses                                                       |        |
| `method`   | `GET`       | Method of the request, without a body                                                        | 0.14.0 |
| `timeout`  | 3           | Seconds given to this service to answer                                                      | 0.4.0  |
| `headers`  | none        | Headers sent with the request                                                                | 0.13.0 |
| `hint`     | none        | What to do when it is down, one line                                                         | 0.19.0 |
| `tags`     | none        | Groups it belongs to: `tags: [back]`                                                         | 0.20.0 |
| `contains` | none        | Text the response body must contain                                                          | 0.20.0 |
| `type`     | `http`      | `http`, or `command` to [run a command](#command-services)                                   | 1.3.0  |
| `command`  | none        | The command of a `type: command` service                                                     | 1.3.0  |

A `probe` older than the "Since" version refuses a config that uses the key: upgrade it.

### port or url

A service is declared by `port` (with `host` and `path`, over `http`) or by `url`, never both. `url` is the way
to check `https`. It takes no user or password.

### expect and redirects

Redirects are followed and the final status is judged. If `expect` contains a 3xx, the first response is judged
as is.

### contains

One line of text the body of the response must contain. The status is judged first, then the body:

```yaml
services:
  api: { port: 3000, path: /health, contains: '"status":"ok"' }
```

```console
$ probe check
✗ api  http://localhost:3000/health  body does not contain: "status":"ok"
  the service answers 200 without this exact text: look at its response, or check `contains` in .probe/config.yml
```

- The match is exact, case and spaces included: `"status":"ok"` does not match `"status": "ok"`.
- The first 1 MiB of the body is searched, within the `timeout` of the service.
- It cannot be set with `method: HEAD`, whose response has no body.
- It is shared with the config: nothing secret goes in it.

### method

One of `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. The request never has a body.

- Every check sends it again: the dashboard every 2 s, `probe wait` until the service is up. Point a `POST` or
  a `DELETE` at a route that is safe to repeat.
- Only `GET` and `HEAD` follow redirects. With another method a `302` is the answer: add it to `expect` if that
  is what the route gives.

### timeout

Which one applies: `--timeout` when you pass it, else the service's `timeout`, else 3 s. In the dashboard: the
service's `timeout`, else the one set in its options.

### hint

One line of text shown under the service when it is down, instead of the automatic hint:

```console
$ probe check
✗ front  http://localhost:5173/  connection refused
  start it with: make front
```

It is shared with the config: nothing secret goes in it.

### tags

A list of names, to check a group of services at once: `probe check --tag back`. See [Tags](features/tags.md).

### Command services

A service can be checked by running a command: it is up when the command exits `0`. Since 1.3.0.

```yaml
services:
  db:
    type: command
    command: [docker, compose, exec, -T, db, pg_isready]
    timeout: 5
  cache:
    type: command
    command: "redis-cli ping"
```

`command` takes one of two forms:

| Form   | Run as                                      | Use it for                                                      |
| ------ | ------------------------------------------- | --------------------------------------------------------------- |
| list   | the program and its arguments, no shell     | what a team shares: it means the same on Linux, macOS, Windows  |
| string | one line for the system shell (`sh`, `cmd`) | pipes, `&&`, variables: it depends on the shell of each machine |

- Prefer the list. A string with a pipe or `$VAR` is read by `sh` on Linux and macOS and by `cmd.exe` on Windows.
- On Windows, a program that is a `.cmd` or `.bat` file (`npm`, `pnpm`, `yarn`...) cannot be started from a
  list: write it as a string, `command: "pnpm test"`.
- The command runs from the root of the project, with the environment of `probe`. It reads no input.
- When it fails, the reason is the last line it wrote to stderr, else `exit <code>`. `check --json` adds
  `exitCode` to a command service.
- Past its `timeout` (3 s by default) the command is killed, with everything it started. Give a slow one a
  larger `timeout`.
- It takes `timeout`, `hint` and `tags` like any service, plus `env`, and none of the keys that describe a request: `url`,
  `urls`, `host`, `port`, `path`, `method`, `headers`, `expect`, `contains`. `probe open` has nothing to open, and
  [parameters](features/parameters.md) leave it as it is.
- Add one with `probe add db --command "redis-cli ping"`, or `probe add db -- pg_isready -q` for the list form.
  In the dashboard, edit its command with `e`: a list is shown as JSON, `["pg_isready", "-q"]`.

#### env

A command that needs a login gets its variables in `env`: a map of name to value. Since 1.5.0.

```yaml
services:
  db:
    type: command
    command: [mysqladmin, ping, -u, app]
    env:
      MYSQL_HOST: 127.0.0.1
      MYSQL_PWD: ${DB_PASSWORD}
```

- The values go to the environment of the process, never to its arguments: `ps` does not show them.
- A value may hold `${NAME}` references, filled in like the [headers](features/headers.md#variables): from the
  environment, else from `.probe/local.yml`. `probe var DB_PASSWORD` keeps it on this machine.
- A variable that is not set means the command is not run: the service is down, with the `probe var` that sets it.
- A name that says secret (`PASSWORD`, `PWD`, `PASS`, `TOKEN`, `SECRET`, `KEY`...) must use a reference: a value
  written as is makes the config invalid. Other values are plain text, shared with the repository.
- What the command writes to stderr shows `${DB_PASSWORD}` where it repeats the value.
- Names are letters, digits and `_`. Only a `type: command` service has `env`; an http service has `headers`.
- Add it with `probe add db --command "mysqladmin ping" --setenv MYSQL_PWD='${DB_PASSWORD}'` (repeatable), or in
  the dashboard: `e` on the service, one `NAME=value` per line. A secret typed there is moved to `.probe/local.yml`.

Trust: `config.yml` is committed, and every `probe check`, `probe wait` and dashboard refresh runs each command in
it. Read the commands of a config you pull as you read its Makefile. Never put a secret in one: it is shared
with the repository, and it shows in the process list.

### Database services

`type: postgres`, `type: mysql` and `type: redis` check that a database accepts a login. Since 1.6.0.

```yaml
services:
  db:
    type: postgres
    port: 5432 # host defaults to localhost
    user: root # default: postgres for postgres, root for mysql, none for redis
    database: wakfuli
    password: ${PG_PASSWORD}
  mysql:
    type: mysql
    user: app
    database: shop
    password: ${MYSQL_PASSWORD}
  cache:
    type: redis
    database: 1
    password: ${REDIS_PASSWORD}
```

Add one with `probe add pg --type postgres --user app --database shop --password '${PG_PASSWORD}'`, then set the
password with `probe var PG_PASSWORD`. The dashboard adds one too.

Each one runs the client of the database, which must be installed and on the `PATH`, as a [command service](#command-services) does:

| Type       | Runs                                                                           | Port | Up when                                         |
| ---------- | ------------------------------------------------------------------------------ | ---- | ----------------------------------------------- |
| `postgres` | `psql -X -w -h host -p port -U user [-d database] -c "select 1"`               | 5432 | it exits `0`                                    |
| `mysql`    | `mysql --protocol=TCP -h host -P port -u user [--database=name] -e "select 1"` | 3306 | it exits `0`                                    |
| `redis`    | `redis-cli -h host -p port [--user user] [-n database] ping`                   | 6379 | it exits `0`, says `PONG` and nothing on stderr |

- `host`, `port`, `user`, `database` and `password` are optional. They are accepted on these three types only, and
  these types refuse the keys that describe a request or a command (`url`, `path`, `command`, `env`...).
- `password` is a `${NAME}` reference, nothing else: the value is refused, and never repeated in the message.
  The reference is filled in like an [env](#env) value: from the environment, else from `.probe/local.yml`. Keep the
  value on this machine with `probe var PG_PASSWORD`, or in the dashboard: type it in the Password field and it is
  moved to `.probe/local.yml`, with only the reference left in `config.yml`.
- The password reaches the client through its environment (`PGPASSWORD`, `MYSQL_PWD`, `REDISCLI_AUTH`), never its
  arguments: `ps` does not show it. It is not in `config.yml`, `check --json`, the copied command or any message.
- A variable that is not set means the client is not run: the service is down, with the `probe var` that sets it.
- A client that is not installed makes the service down: `psql is not installed`.
- `user` and a `database` name are letters, digits and `_ . $ -` (a `@` too for the user), and do not start with `-`.
  For `redis`, `database` is the number of the database, e.g. `0`.
- `psql` never asks for a password: a wrong or a missing one is a down service, not a hang. `redis-cli` exits `0` on
  an error reply, so `probe` looks for `PONG` itself.
- `c` in the dashboard and `probe curl` give the client command with `PGPASSWORD="${PG_PASSWORD}"` as a reference
  for your shell to fill in.
- `timeout`, `hint` and `tags` work as for any service. Docker without a local client is not covered: use a
  [command service](#command-services) with `docker compose exec` for that.

### https

The certificate is checked. A local CA installed on the machine (`mkcert -install`) works as it does in a
browser, on the latest Node 22, 24 or later. A certificate that is expired, made for another host or not trusted
makes the service down, with the reason. For a CA that is only in a file, set
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Values of your machine

A service of `config.yml` can be reached another way on your machine: another port, a local database user. Set
those values in `.probe/local.yml`, which git ignores:

```yaml
# .probe/local.yml
services:
  api: { port: 4000 }
  db: { user: me, database: scratch }
envs:
  staging:
    services:
      api: { timeout: 10 } # with --env staging only
```

- Only `url`, `host`, `port`, `path`, `timeout`, `command`, `user` and `database` can be set there, and only
  those the type of the service reads. A password stays a [variable](features/headers.md).
- A `host`, `port` or `path` changes the `url` of a service that has one, its scheme kept.
- They win over the `timeout` of the dashboard panel. A value chosen for a `urls:` [parameter](#parameters) wins
  over the address they give.
- `probe check`, `probe wait`, `probe doctor`, `probe curl`, `probe open` and the dashboard use them.
  `probe ls` marks them: `api  http://localhost:4000/  local port`.
- `config.yml`, the Makefile block and `lock.yml` never get them: an edit in the dashboard or `probe add` writes
  the shared values.

A service only your machine has goes under `extraServices`, with every key a service of `config.yml` takes but
`urls:`:

```yaml
# .probe/local.yml
extraServices:
  scratch: { port: 5173, path: /health }
envs:
  staging:
    extraServices:
      tunnel: { url: "https://localhost:8443/" } # with --env staging only
```

- It is checked, waited for and listed with the others; `probe ls` marks it `local`.
- `config.yml`, the Makefile block and `lock.yml` never get it. The dashboard checks it, but changes it only in
  `local.yml`: `e` and `d` say so. `probe rm` refuses it.

When `config.yml` changes under `local.yml`, probe says so on stderr, without changing the exit code. Only the
names are said, never a value:

```
probe: local.yml: services.gone is no longer in config.yml: its values are unused. Remove them from .probe/local.yml.
probe: local.yml: extraServices.api is now in config.yml too: the shared one is checked. Move what differs to services.api, or remove it.
```

- `probe check`, `probe wait` and `probe ls` print it, but not with `--json`. `probe doctor` gives it a
  `local.yml` line and a `project.local` field. The dashboard tells it once, as it opens.
- A value or a `skip` of a removed service is unused until you remove it. `probe rm api` removes the values of
  `api` from `local.yml` too.

## Parameters

A value that changes how every service is requested, such as a tenant sent in a header. Since 0.20.0. See
[Parameters](features/parameters.md).

```yaml
parameters:
  tenant:
    values: [acme, globex]
    strategy: { kind: header, name: X-Tenant }
```

## Migrations

`config.yml` carries a `schemaVersion`. When a newer `probe` needs a newer schema, the first command you run:

1. Backs up the file to `.probe/config.v<n>.bak.yml` (ignored by git).
2. Migrates it, keeping your comments.
3. Prints what it did.

Commit the migrated `config.yml` so your teammates get it.

- `probe status` shows a pending migration without applying it.
- A config written by a newer `probe` is refused with a message: upgrade `probe`.
