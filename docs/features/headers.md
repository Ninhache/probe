# Headers and secrets

A service behind an API key or a login gets its headers in `config.yml`:

```yaml
services:
  api:
    url: https://dev.example.com/health
    headers:
      Accept: application/json
      Authorization: Bearer ${API_TOKEN}
```

From the command line (`-H` can be repeated):

```sh
probe add api --url https://dev.example.com/health -H 'Authorization: Bearer ${API_TOKEN}'
```

Keep the single quotes, or the shell fills the variable in. Written on one line between `{ }`, a value with a
variable needs quotes: `headers: { X-Api-Key: '${API_KEY}' }`.

A config with `headers` needs `probe` 0.13.0 or later.

## Variables

`${API_TOKEN}` is a variable: its value is never written in `config.yml`. `probe` takes it from the
environment, else from `.probe/local.yml`, which stays on your machine.

```sh
probe var                        # which variables are used, and where each is set
probe var API_TOKEN              # asks for the value, hidden, and keeps it in .probe/local.yml
probe var API_TOKEN < key.txt    # or reads it from a file or a pipe
probe var API_TOKEN --unset      # forget it
probe var API_TOKEN --env prod   # the value sent to the environment prod, and to no other
```

The [dashboard](dashboard.md) does both: `e` edits the headers of a service, `Enter` then `Enter` on a variable
sets its value.

The same variables fill the [`env` of a command service](../config.md#env), with the same rules: a reference
for a secret, a value that stays on your machine.

## Rules

- A header whose name says secret (`Authorization`, `Cookie`, `X-Api-Key`, anything with `token`, `key`,
  `secret`...) must use a variable. A value written as is makes the config invalid.
- A variable that is not set makes the service down, with the command that sets it. No request is sent.
- The value is never printed: not by `check`, `--json`, the dashboard, nor `probe curl`, which writes
  `$API_TOKEN` for the shell to fill in.
- With headers, a redirect is followed on the same host and port only. One that leaves for another address
  makes the service down and names it: the headers are never sent there.
