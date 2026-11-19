# Completion

Tab completes the commands, their options, the names of your services (`probe check a<Tab>`), your
environments after `--env` and your [tags](tags.md) after `--tag`.

```sh
eval "$(probe completion zsh)"     # in ~/.zshrc, after compinit
eval "$(probe completion bash)"    # in ~/.bashrc (macOS: ~/.bash_profile)
probe completion fish | source     # in ~/.config/fish/config.fish
```

To save the script once instead:

- zsh: `probe completion zsh > ~/.zfunc/_probe`, with `~/.zfunc` in your `fpath`.
- fish: `probe completion fish > ~/.config/fish/completions/probe.fish`.
- bash: `probe completion bash > ~/.local/share/bash-completion/completions/probe`.

It works with the bash 3.2 of macOS.

## After an update

The `eval` lines always run the script of the probe you have, so they never go stale. A script you saved
is a copy: it carries a first line `# probe completion <version>`. When probe shows what is new after an
update, it reads the first lines of the saved copies in the places above, and if one is older than the
running probe (or has no marker) it adds a line such as:

```
! Saved zsh completion is from 1.1.0: run `probe completion zsh > ~/.zfunc/_probe`
```
