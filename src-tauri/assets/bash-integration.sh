# Source the user's normal interactive config first
if [ -f ~/.bashrc ]; then . ~/.bashrc; fi

# Add -F to ls alias to enable LLM-visible type indicators
if [ "$(type -t ls)" = "alias" ]; then
  body=${BASH_ALIASES[ls]}          # raw alias body, no parsing
  alias ls="$body -F"
elif [ "$(type -t ls)" != "function" ]; then
  alias ls='ls -F'
fi

# --- OSC 133 shell integration ---------------------------------------------
#
# Markers are emitted via parameter expansion in PS0/PS1 (e.g. `${__osc133_a}`),
# NOT command substitution (`$(...)`). PS0/PS1 are re-parsed on every prompt,
# and some bash builds (notably Cygwin bash 5.3) fail to parse a `$(func)` in
# the prompt string, aborting prompt expansion with a
#   "command substitution: line 1: syntax error near unexpected token `}'"
# Precomputing the marker strings once per prompt (in PROMPT_COMMAND) and
# referencing them by name sidesteps the prompt-time command-substitution
# parser entirely, while keeping the emitted bytes identical.

__osc133_aid_counter=0

# Runs before each prompt (via PROMPT_COMMAND): emit D (finished) for the
# section that just ended, bump the counter, then precompute this prompt's
# A/B/C marker strings so PS0/PS1 only need cheap parameter expansion.
# $? must be captured first so other PROMPT_COMMAND entries don't clobber it.
__osc133_precmd() {
    local ec=$?
    if [[ $__osc133_aid_counter != 0 ]]; then
        printf '\033]133;D;%s;aid=%s-%s\007' "$ec" "$$" "$__osc133_aid_counter"
    fi
    __osc133_aid_counter=$((__osc133_aid_counter + 1))
    local id="$$-$__osc133_aid_counter"
    __osc133_a=$'\033]133;A;aid='"$id"$'\007'   # prompt start
    __osc133_b=$'\033]133;B;aid='"$id"$'\007'   # prompt end / input start
    __osc133_c=$'\033]133;C;aid='"$id"$'\007'   # command start
}

# PROMPT_COMMAND runs before PS1 is shown; run our precmd first (it captures $?),
# then any pre-existing PROMPT_COMMAND.
PROMPT_COMMAND='__osc133_precmd; '"${PROMPT_COMMAND:-}"

# PS0 is printed after a command is read but before it executes -> C marker.
PS0='${__osc133_c}'"${PS0:-}"
# Wrap PS1 with prompt-start (A) and prompt-end (B) markers.
PS1='${__osc133_a}'"$PS1"'${__osc133_b}'
