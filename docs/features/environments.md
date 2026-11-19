# Environments

`.probe/config.yml` holds the services of your machine. The same services on a shared environment go in a file
of their own, written the same way:

```yaml
# .probe/envs/prod.yml
schemaVersion: 1
services:
  api: { url: https://api.example.com/health }
  front: { url: https://example.com }
```

```sh
probe check --env prod
```

The name of the environment is the file name: letters, digits, `_` and `-`. `local` is `config.yml` itself.

Environments need `probe` 0.15.0 or later; `probe env` and per-environment values need 0.16.0.

## Create one

```sh
probe env                        # list the environments
probe env staging                # create .probe/envs/staging.yml from config.yml
probe env staging --from prod    # or from envs/prod.yml
```

`probe env` never overwrites a file. It copies the services, no secret value, then names the variables to set.

## Which commands take `--env`

| Takes `--env`                                  | Local services only |
| ---------------------------------------------- | ------------------- |
| `check`, `wait`, `ls`, `curl`, `var`, `doctor` | `add`, `rm`, `open` |

Without `--env`, every command reads `config.yml`, and so does `make check`. To change the services of an
environment, edit its file, or use `a`, `e` and `d` on its tab in the dashboard.

## In the dashboard

With files in `.probe/envs/`, the [dashboard](dashboard.md) shows every environment at once, one column each.
On an environment's tab, `a`, `e` and `d` add, edit and remove its services in its own file; undo and redo
cover those writes. The Makefile block and `lock.yml` only follow `config.yml`, so they never change.
A secret typed there goes to that environment's values in `.probe/local.yml`, never to its file.

## Values per environment

Each environment has its own values in `.probe/local.yml`, and none is ever used for another:

```sh
probe var API_TOKEN              # sent to the local services only
probe var API_TOKEN --env prod   # sent to prod only
```

An exported variable (`API_TOKEN=… probe check --env prod`) wins over both.

A service is skipped for one environment in the same file:

```yaml
# .probe/local.yml
variables:
  API_TOKEN: … # local services
envs:
  prod:
    variables:
      API_TOKEN: … # prod only
    services:
      worker: { skip: true }
```

See [Headers and secrets](headers.md) for variables.
