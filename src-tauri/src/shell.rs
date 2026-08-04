//! Shell context shared between the PTY backend and the chat system-prompt
//! build path.
//!
//! [`Shell`] captures the user's `$SHELL` once and exposes the shell-aware
//! operations both the PTY spawner and the chat system-prompt builder need:
//! - [`Shell::build_pty_command`] assembles a [`CommandBuilder`] for the
//!   interactive shell, sourcing the matching integration script.
//! - [`Shell::sysinfo`] runs the matching `*-sysinfo.sh` probe once per
//!   [`Shell`] (cached via [`OnceLock`]) and returns its stdout for embedding
//!   in the system prompt.
//!
//! Both [`crate::terminal`] and [`crate::chat`] obtain a [`Shell`] via
//! [`Shell::from_env`]; they read the same `$SHELL` value, so they agree on the
//! shell kind. Only the chat path keeps a long-lived [`Shell`] (to amortise the
//! sysinfo probe across turns); terminal.rs spawns the shell once and drops its
//! throwaway [`Shell`].

use portable_pty::CommandBuilder;
use std::path::Path;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Embedded scripts (one set per supported shell)
// ---------------------------------------------------------------------------

/// Bash integration script embedded at compile time.
static BASH_INTEGRATION: &str = include_str!("../assets/bash-integration.sh");
/// Zsh integration script embedded at compile time.
static ZSH_INTEGRATION: &str = include_str!("../assets/zsh-integration.sh");
/// Bash system-info probe embedded at compile time.
static BASH_SYSINFO: &str = include_str!("../assets/bash-sysinfo.sh");
/// Zsh system-info probe embedded at compile time.
static ZSH_SYSINFO: &str = include_str!("../assets/zsh-sysinfo.sh");

// ---------------------------------------------------------------------------
// ShellKind
// ---------------------------------------------------------------------------

/// The interactive shell kind supported by this app.
///
/// Defaults to [`ShellKind::Bash`] when the `SHELL` environment variable is
/// unset or points at an unsupported shell (see [`Shell::from_env`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Bash,
    Zsh,
}

impl ShellKind {
    /// Lowercase shell name, suitable as a fallback program name (relying on
    /// `PATH` resolution) and for embedding in log/sysinfo output.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bash => "bash",
            Self::Zsh => "zsh",
        }
    }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/// The interactive shell context derived from `$SHELL`.
///
/// Stores the raw `$SHELL` value so commands can be spawned via the user's
/// actual shell binary (rather than relying on `PATH` lookup of `"bash"` or
/// `"zsh"`), and caches the result of the matching `*-sysinfo.sh` probe so it
/// is only run once per instance. All shell-specific knowledge — which
/// integration script and which sysinfo probe to use, and how to feed the
/// integration script to the shell at startup — lives here, keeping
/// [`crate::terminal`] and [`crate::chat::generation`] shell-agnostic.
pub struct Shell {
    /// Raw `$SHELL` value (empty when the variable was unset).
    raw: String,
    /// Classified kind. Bash by default.
    kind: ShellKind,
    /// Cached sysinfo probe output; populated on first [`Shell::sysinfo`] call.
    sysinfo: OnceLock<String>,
}

impl Shell {
    /// Read `$SHELL` from the environment and classify it.
    ///
    /// Defaults to [`ShellKind::Bash`] when `SHELL` is unset or points at an
    /// unsupported shell — matching the previous bash-only behaviour and the
    /// bash default documented in the system prompt contract.
    pub fn from_env() -> Self {
        let raw = std::env::var("SHELL").unwrap_or_default();
        Self::from_raw(raw)
    }

    /// Build a [`Shell`] from an explicit `$SHELL` value.
    ///
    /// Used by [`from_env`](Self::from_env) and by tests; not part of the
    /// public surface. The sysinfo cache starts empty and is filled on the first
    /// [`Shell::sysinfo`] call.
    fn from_raw(raw: String) -> Self {
        let kind = classify(&raw);
        Self {
            raw,
            kind,
            sysinfo: OnceLock::new(),
        }
    }

    /// The classified shell kind.
    pub fn kind(&self) -> ShellKind {
        self.kind
    }

    /// The raw `$SHELL` value (empty when the variable was unset).
    pub fn raw(&self) -> &str {
        &self.raw
    }

    /// The program to exec for this shell: the actual `$SHELL` path when set,
    /// otherwise the kind's name (relying on `PATH` resolution). Using the real
    /// `$SHELL` binary matters on systems where the user's shell lives outside
    /// the default `PATH` (e.g. Nix-managed `/run/current-system/sw/bin/zsh`).
    fn program(&self) -> &str {
        if self.raw.is_empty() {
            self.kind.as_str()
        } else {
            &self.raw
        }
    }

    /// Integration script that pairs with this shell kind.
    fn integration_script(&self) -> &'static str {
        match self.kind {
            ShellKind::Bash => BASH_INTEGRATION,
            ShellKind::Zsh => ZSH_INTEGRATION,
        }
    }

    /// Sysinfo probe script that pairs with this shell kind.
    fn sysinfo_script(&self) -> &'static str {
        match self.kind {
            ShellKind::Bash => BASH_SYSINFO,
            ShellKind::Zsh => ZSH_SYSINFO,
        }
    }

    /// Build a [`CommandBuilder`] for the interactive shell, writing the
    /// matching integration rc files into the caller-provided `assets` dir and
    /// pointing the shell at them.
    ///
    /// `assets` is the caller's responsibility because its lifetime must
    /// outlive the spawn: `portable_pty`'s `CommandBuilder` stores the *path* to
    /// those files rather than their contents, and the spawned shell reads them
    /// from disk at startup (during rc sourcing). The caller therefore owns the
    /// RAII guard for the temp dir — see `terminal::TerminalSession::shell_assets`
    /// for how it is kept alive for the session lifetime.
    ///
    /// On Unix (the only platform where shell integration is supported today):
    /// - Bash uses `--rcfile` (which replaces `~/.bashrc` for the interactive
    ///   shell; the integration script itself sources `~/.bashrc` so the user's
    ///   config still applies).
    /// - Zsh has no `--rcfile`, so a temp `ZDOTDIR` is set, whose `.zshrc` is
    ///   the integration script (which itself sources `~/.zshrc`) and whose
    ///   `.zshenv` forwards the user's `~/.zshenv` so PATH and other env setup
    ///   still apply once `ZDOTDIR` is overridden.
    ///
    /// The actual `$SHELL` binary is used as the program (see [`program`](Self::program)).
    /// Returns `CommandBuilder` directly (no guard) since file-ownership now
    /// lives with the caller.
    pub fn build_pty_command(&self, assets: &Path) -> Result<CommandBuilder, String> {
        match self.kind {
            ShellKind::Bash => {
                let rcfile = assets.join("rc.sh");
                std::fs::write(&rcfile, self.integration_script()).map_err(|e| e.to_string())?;
                let mut c = CommandBuilder::new(self.program());
                c.arg("--rcfile");
                c.arg(&rcfile);
                c.arg("-i");
                Ok(c)
            }
            ShellKind::Zsh => {
                std::fs::write(
                    assets.join(".zshenv"),
                    "[ -f \"$HOME/.zshenv\" ] && . \"$HOME/.zshenv\"\n",
                )
                .map_err(|e| e.to_string())?;
                std::fs::write(assets.join(".zshrc"), self.integration_script())
                    .map_err(|e| e.to_string())?;
                let mut c = CommandBuilder::new(self.program());
                c.arg("-i");
                c.env("ZDOTDIR", assets);
                Ok(c)
            }
        }
    }

    /// Run the matching `*-sysinfo.sh` probe with this shell and return its
    /// stdout. The probe is piped to the shell's stdin (via `-c`), so no temp
    /// file needs to be written. Failures are logged and yield an empty string
    /// so the system prompt still renders — the model simply loses the
    /// environment hints rather than failing the whole chat turn.
    fn run_sysinfo(&self) -> String {
        let program = self.program();
        let script = self.sysinfo_script();
        match std::process::Command::new(program)
            .arg("-c")
            .arg(script)
            .output()
        {
            Ok(out) => {
                if !out.status.success() {
                    tracing::warn!(
                        shell = program,
                        status = ?out.status,
                        "sysinfo probe exited non-zero; including any output it produced"
                    );
                }
                String::from_utf8_lossy(&out.stdout).into_owned()
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    shell = program,
                    "failed to run sysinfo probe; system prompt will omit host info"
                );
                String::new()
            }
        }
    }

    /// Cached output of the per-shell `*-sysinfo.sh` probe, embedded into the
    /// system prompt.
    ///
    /// The probe runs the first time this is called (using [`OnceLock`]'s
    /// interior-sync) and its output is reused for every subsequent call on the
    /// same [`Shell`]. Callers on an async runtime should run the first call via
    /// `spawn_blocking` so the subprocess does not block a runtime worker
    /// thread; later calls return the cached value cheaply.
    pub fn sysinfo(&self) -> &str {
        self.sysinfo.get_or_init(|| self.run_sysinfo())
    }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/// Classify a `$SHELL` value into a [`ShellKind`], defaulting to Bash.
fn classify(shell: &str) -> ShellKind {
    if shell.ends_with("/zsh") || shell == "zsh" {
        ShellKind::Zsh
    } else {
        ShellKind::Bash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_zsh_paths() {
        assert_eq!(classify("/usr/bin/zsh"), ShellKind::Zsh);
        assert_eq!(classify("/bin/zsh"), ShellKind::Zsh);
        assert_eq!(classify("zsh"), ShellKind::Zsh);
    }

    #[test]
    fn classify_bash_and_unknowns_default_to_bash() {
        assert_eq!(classify("/bin/bash"), ShellKind::Bash);
        assert_eq!(classify("bash"), ShellKind::Bash);
        assert_eq!(classify("/usr/bin/fish"), ShellKind::Bash);
        assert_eq!(classify(""), ShellKind::Bash);
    }

    #[test]
    fn from_raw_uses_actual_shell_value_as_program() {
        let shell = Shell::from_raw("/usr/bin/zsh".to_string());
        assert_eq!(shell.kind(), ShellKind::Zsh);
        assert_eq!(shell.raw(), "/usr/bin/zsh");
        assert_eq!(shell.program(), "/usr/bin/zsh");
    }

    #[test]
    fn from_raw_unset_shell_falls_back_to_kind_name() {
        let shell = Shell::from_raw(String::new());
        assert_eq!(shell.kind(), ShellKind::Bash);
        assert!(shell.raw().is_empty());
        assert_eq!(shell.program(), "bash");
    }

    #[test]
    fn from_env_returns_supported_shell() {
        // `SHELL` may or may not be set in the test environment; we only assert
        // that the detected kind maps to a supported shell and that the helper
        // never panics.
        let shell = Shell::from_env();
        assert!(matches!(shell.kind(), ShellKind::Bash | ShellKind::Zsh));
    }

    #[test]
    fn sysinfo_caches_repeated_calls() {
        // First call runs the probe; the second must return the same `&str`
        // (proving the cache is hit rather than re-run).
        let shell = Shell::from_env();
        let a = shell.sysinfo();
        let b = shell.sysinfo();
        assert!(std::ptr::eq(a.as_ptr(), b.as_ptr()));
    }

    #[cfg(unix)]
    #[test]
    fn build_pty_command_writes_bash_rcfile_into_assets_dir() {
        // `build_pty_command` is a pure helper: the caller provides the temp dir,
        // and the function writes the integration rc files into it. It does not
        // own or clean up that dir (the caller does, via RAII).
        let dir = tempfile::tempdir().unwrap();
        let shell = Shell::from_raw("/bin/bash".to_string());
        shell
            .build_pty_command(dir.path())
            .expect("bash build_pty_command");
        assert!(dir.path().join("rc.sh").is_file(), "bash rcfile missing");
    }

    #[cfg(unix)]
    #[test]
    fn build_pty_command_writes_zsh_zdotdir_files_into_assets_dir() {
        let dir = tempfile::tempdir().unwrap();
        let shell = Shell::from_raw("/bin/zsh".to_string());
        shell
            .build_pty_command(dir.path())
            .expect("zsh build_pty_command");
        assert!(dir.path().join(".zshrc").is_file(), ".zshrc missing");
        assert!(dir.path().join(".zshenv").is_file(), ".zshenv missing");
    }
}
