# Parameters

A parameter is a value that changes how every service is requested: the tenant, the version of the API, a
region. It is declared once, not in each service:

```yaml
# .probe/config.yml
parameters:
  tenant:
    values: [acme, globex]
    strategy: { kind: header, name: X-Tenant }

services:
  api: { port: 3000, path: /health }
  printer: { url: https://printer.example.com/status }
```

```sh
probe check                     # sends X-Tenant: acme to both services
probe check --set tenant=globex   # sends X-Tenant: globex
```

Parameters need `probe` 0.20.0 or later. An older `probe` refuses a config that declares some.

## Strategies

The strategy says where the chosen value goes in the request.

| `kind`   | Needs  | With the value `v2`, `/health` becomes |
| -------- | ------ | -------------------------------------- |
| `header` | `name` | `/health`, sent with `name: v2`        |
| `query`  | `name` | `/health?name=v2`                      |
| `path`   |        | `/v2/health`                           |
| `url`    |        | the address the service gives for `v2` |

- `query` is added after the query the service already has: `/find?q=a` becomes `/find?q=a&name=v2`.
- `path` goes before the path of the service, for a `url` too: `https://example.com/status` becomes
  `https://example.com/v2/status`. Several `path` parameters follow the order they are declared in.
- A service that declares that header or that query itself keeps its own. It is the way to leave one service
  out of a parameter.
- Two parameters cannot set the same header or the same query.
- With a `header` parameter, every service sends a header: a redirect is then followed on the same host and
  port only, as for the [headers](headers.md) of a service.

## One address per value

With the `url` strategy, a value changes where a service is: each service lists its address for the values
that move it, under `urls`. Since 0.21.0.

```yaml
parameters:
  env: { values: [local, prod], strategy: { kind: url } }

services:
  api:
    port: 3000
    path: /health
    urls: { prod: https://api.example.com/health }
  db: { port: 5432 }
```

```sh
probe check                  # api at http://localhost:3000/health
probe check --set env=prod   # api at https://api.example.com/health, db where it was
```

- A value without an address in `urls` keeps the `port` or the `url` of the service.
- A config has one `url` parameter at most, and `urls` only names its values.
- The other parameters apply to the address that is chosen.

## Names and values

- The name of a parameter is made of letters, digits, `_` and `-`.
- A value is made of letters, digits, `.`, `_` and `-`, and is listed once.
- The values are written in `config.yml`, which is shared: a header that carries a secret, such as
  `Authorization`, is refused. See [Headers and secrets](headers.md) for those.

## Choose a value

`--set name=value` works with `probe check`, `probe wait`, `probe doctor`, `probe ls`, `probe curl` and
`probe open`. Repeat it for several parameters:

```sh
probe check --set tenant=globex --set version=v2
probe curl api --set tenant=globex
```

- Without `--set`, a parameter takes its first value. That is what `make check` uses.
- In the [dashboard](dashboard.md#parameters), `p` chooses the values, saved for the next start, and adds,
  edits or removes the parameters of `config.yml` (since 0.21.0).
- The other commands refuse `--set`.
- A parameter or a value the config does not list is refused: exit code `2`, and the known ones are listed.
- An [environment](environments.md) file has its own `parameters`: `probe check --env prod --set tenant=globex`
  reads those of `envs/prod.yml`.
