# Dashboard

`probe` alone, on a terminal, opens a live screen of your services and checks them every 2 s.

```sh
probe                # every 2 s
probe --interval 5   # every 5 s
probe --once         # check once, print the table, exit
```

Off a terminal, in CI or in a pipe, `probe` checks once, prints the table and exits with `1` if a service is
down, as `probe --once` does anywhere. `--interval` needs a terminal.

## The screen

- The services table on the left: one line per service, with its status, last latency, uptime and a small trend.
  With [several environments](#several-environments) there is one column per environment.
- On the right, for the selected service: its latency, its uptime against a 99% objective, and a panel with two
  tabs, `1` events and `2` response.
- The events tab lists the changes of status of this session. The response tab shows the last answer of the
  selected service: status line, headers, then the body. `PgUp` `PgDn` scroll it.
- A JSON body (a `json` content type, or a body that parses as JSON) is shown indented and in colour, here and
  in the full response view. A body cut at the size cap, or one that is not valid JSON, is shown as received.
  Secrets are hidden before the body is laid out, and no string is decoded on the way. `c` copies the body as
  received, `b` copies the indented JSON.
- The mouse works: click a service, a tab or an environment, and scroll the wheel over the lists.

## Keys

| Key             | What it does                                   |
| --------------- | ---------------------------------------------- |
| `↑` `↓` `j` `k` | Move                                           |
| `←` `→` `h` `l` | Change environment                             |
| `r`             | Check now                                      |
| `Enter`         | Open the detail of the selected service        |
| `1` `2`         | Events tab, response tab                       |
| `PgUp` `PgDn`   | Scroll the response tab                        |
| `u`             | Open its URL in the browser                    |
| `c`             | Copy its curl command                          |
| `b`             | Copy the body of its last response             |
| `/`             | Filter by name; `Enter` keeps it, `Esc` clears |
| `p`             | Choose, add or edit [parameters](#parameters)  |
| `a`             | Add a service                                  |
| `e`             | Edit the selected service                      |
| `d`             | Remove the selected service, after a question  |
| `n`             | Create an [environment](#several-environments) |
| `z`             | Undo the last change to `config.yml`           |
| `Z`             | Redo what `z` undid                            |
| `:`             | Find a command by what it does; `Enter` runs   |
| `o`             | Options: interval, timeout and notifications   |
| `?`             | Every key, scrolling; `?` or `Esc` closes      |
| `q`             | Quit                                           |

The bar at the bottom shows the keys you need first. While you type (filter, form, command palette), `q` and
`?` are letters.

`c` and `b` use `pbcopy` on macOS, `wl-copy` or `xclip` on Linux. Without one of them, the text is shown to copy by
hand.

## Add, edit, remove

`a` and `e` open a form: name, address, expected status, method, then one line per
[header](headers.md) as `Name: value`, with an empty one at the end to add another.

| Key in the form  | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `↑` `↓` or `Tab` | Change field                                                         |
| `←` `→`          | Choose the method, `GET` first                                       |
| A letter         | On the method, the first one it starts: `p` again for `PUT`, `PATCH` |
| `Enter`          | Save                                                                 |
| `Esc`            | Cancel                                                               |
| `Ctrl+U`         | Empty the field                                                      |

- A field left empty takes its default. A header left empty is removed.
- `d` asks first: only `y` removes.
- `z` undoes the last write to `config.yml` made here (add, edit, remove, a timeout, a parameter), then the one
  before. It puts back `config.yml`, `lock.yml` and the Makefile as they were, and does nothing if one of them
  changed since. Kept in memory only, until you quit. `local.yml` is never undone: options, skips, the chosen
  values and a variable kept for a header stay as they are.
- `Z` (Shift+Z) writes again what `z` undid, last undone first, with the same check. A new change forgets it.
- All three write `.probe/config.yml` as `probe add` and `probe rm` do: your comments are kept, and the
  [Makefile](makefile.md) block stays up to date.
- The address takes `3000`, `localhost:3000/health`, `api.example.com` or `https://api.example.com:8443/health`.
  Without a scheme it is `http://`. A host and a port typed without a scheme are written as `port`, `host`
  and `path`, as before; an address with its scheme, or without a port, is written as `url:`. An address left
  unchanged is not rewritten.
- With a parameter sent by `url`, the form starts with one line per value, `URL dev`, `URL prod`, written under
  `urls:`. A URL replaces the address for its value: the form says it,
  `Overridden by the parameter env for prod`, then `not used` when every value has one. A line left empty uses
  the address. `localhost:3001` is written `http://localhost:3001`. With every URL filled, the address may be
  left empty: the service then has no `port` or `url` of its own, and an edit leaves it so.

  ```
  │ › URL local  localhost:3001_                 │
  │   URL prod   https://example.com/health      │
  │ Overridden by the parameter env: not used    │
  │   Address    localhost:3000                  │
  ```

A secret typed in a header (`Authorization: Bearer abc123`) is drawn as dots and never reaches `config.yml`.
On `Enter` the form asks under which variable to keep it and proposes a name (`API_TOKEN`). It writes
`Bearer ${API_TOKEN}` in `config.yml` and the value in `.probe/local.yml`.

## Detail of a service

`Enter` shows the selected service: status, latencies of this session and, for a service that is down, what
failed and what to try. `r` there opens the full response (status line, headers, body), scrollable with `↑` `↓`
and `PgUp` `PgDn`. `c` copies the whole response, `b` its body, `r` goes back to the detail, `Esc` closes.

`Request:` gives the method and the whole URL, parameters applied. `Headers sent:` lists the headers of the
request, parameters included, as `config.yml` writes them. A variable stays `${NAME}`, never its value:

```
Request:
  GET http://localhost:3000/acme/health?region=new%20york
Headers sent:
  X-Tenant: acme
  Authorization: Bearer ${API_TOKEN}
```

- The value of a header that can carry a secret (`Authorization`, `Set-Cookie`, anything named after a token
  or a key) is replaced by `(hidden)`.
- None of it is written anywhere.

Under it, the panel has:

- the timeout of the service. It is shared: written to `.probe/config.yml`, so commit it;
- skip: leave the service out on this machine;
- the variables its headers use, and where each is set. `Enter` on one asks for its value, hidden, and keeps
  it in `.probe/local.yml`, as `probe var` does. A variable set in the environment is not changed there.

## Parameters

With [parameters](parameters.md) in the config, `p` opens the parameters panel: one row per parameter, with
its chosen value as `‹ value ›`. `↑` `↓` (`j` `k`) change parameter, `←` `→` (`h` `l`) choose its value. `p` or
`Esc` closes it.

```
┌─ parameters ───────────────┐
│ › tenant    ‹ globex ›     │
│   version   ‹ v1 ›         │
└────────────────────────────┘
```

- In the panel, `a` adds a parameter, `e` edits the selected one and `d` removes it, after a question. With no
  parameter yet, `p` opens the panel to add the first one. The form asks for:
  - the name;
  - the values, separated by commas: `acme, globex`;
  - how it is sent, chosen with `←` `→` or its first letter: `query` (the default), `path`, `header` or `url`;
  - for a query or a header only, its name. A query left without one takes the name of the parameter;
  - for `url` only, the address of each service for each value, under `Addresses`. A line left empty keeps the
    address of the service. `localhost:3001` is written `http://localhost:3001`.

    ```
    Addresses (empty: the service address)
      api   local
            prod   https://example.com/health
    › db    local  localhost:3001_
    ```

  Under the fields, a line says what the chosen way does, with an example on the first value:

  | Sent by  | With `tenant` = `acme`                                  |
  | -------- | ------------------------------------------------------- |
  | `query`  | `localhost:3000/health?tenant=acme`                     |
  | `path`   | `localhost:3000/acme/health`                            |
  | `header` | the header `X-Tenant: acme`                             |
  | `url`    | the address each service lists under `urls:` for `acme` |

  It writes `.probe/config.yml` and keeps your comments. What the config would refuse is shown in the form and
  nothing is written: two parameters on the same query, a header that can carry a secret, an address that is
  not an `http://` or `https://` URL. A parameter that only an [environment](#several-environments) declares is
  changed in its file.

  A value removed from a `url` parameter takes its addresses with it: `Enter` first asks
  `Remove 2 addresses: api prod, db prod?`. `y` writes, `n` or `Esc` goes back to the form. Changing how a
  parameter is sent, or removing it with `d`, is refused while services list addresses for it.
- The next check, `u`, `c` and the detail use the chosen values.
- The parameters do not depend on each other: each one is chosen on its own, whatever its name.
- The choice is saved in `.probe/local.yml` and comes back at the next start. A value the config no longer
  lists gives the first one again.
- With [several environments](#several-environments), one choice applies to every column, and the panel
  lists the parameters of every file. A file that does not list the chosen value keeps its first one.

## Options saved for your machine

`o` and the panels save what you change in `.probe/local.yml`:

```yaml
dashboard: { interval: 5, timeout: 3, notify: true, parameters: { tenant: globex } }
services:
  db: { skip: true }
```

- **Skip**: a skipped service is left out of `probe check`, `probe wait` and the dashboard, and shown as
  `skipped`. Name it (`probe check db`) and it is checked anyway.
- **Notifications**: with `notify` on, a desktop notification says when a service has been down for 60 seconds,
  and when it comes back after that. A service that comes back sooner, a restart for instance, gives none
  (since 0.20.0). Nothing is notified while the terminal of the dashboard has the focus. The terminal reports
  it at each change of window (in tmux: `set -g focus-events on`): until the first one, or when it never does,
  the focus is not known and the notification is shown. A notification names the services and nothing
  else. It needs `notify-send` on Linux; nothing to install on macOS.

A change that cannot be saved (a read-only file, or one that is not valid YAML) still applies until you quit.
The dashboard shows `not saved: …`, and says it again when it closes.

## Several environments

With [environments](environments.md) in `.probe/envs/`, the services table gets one column per environment,
`local` first, and the header lists them as tabs next to `all`.

```
 probe   all   local   prod
│ service   local     prod         last  uptime trend │
│ api       ● up      ● up         12ms  100.0%     ▁▁ │
│ db        ● down    · -          12ms    0.0%      ▁ │
```

- `←` `→` or `h` `l` change environment. The latency, uptime and response panels follow the selected one.
- `·` is a service the environment does not have.
- `Enter`, `u`, `c` and `b` work on the selected cell.
- `n` creates an environment: it asks for a name and writes its file in `.probe/envs/`.
- The other environments are read-only: `a`, `e` and `d` say which file to change.
- A file that cannot be read shows `!` next to its name, with the reason when you select it.
- A notification names the environment (`prod/api`).
