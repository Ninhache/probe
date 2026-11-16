# Discover

On a terminal, `probe init` and `probe add` (alone, without arguments) show the services they find in the
project, as a list to tick.

- Nothing is ticked at first.
- Nothing is written unless you tick it.
- Off a terminal (script, CI), nothing is looked for.

## Where it looks

| Source                        | What it proposes                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Compose file                  | The ports a service publishes (`"8080:80"`), under the name of the service        |
| `.env`, `.env.local`          | `PORT`, and the `*_URL` that point to `http://localhost`                          |
| `package.json`                | The port a script names (`--port 4000`), or the usual one of its dev server       |
| Local ports                   | 3000, 3001, 4200, 4321, 5173, 8000 and 8080, when an HTTP server answers there    |

Details:

- **Compose file**: `compose.yaml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`, and its
  `override` file. A variable in a port takes its value from `.env`. Https, mail, database, cache and broker
  ports are left out.
- **`.env`**: only the host, the port and the path are kept. No other value is kept, shown or written.
- **`package.json`**: the dev servers known are vite, next, nuxt, astro and angular.
- **Local ports**: one `GET /` each, redirects not followed. `PROBE_DETECT_PORTS=4000,4001` tries other ports,
  `PROBE_DETECT_PORTS=` none.

## Adding by hand

`probe add` alone then asks for the name, the port, the path and the expected status, one at a time. Enter alone
keeps the default, Ctrl+C adds nothing.
