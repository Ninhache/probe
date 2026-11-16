# Contributing

```sh
pnpm install
pnpm test        # builds, then runs the tests
pnpm lint
```

Try it on the demo project:

```sh
pnpm build
cd examples/demo
node server.mjs &
make check PROBE="node ../../dist/cli.js"
```

## Release

Bump `version` in `package.json`, merge, then push a `v<version>` tag. The Release workflow:

1. Publishes to npm through trusted publishing: no token, the package trusts this repo's `release.yml` (set on
   npmjs.com, package Settings, Trusted Publisher).
2. Opens a PR on `ninhache/homebrew-tap` with the new `url` and `sha256` (secret `HOMEBREW_TAP_TOKEN`), which
   merges itself once the tap's CI is green.
3. Creates the GitHub Release, with notes listing the pull requests merged since the previous tag.
