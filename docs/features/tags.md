# Tags

A tag names a group of services, to check them together:

```yaml
# .probe/config.yml
services:
  api: { port: 3000, tags: [back] }
  db: { port: 5432, tags: [back, infra] }
  front: { port: 5173 }
```

```console
$ probe check --tag back
✓ api  http://localhost:3000/  200  12ms
✓ db   http://localhost:5432/  200  3ms
```

## Give tags to a service

Write `tags:` in the config, or pass `--tag` to `probe add`:

```sh
probe add db -p 5432 --tag back,infra
```

A tag is made of letters, digits, `_` and `-`. `probe ls` shows the tags of each service.

## Select by tag

`--tag` works with `probe check`, `probe wait` and `probe doctor`.

| Command                              | Services selected                  |
| ------------------------------------ | ---------------------------------- |
| `probe check --tag back`             | Those tagged `back`                |
| `probe check --tag back,infra`       | Those tagged `back` or `infra`     |
| `probe check --tag back --tag infra` | The same                           |
| `probe check front --tag infra`      | `front`, and those tagged `infra`  |
| `probe wait --tag back && pnpm test` | Waits for those tagged `back` only |

- A tag that no service carries is refused: exit code `2`, and the known tags are listed.
- A service skipped in the dashboard stays skipped when a tag selects it. Name it to check it anyway:
  `probe check db`.
