//! Terminal PTY session, commands, and reader thread.
//!
//! All terminal-related Tauri state, commands, and the PTY reader thread live
//! here. Output and shell-integration markers are streamed to the frontend over a
//! single ordered [`tauri::ipc::Channel`] as [`TerminalEvent`]s, replacing the
//! previous pair of `emit`/`listen` event channels (`pty-output` and the four
//! shell-integration events). Sharing one stream preserves send order between raw
//! output and context markers, eliminating the race between the old two events.

use crate::chat::ChatSession;
use crate::jsonl_store::JsonlStore;
use crate::osc133::{Segment, ShellEvent};
use crate::recorder::{LiveSectionKey, SessionRecorder, persist_section};
use crate::shell::Shell;
use portable_pty::{PtyPair, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{AppHandle, State, async_runtime::Mutex as AsyncMutex, ipc::Channel};
use tempfile::TempDir;

/// A single ordered stream of terminal events sent to the frontend over one
/// `tauri::ipc::Channel`.
///
/// `Output` carries raw PTY bytes (lossily decoded as UTF-8, matching the previous
/// `pty-output` behaviour); the remaining variants carry the non-positional
/// shell-integration context previously emitted as the four `prompt-*` /
/// `command-*` events. Positional decoration placement still relies on xterm.js'
/// own OSC-133 parser hook (which sees the same bytes via `Output`), because xterm
/// parses writes asynchronously and buffer coordinates are only known after a
/// write is processed — channel markers must not be used for buffer coordinates.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output {
        data: String,
    },
    PromptStarted {
        aid: Option<String>,
    },
    PromptEnded {
        aid: Option<String>,
    },
    CommandStarted {
        aid: Option<String>,
    },
    CommandFinished {
        exit_code: Option<i32>,
        aid: Option<String>,
    },
}

/// Translate an `osc133::ShellEvent` into the frontend-facing [`TerminalEvent`].
fn map_shell_event(event: ShellEvent) -> TerminalEvent {
    match event {
        ShellEvent::PromptStarted { aid } => TerminalEvent::PromptStarted { aid },
        ShellEvent::PromptEnded { aid } => TerminalEvent::PromptEnded { aid },
        ShellEvent::CommandStarted { aid } => TerminalEvent::CommandStarted { aid },
        ShellEvent::CommandFinished { exit_code, aid } => {
            TerminalEvent::CommandFinished { exit_code, aid }
        }
    }
}

/// Shared, swappable sink for `TerminalEvent`s.
///
/// The reader thread reads from this slot, while `create_shell` writes the
/// currently active frontend-facing `Channel` into it. Using a shared slot
/// instead of moving a `Channel` into the long-lived reader thread is what makes
/// the design HMR-safe: on a dev reload the frontend passes a fresh `Channel`,
/// and `create_shell` simply re-points the slot — the reader keeps reading the
/// active channel. A `std::sync::Mutex` (not a tokio mutex) is used because the
/// reader is a std thread and the critical section is a non-blocking `channel.send`.
pub type EventSlot = Arc<Mutex<Option<Channel<TerminalEvent>>>>;

/// Process-wide terminal state. One shell and one reader are spawned lazily by
/// `create_shell` and reused for the lifetime of the backend process; the only
/// thing that changes across dev HMR reloads is the `event_channel` slot.
pub struct TerminalSession {
    pub pty_pair: Arc<AsyncMutex<PtyPair>>,
    pub writer: Arc<AsyncMutex<Box<dyn Write + Send>>>,
    /// The currently active frontend-facing sink. `create_shell` overwrites this
    /// on every call (including HMR re-invocations).
    pub event_channel: EventSlot,
    /// Reader held in state until the first `create_shell` call spawns the reader
    /// thread that consumes it.
    pub reader: Arc<Mutex<Option<Box<dyn Read + Send>>>>,
    /// Guards so the reader thread is only spawned once across HMR reloads.
    pub reader_started: Arc<AtomicBool>,
    /// Guards so the shell process is only spawned once across HMR reloads.
    pub shell_started: Arc<AtomicBool>,
    /// Records finished sections (parsed + raw) for re-render and LLM context.
    /// Fed by the reader thread; read at send time for the live `<commandline>`.
    pub recorder: Arc<Mutex<SessionRecorder>>,
    /// Key of the most recently persisted *live* snapshot, so repeated sends
    /// that leave the live section unchanged are not re-persisted. Only touched
    /// by the live path in `send_chat_message`; the reader-thread (finished)
    /// path ignores it. Separate from `recorder`'s lock so the parse + write can
    /// happen outside the recorder lock.
    pub last_live_key: Arc<Mutex<Option<LiveSectionKey>>>,
    /// Owns the unique temp dir the spawned shell's integration rc files were
    /// written into by `Shell::build_pty_command`. The shell reads those files
    /// from disk at startup (after spawn), so the dir must outlive the spawn —
    /// and we have no clean sync for \"rc sourcing done\", so it stays alive for
    /// the lifetime of this `TerminalSession` and is RAII-cleaned on drop.
    /// Concurrent app instances get distinct temp dirs (no clobbering/leakage).
    pub shell_assets: Arc<Mutex<Option<TempDir>>>,
}

#[tauri::command]
pub async fn create_shell(
    on_event: Channel<TerminalEvent>,
    app: AppHandle,
    state: State<'_, TerminalSession>,
    chat: State<'_, ChatSession>,
) -> Result<(), String> {
    // 1. Re-point the slot to the freshly-provided channel. This is the only step
    //    that runs on an HMR re-invocation, so repeated `create_shell` calls are
    //    safe: one shell, one reader, the sink simply moves.
    *state.event_channel.lock().unwrap() = Some(on_event);

    // 2. Spawn the reader thread once.
    if !state.reader_started.swap(true, Ordering::SeqCst) {
        let reader = state
            .reader
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| "pty reader already taken".to_string())?;
        spawn_reader_thread(
            state.event_channel.clone(),
            reader,
            state.recorder.clone(),
            chat.store(),
            app,
        );
    }

    // 3. Spawn the shell into the PTY slave once.
    if !state.shell_started.swap(true, Ordering::SeqCst) {
        let mut cmd = {
            // Build the interactive-shell command (`bash --rcfile …` or
            // `zsh -i` with a temp `ZDOTDIR`) from `$SHELL`. All shell-specific
            // setup lives in `Shell::build_pty_command`; the terminal module is
            // shell-agnostic and just forwards the resulting `CommandBuilder`.
            let shell = Shell::from_env();
            tracing::info!(
                shell = shell.raw(),
                kind = shell.kind().as_str(),
                "spawning interactive shell"
            );
            // Create the temp dir here so this module owns its lifetime. The
            // shell reads the rc files from disk at startup, so the dir must
            // outlive the spawn; `TerminalSession::shell_assets` keeps it alive
            // for the session lifetime and RAII-cleans it on drop. Unique paths
            // mean concurrent app instances don't clobber each other's files.
            let assets = tempfile::tempdir().map_err(|e| e.to_string())?;
            let command = shell.build_pty_command(assets.path())?;
            *state.shell_assets.lock().unwrap() = Some(assets);
            command
        };

        cmd.env("TERM", "xterm-256color");

        let mut child = state
            .pty_pair
            .lock()
            .await
            .slave
            .spawn_command(cmd)
            .map_err(|e| e.to_string())?;

        // Block on child exit in the tokio blocking pool rather than a raw
        // std thread — same OS thread, but folded into the runtime for
        // consistency with the rest of the codebase.
        tauri::async_runtime::spawn_blocking(move || {
            let _ = child.wait();
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn write_to_pty(data: &str, state: State<'_, TerminalSession>) -> Result<(), ()> {
    write!(state.writer.lock().await, "{}", data).map_err(|_| ())
}

#[tauri::command]
pub async fn resize_pty(rows: u16, cols: u16, state: State<'_, TerminalSession>) -> Result<(), ()> {
    state
        .pty_pair
        .lock()
        .await
        .master
        .resize(PtySize {
            rows,
            cols,
            ..Default::default()
        })
        .map_err(|_| ())?;
    state.recorder.lock().unwrap().set_size(rows, cols);
    Ok(())
}

/// Spawn the PTY reader thread.
///
/// The thread owns a clone of the shared [`EventSlot`] (not a `Channel`): per
/// chunk it briefly locks the slot and, if a channel is present, `send`s. The
/// lock is only held around the `send`, never across `reader.read`, so an HMR
/// re-registration cannot be blocked by a blocking read.
fn spawn_reader_thread(
    slot: EventSlot,
    reader: Box<dyn Read + Send>,
    recorder: Arc<Mutex<SessionRecorder>>,
    store: Arc<JsonlStore<crate::chat::ChatMessage>>,
    app: AppHandle,
) {
    // For one PTY, a blocking thread is simple and avoids occupying a tokio
    // blocking-pool slot with a permanently-blocked task.
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut carry: Vec<u8> = Vec::new();
        // After CommandFinished (D), bash-integration.sh may emit a
        // buffer-clearing sequence (MSYS2 / ConPTY). Suppress forwarding
        // passthrough segments to the frontend until the next PromptStarted
        // (A) so the clearing bytes never reach the reinstantiated xterm.js.
        let mut suppress_passthrough = false;

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    // Split the chunk at OSC 133 boundaries and stream the
                    // ordered segments over the channel. Each segment's bytes
                    // are forwarded as `Output` so xterm.js' own OSC-133 parser
                    // hook can place positional decorations from buffer
                    // coordinates; each recognised sequence additionally
                    // produces its shell-integration context event. Splitting
                    // serially preserves send order between raw output and
                    // context markers within a chunk — the context event for a
                    // marker arrives immediately before that marker's bytes.
                    crate::osc133::scan(&mut carry, chunk, |segment| {
                        // 1. Forward to the live terminal (existing behaviour).
                        //    While `suppress_passthrough` is set (between D and
                        //    A), skip raw-byte Output events so the MSYS2
                        //    buffer-clearing sequence is not forwarded. Sequence
                        //    events (the markers themselves) are always sent.
                        {
                            let guard = slot.lock().unwrap();
                            if let Some(ch) = guard.as_ref() {
                                match &segment {
                                    Segment::Passthrough(bytes) => {
                                        if !suppress_passthrough {
                                            let _ = ch.send(TerminalEvent::Output {
                                                data: String::from_utf8_lossy(bytes).into_owned(),
                                            });
                                        }
                                    }
                                    Segment::Sequence { bytes, event } => {
                                        let _ = ch.send(map_shell_event(event.clone()));
                                        let _ = ch.send(TerminalEvent::Output {
                                            data: String::from_utf8_lossy(bytes).into_owned(),
                                        });
                                    }
                                }
                            }
                        }

                        // Update the suppress flag *after* forwarding so the D
                        // marker itself is still sent, and the A marker lifts
                        // the gate before its own bytes are forwarded.
                        if let Segment::Sequence { event, .. } = &segment {
                            match event {
                                ShellEvent::CommandFinished { .. } => {
                                    suppress_passthrough = true;
                                }
                                ShellEvent::PromptStarted { .. } => {
                                    suppress_passthrough = false;
                                }
                                _ => {}
                            }
                        }

                        // 2. Feed the recorder. When a CommandFinished closes
                        //    the active section, parse + persist it as a
                        //    `TerminalSection` chat message outside the recorder
                        //    lock so the section can be parsed without holding it.
                        let finished = recorder.lock().unwrap().feed(&segment);
                        if let Some(section) = finished {
                            if let Err(e) = persist_section(&section, &store, &app, false) {
                                tracing::warn!(
                                    error = %e,
                                    aid = %section.aid,
                                    "failed to persist terminal section"
                                );
                            }
                        }
                    });
                }
            }
        }
    });
}

/// Open the PTY pair and build the single [`TerminalSession`] backing the app.
///
/// The reader is stashed in state rather than spawned here: the reader thread is
/// spawned lazily by `create_shell` on first invocation, so dev HMR can re-point
/// the channel (and the shell can be spawned) through the idempotent command.
pub fn build_session() -> TerminalSession {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to open pty");

    let reader = pty_pair
        .master
        .try_clone_reader()
        .expect("failed to clone pty reader");
    let writer = pty_pair
        .master
        .take_writer()
        .expect("failed to take pty writer");

    TerminalSession {
        pty_pair: Arc::new(AsyncMutex::new(pty_pair)),
        writer: Arc::new(AsyncMutex::new(writer)),
        event_channel: Arc::new(Mutex::new(None)),
        reader: Arc::new(Mutex::new(Some(reader))),
        reader_started: Arc::new(AtomicBool::new(false)),
        shell_started: Arc::new(AtomicBool::new(false)),
        recorder: Arc::new(Mutex::new(SessionRecorder::new(80, 24))),
        last_live_key: Arc::new(Mutex::new(None)),
        shell_assets: Arc::new(Mutex::new(None)),
    }
}
