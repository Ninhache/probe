# Completion

Tab completes the commands, their options, the names of your services (`probe check a<Tab>`), your
environments after `--env`, your [tags](tags.md) after `--tag`, the service types after `probe add --type` and
the methods after `--method`.

Options come with their description (zsh, fish, PowerShell), and an option already given is not offered again,
except the ones you can repeat (`--header`, `--setenv`, `--tag`, `--set`). Once its name is typed,
`probe add api <Tab>` offers the options without a `-`. After `--type postgres` (or `--command`), it offers only
the options that type reads: `--user` and `--database`, not `--path` or `--method`. Nothing is completed after
`--`. Short aliases such as `-p` are not tracked: `-p 3000` still lets `--port` be offered.

```sh
eval "$(probe completion zsh)"     # in ~/.zshrc, after compinit
eval "$(probe completion bash)"    # in ~/.bashrc (macOS: ~/.bash_profile)
probe completion fish | source     # in ~/.config/fish/config.fish
```

In PowerShell, add one of these to your profile (`$PROFILE`, usually
`Documents/PowerShell/Microsoft.PowerShell_profile.ps1`):

```powershell
probe completion powershell | Out-String | Invoke-Expression
```

or append the script to it once with `probe completion powershell >> $PROFILE`.

To save the script once instead:

- zsh: `probe completion zsh > ~/.zfunc/_probe`, with `~/.zfunc` in your `fpath`.
- fish: `probe completion fish > ~/.config/fish/completions/probe.fish`.
- bash: `probe completion bash > ~/.local/share/bash-completion/completions/probe`.

It works with the bash 3.2 of macOS.

A script appended to `$PROFILE` is not looked at after an update (the profile holds other things): prefer the
`Invoke-Expression` line, which never goes stale.

## After an update

The `eval` lines always run the script of the probe you have, so they never go stale. A script you saved
is a copy: it carries a first line `# probe completion <version>`. When probe shows what is new after an
update, it reads the first lines of the saved copies in the places above, and if one is older than the
running probe (or has no marker) it adds a line such as:

```
! Saved zsh completion is from 1.1.0: run `probe completion zsh > ~/.zfunc/_probe`
```
