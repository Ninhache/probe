# Wait

`probe wait` checks again and again until every service is up, then exits `0`. It is made for scripts:

```sh
probe wait && pnpm test
probe wait api --timeout 120
```

After 60 s it gives up: exit code `1`, and the services still down are named.

## Pace

It checks at once, then again after 0.5 s, 1 s, 2 s, 4 s, then every 5 s.

| Option           | Default | Meaning                                      |
| ---------------- | ------- | -------------------------------------------- |
| `--timeout`      | 60      | Seconds to wait in total before giving up    |
| `--interval`     | 0.5     | Seconds before the second check              |
| `--max-interval` | 5       | Longest pause between two checks, in seconds |

`wait --timeout` covers the whole wait. Each check inside it still gets 3 s, or the service's own `timeout`.

## Output

Progress goes to stderr, the final report to stdout. `--json` prints the final results as JSON.
`--env <name>` waits for the services of an [environment](environments.md).
`--tag <a,b>` waits only for the services that carry one of these [tags](tags.md).
