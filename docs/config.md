# Config

Everything lives in `.probe/`, at the root of your project.

| File         | What it holds                                                          | Git            |
| ------------ | ---------------------------------------------------------------------- | -------------- |
| `config.yml` | The services                                                           | Commit it      |
| `lock.yml`   | State of the Makefile block. Only there once `probe sync` has run      | Commit it      |
| `local.yml`  | Values of your machine: dashboard options, skipped services, variables | Ignored by git |
| `envs/*.yml` | The services of another [environment](features/environments.md)        | Commit them    |

Never put secrets in `config.yml`, `lock.yml` or `envs/`: use a [variable](features/headers.md).

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

| Key       | Default     | Meaning                                 | Since  |
| --------- | ----------- | --------------------------------------- | ------ |
| `port`    | required    | TCP port                                |        |
| `host`    | `localhost` | Host name or IP                         |        |
| `path`    | `/`         | Path requested                          |        |
| `url`     | none        | Full URL, instead of the three above    | 0.12.0 |
| `expect`  | any 2xx     | Expected status, or a list of statuses  |        |
| `method`  | `GET`       | Method of the request, without a body   | 0.14.0 |
| `timeout` | 3           | Seconds given to this service to answer | 0.4.0  |
| `headers` | none        | Headers sent with the request           | 0.13.0 |
| `hint`    | none        | What to do when it is down, one line    | 0.19.0 |
| `tags`    | none        | Groups it belongs to: `tags: [back]`    | 0.20.0 |

A `probe` older than the "Since" version refuses a config that uses the key: upgrade it.

### port or url

A service is declared by `port` (with `host` and `path`, over `http`) or by `url`, never both. `url` is the way
to check `https`. It takes no user or password.

### expect and redirects

Redirects are followed and the final status is judged. If `expect` contains a 3xx, the first response is judged
as is.

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

### https

The certificate is checked. A local CA installed on the machine (`mkcert -install`) works as it does in a
browser, on the latest Node 22, 24 or later. A certificate that is expired, made for another host or not trusted
makes the service down, with the reason. For a CA that is only in a file, set
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Migrations

`config.yml` carries a `schemaVersion`. When a newer `probe` needs a newer schema, the first command you run:

1. Backs up the file to `.probe/config.v<n>.bak.yml` (ignored by git).
2. Migrates it, keeping your comments.
3. Prints what it did.

Commit the migrated `config.yml` so your teammates get it.

- `probe status` shows a pending migration without applying it.
- A config written by a newer `probe` is refused with a message: upgrade `probe`.
