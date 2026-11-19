# Doctor

`probe doctor` prints what `probe status` prints, checks the services, then looks at this machine for each one
that is down.

```
migration  none pending
makefile   in sync
update     up to date (0.19.0)

✓ web  http://localhost:5173/  200  4ms
✗ api  http://localhost:3000/  expected 2xx, got 500
  the service answers with an error: look at its logs
    port 3000  node (pid 4242) listens on it
    docker     no container publishes this port
✗ db   http://localhost:5432/  connection refused
  nothing listens on :5432: is the service started?
    port 5432  nothing listens on it
    docker     container demo-db (exited) publishes this port → docker start demo-db
```

It changes nothing: a pending migration is reported, not applied.

## What it looks at

- **The port**: which process listens on it, with its name and pid. It uses `lsof` (`ss` on Linux when `lsof` is
  missing). A port held by another user or by a container has no visible owner: doctor says so.
- **Docker**: a container that publishes the port on the host, running or stopped.
- A missing tool, or a Docker daemon that does not answer, marks its check `skipped`: the others still run.
- A service on another host gets no local check.

Only the name and the pid of a process, and the name and the state of a container, are read: never a command
line nor an environment.

## Options

| Option                | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `probe doctor api db` | Look at these services only                            |
| `--json`              | Print `{ ok, project, services }`                      |
| `--env <name>`        | Look at an [environment](environments.md)              |
| `--tag <a,b>`         | Look at the services with one of these [tags](tags.md) |
| `--set <name=value>`  | Value of a [parameter](parameters.md)                  |
| `--timeout <seconds>` | Seconds given to each service, as in `probe check`     |

With `--env`, the Makefile block is left out of the report: it lists the local services.

With `--json`, each down service carries its `checks`: `port`, `process`, `docker`.

## Exit code

- `0`: nothing to report.
- `1`: a service is down, a migration is pending, or the Makefile block is edited or out of date.
- `2`: invalid config or unknown service.
