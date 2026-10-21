# fetchproof: hand a hook on to what git would have run without the kit (ADR-0112).
# Sourced by every hook in this folder; not a hook itself - git runs only hook names.
#
# git runs hooks from ONE folder, and the kit's install made it this one. Before that, git ran
# the folder core.hooksPath held - recorded by the install as fetchproof.previousHooksPath -
# or, with none, the repository's own hooks. hand_on runs that hook, with the same arguments
# and stdin, and returns 0 when there is none.
#
# --git-common-dir, not --git-path hooks: with core.hooksPath set, the latter names this
# folder, and the hook would call itself.
hand_on() {
  _name=$1
  shift
  _here=$(cd "$(dirname "$0")" && pwd -P)
  _to=$(git config --global --type=path --get fetchproof.previousHooksPath 2>/dev/null)
  if [ -z "$_to" ]; then
    _dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
    _to="$_dir/hooks"
  fi
  _hook="$_to/$_name"
  [ -f "$_hook" ] && [ -x "$_hook" ] || exit 0
  # A folder that IS this one has nothing further to hand on to.
  [ "$(cd "$_to" 2>/dev/null && pwd -P)" = "$_here" ] && exit 0
  exec "$_hook" "$@"
}
