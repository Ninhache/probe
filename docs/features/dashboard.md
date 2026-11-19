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
  tabs, `1` log and `2` response.
  The latency box is 6 rows high, borders included; the log and response panel takes the rest. On a short
  terminal the latency box shrinks first so the panel keeps a few rows.
- The log tab has one line per check, for every service of the selected environment: time, service, the
  environment on the all tab, the status code or the error, and the start of the body on one line (256 characters
  at most). A line where a service went up or down has a `▶` in front (`>` in ASCII) and is bold. `f` shows only
  those lines; the box says `changes only`. The last 1,000 lines are kept. The log follows the newest line;
  `PgUp` `PgDn` or the wheel scroll up, `End` follows again. The bodies were hidden of their secrets when they
  were checked, so a preview never shows one.
- The response tab shows the last answer of the selected service: status line, headers, then the body. `PgUp`
  `PgDn` scroll it.
- A JSON body (a `json` content type, or a body that parses as JSON) is shown indented and in colour, here and
  in the full response view. A body cut at the size cap, or one that is not valid JSON, is shown as received.
  Secrets are hidden before the body is laid out, and no string is decoded on the way. `c` copies the body as
  received, `b` copies the indented JSON.
- The mouse works. Every key hint on screen can be clicked, in the footer, in the border of a box and in a
  panel (`p parameters`, `esc close`, `1 log`, `changes only`): a click does what pressing that key does, and
  does nothing where the key would do nothing. A hint with several keys, like `PgUp PgDn`, has one target per
  key. Also:
  - click a service to select it, double-click it to open its detail;
  - click an environment tab to switch to it (the tabs are shown from two environments);
  - click a log line to select its service and show its response;
  - click the request URL in the detail of a service to open it, like `u`;
  - click `‹` or `›` next to a value in a form or a panel to step it, like the arrow keys;
  - click a row of the command palette (`:`) to run it.

  The wheel scrolls the lists, the log and the response. While a panel is open, it takes every click: a click
  outside it does nothing. A drag, a right click or the wheel over a hint does nothing.

  Hover: a hint or button under the pointer is shown in reverse video (with or without color). That needs a
  terminal that reports mouse motion (any-event tracking, mode 1003); in tmux, set `set -g mouse on`. In a
  terminal that never sends motion nothing lights up, and clicks still work. The highlight is dropped when the
  pointer leaves the window (where the terminal reports the focus), when a key is pressed, when a panel opens
  and on resize.

  To select text with the mouse, hold `Shift` (`Option` on macOS in some terminals) while dragging: how the
  terminal lets you bypass the mouse depends on the terminal.

## Keys

| Key             | What it does                                   |
| --------------- | ---------------------------------------------- |
| `↑` `↓` `j` `k` | Move                                           |
| `←` `→` `h` `l` | Change environment                             |
| `r`             | Check now                                      |
| `Enter`         | Open the detail of the selected service        |
| `1` `2`         | Log tab, response tab                          |
| `PgUp` `PgDn`   | Scroll the log or the response tab             |
| `End`           | Follow the newest line of the log tab          |
| `f`             | Log tab: only the changes of state, or all     |
| `y`             | Copy the lines on screen of the log tab        |
| `u`             | Open its URL in the browser                    |
| `c`             | Copy its curl command                          |
| `b`             | Copy the body of its last response             |
| `/`             | Filter by name; `Enter` keeps it, `Esc` clears |
| `p`             | Choose, add or edit [parameters](#parameters)  |
| `a`             | Add a service                                  |
| `e`             | Edit the selected service                      |
| `d`             | Remove the selected service, after a question  |
| `n`             | Create an [environment](#several-environments) |
| `D`             | Remove the environment of the open tab         |
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
`local` first, and the header lists them as tabs next to `all`. With a single environment (`local`, no file in
`.probe/envs/`), `all` and `local` would be the same list: the tabs are hidden, and `←` `→` `h` `l` and `Tab`
do nothing. They appear as soon as there are two environments, right after `n` creates one.

The tab bar always ends with `+ env`, even with a single environment, where it is the only entry.
A click on it does what `n` does, and it lights up under the pointer like the tabs.

```
 probe   all   local   prod
│ service   local     prod         last  uptime trend │
│ api       ● up      ● up         12ms  100.0%     ▁▁ │
│ db        ● down    · -          12ms    0.0%      ▁ │
```

- `←` `→` or `h` `l` change environment. The latency, uptime and response panels follow the selected one.
- `·` is a service the environment does not have.
- `Enter`, `u`, `c` and `b` work on the selected cell.
- `n` (or `+ env`) creates an environment: it asks for a name and writes its file in `.probe/envs/`. `Copy from`
  lists the environments to copy and, last, `empty`: a file with `schemaVersion` and no service.
- `D` on an environment tab asks `Remove prod?`, then deletes `.probe/envs/prod.yml`, closes its tab and goes back
  to `all` (or to the single view left). The values `.probe/local.yml` keeps for it, secrets included, stay.
  `local` cannot be removed. `z` brings the file and its tab back, `Z` removes it again.
- The other environments are read-only: `a`, `e` and `d` say which file to change.
- A file that cannot be read shows `!` next to its name, with the reason when you select it.
- A notification names the environment (`prod/api`).
