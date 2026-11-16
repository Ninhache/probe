# Completion

Tab completes the commands, their options and the names of your services (`probe check a<Tab>`).

```sh
eval "$(probe completion zsh)"     # in ~/.zshrc, after compinit
eval "$(probe completion bash)"    # in ~/.bashrc (macOS: ~/.bash_profile)
probe completion fish | source     # in ~/.config/fish/config.fish
```

To save the script once instead:

- zsh: `probe completion zsh > ~/.zfunc/_probe`, with `~/.zfunc` in your `fpath`.
- fish: `probe completion fish > ~/.config/fish/completions/probe.fish`.

It works with the bash 3.2 of macOS.
