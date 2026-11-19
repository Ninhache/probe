# Makefile

Optional. `probe sync` writes a block between two markers, in a new `Makefile` or at the end of yours.

```make
# >>> probe (generated - do not edit, run `probe sync`)
...
# <<< probe
```

- Everything outside the block is yours and is never touched.
- Without a block, no command creates or changes a `Makefile`.
- Once the block is there, `probe add`, `probe rm` and the dashboard keep it up to date.

Commit the `Makefile` and `.probe/lock.yml`.

Needs `make` in your `PATH`. Where it is not installed (Windows without Git Bash or WSL, a minimal Linux),
`probe sync` still writes the block for your teammates, then says to run `probe check`; `probe status` and
`probe doctor` say `make not installed` and do not count the block as a problem.

## Targets

| Target              | What it runs                                 |
| ------------------- | -------------------------------------------- |
| `make help`         | Lists the targets                            |
| `make check`        | `probe check`                                |
| `make check-<name>` | `probe check <name>`, one target per service |
| `make status`       | `probe status`                               |
| `make probe`        | Opens the [dashboard](dashboard.md)          |

The block uses `probe` when it is in your `PATH`, else `npx -y @ninhache/probe@latest`. It works with GNU Make
3.81 (the macOS default).

## When the block is edited or out of date

- Edited by hand: `probe status` says `modified`, and `probe add` / `probe rm` leave it alone.
- Written by an older `probe`: `probe status` says `outdated`.

In both cases `probe sync` restores it.
