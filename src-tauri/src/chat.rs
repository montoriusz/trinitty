mod generation;

use crate::jsonl_store::{JsonlStore, ReadPage};
use crate::shell::Shell;
use crate::terminal::TerminalSession;
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use std::fmt::Debug;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// ChatMessage (stored in JSONL)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatMessage {
    User {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        id: String,

        ts: String,

        msg: String,
    },
    Assistant {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        id: String,

        ts: String,

        #[serde(default, skip_serializing_if = "String::is_empty")]
        cmdline: String,

        msg: String,

        model: String,
    },
    /// A finished terminal section, persisted by the PTY reader thread as soon
    /// as the command finishes (OSC 133 D). Carries the raw section bytes (for
    /// re-render into a separate xterm) and the vt100-parsed prompt/command/
    /// output text (for LLM context, replayed by `build_history`).
    TerminalSection {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        id: String,

        ts: String,

        aid: String,

        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,

        /// Whether the command was started (OSC 133 C fired) before finishing.
        executed: bool,

        cols: u16,
        rows: u16,

        /// Raw section bytes (lossy UTF-8), replayable via xterm `write`.
        raw: String,

        #[serde(default)]
        prompt: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        cmdline: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        output: String,
    },
}

impl ChatMessage {
    fn set_id(&mut self, id: String) {
        match self {
            ChatMessage::User { id: field, .. }
            | ChatMessage::Assistant { id: field, .. }
            | ChatMessage::TerminalSection { id: field, .. } => {
                *field = id;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri command payloads
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionInfo {
    pub id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPage {
    pub messages: Vec<ChatMessage>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagesChangedPayload {
    pub latest_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGenerationErrorPayload {
    pub message: String,
}

// ---------------------------------------------------------------------------
// Event helpers (also ensure typegen discovers the event names)
// ---------------------------------------------------------------------------

fn emit_messages_changed(app: &AppHandle, latest_id: String) {
    let _ = app.emit(
        "chat-messages-changed",
        ChatMessagesChangedPayload { latest_id },
    );
}

fn emit_generation_error(app: &AppHandle, message: String) {
    let _ = app.emit(
        "chat-generation-error",
        ChatGenerationErrorPayload { message },
    );
}

// ---------------------------------------------------------------------------
// ChatSession
// ---------------------------------------------------------------------------

pub struct ChatSession {
    pub id: String,
    store: Arc<JsonlStore<ChatMessage>>,
    generating: Arc<AtomicBool>,
    /// Shell context derived from `$SHELL`. Owned by the chat session because it
    /// caches the `*-sysinfo.sh` probe output for the lifetime of the session
    /// (one probe per session, embedded into every system prompt for that
    /// session). The PTY backend independently builds its own throwaway
    /// [`Shell`] from `$SHELL` to spawn the shell; both agree on the kind because
    /// they read the same environment variable.
    shell: Arc<Shell>,
}

impl ChatSession {
    /// Create a new chat session.
    pub fn new(app_data_dir: &std::path::Path) -> Result<Self, String> {
        let id = Utc::now().format("%Y-%m-%d_%H%M%S").to_string();

        let session_dir = &app_data_dir.join(format!("chat-{id}"));
        std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

        let store = JsonlStore::new(&session_dir.join("messages.jsonl")).with_on_read(
            |msg: &mut ChatMessage, offset: u32| {
                msg.set_id(offset.to_string());
            },
        );

        Ok(Self {
            id,
            store: Arc::new(store),
            generating: Arc::new(AtomicBool::new(false)),
            shell: Arc::new(Shell::from_env()),
        })
    }

    /// Share the underlying store with the PTY reader thread, which appends
    /// `TerminalSection` messages as commands finish.
    pub fn store(&self) -> Arc<JsonlStore<ChatMessage>> {
        Arc::clone(&self.store)
    }

    /// Append a user message and return its byte-offset ID.
    pub fn append_user(&self, msg: String) -> Result<String, String> {
        let ts = now_timestamp();
        let message = ChatMessage::User {
            id: String::new(),
            ts,
            msg,
        };
        let id = self.store.write(message).map_err(|e| e.to_string())?;
        Ok(id.to_string())
    }

    /// Read messages after `after_cursor` (byte offset).
    /// Pass `None` to read from the beginning.
    pub fn read_page(&self, after_cursor: Option<u32>) -> Result<ReadPage<ChatMessage>, String> {
        let start = after_cursor.unwrap_or(0);
        self.store.read(start, None).map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------
#[tauri::command]
pub fn get_chat_session(session: State<'_, ChatSession>) -> Result<ChatSessionInfo, String> {
    Ok(ChatSessionInfo {
        id: session.id.clone(),
    })
}

#[tauri::command]
pub fn read_chat_messages(
    after_cursor: Option<String>,
    session: State<'_, ChatSession>,
) -> Result<ChatPage, String> {
    let cursor: Option<u32> = after_cursor
        .as_deref()
        .map(str::parse)
        .transpose()
        .map_err(|_| "invalid cursor format".to_string())?;

    let page = session.read_page(cursor)?;
    let next_cursor = if page.items.is_empty() && page.next_id == cursor.unwrap_or(0) {
        // Nothing new — return the same cursor the client sent (or null)
        after_cursor
    } else {
        Some(page.next_id.to_string())
    };

    Ok(ChatPage {
        messages: page.items,
        next_cursor,
    })
}

#[tauri::command]
pub async fn send_chat_message(
    msg: String,
    model: String,
    app: AppHandle,
    terminal: State<'_, TerminalSession>,
    session: State<'_, ChatSession>,
    settings: State<'_, crate::settings::SettingsState>,
) -> Result<(), String> {
    // Reject if already generating.
    if session
        .generating
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("already generating".to_string());
    }

    // Snapshot the section the user is currently typing into (or, while a
    // long-running command is in progress, the section that is producing that
    // output). We hold the recorder only long enough to clone the in-flight
    // `SessionSection`; the (somewhat expensive) parse + JSONL write happen
    // outside the lock. Only sections whose prompt has finished rendering
    // (OSC 133 B) are worth persisting — an A-only section has no usable
    // prompt/command yet and would just produce an empty record.
    let live_section = {
        let recorder = terminal.recorder.lock().unwrap();
        recorder.current_snapshot().and_then(|section| {
            // Stop borrowing the recorder before parsing/serialising.
            if section.off_prompt_end.is_some() {
                Some(section.clone())
            } else {
                None
            }
        })
    };

    let store = Arc::clone(&session.store);

    // Persist the live snapshot as an `TerminalSection` BEFORE the user message
    // — `build_history` accumulates preceding `TerminalSection` records into the
    // next user turn's `<terminal>` block, so the assistant sees the prompt, the
    // commandline the user was typing, and any partial output a running command
    // has emitted so far. `executed` is whatever the recorder observed (the
    // command may already be running — OSC 133 C has fired); only the exit code
    // is forced to `None`, since no `D` has fired yet. The section is *kept* in the
    // recorder: the reader thread will persist it again as a completed
    // `TerminalSection` when OSC 133 D fires
    //
    // Dedup: skip the write when the live section has not changed since the
    // previously persisted live snapshot (same `aid`, `cmdline`, `output`).
    // See `recorder::persist_live_section_if_changed` for the rationale.
    if let Some(section) = live_section.as_ref() {
        match crate::recorder::persist_live_section_if_changed(
            section,
            &terminal.last_live_key,
            &store,
            &app,
        ) {
            Ok(true) => {}
            Ok(false) => {
                tracing::debug!(
                    aid = %section.aid,
                    "live terminal section empty or unchanged; skipping persist"
                );
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    aid = %section.aid,
                    "failed to persist live terminal section"
                );
            }
        }
    };

    // Append and broadcast the user message.
    let user_id = session.append_user(msg).inspect_err(|_| {
        session.generating.store(false, Ordering::SeqCst);
    })?;

    emit_messages_changed(&app, user_id);

    // Resolve the selected model against the configured providers before
    // spawning — `SettingsState::resolve_model` returns an owned, `Send`
    // descriptor (no `MutexGuard` crosses the `.await`), which is then moved
    // into the spawned task alongside the store/timestamp/sysinfo.
    let resolved_model = match settings.resolve_model(&model) {
        Ok(m) => m,
        Err(e) => {
            session.generating.store(false, Ordering::SeqCst);
            // Surface the resolution failure through the same channel as a
            // generation error so the chat pane shows it.
            emit_generation_error(&app, e);
            return Ok(());
        }
    };

    // Capture what the spawned task needs, then release the State borrow.
    let generating = session.generating.clone();
    let shell = Arc::clone(&session.shell);

    tauri::async_runtime::spawn(async move {
        let ts = now_timestamp();

        // Resolve the system-info probe once per session. `Shell::sysinfo` runs
        // the matching `*-sysinfo.sh` script on first call and returns the
        // cached output afterwards. The first call is wrapped in
        // `spawn_blocking` so the subprocess (a few hundred milliseconds of
        // shell startup + probes) does not block the async runtime's worker
        // thread; cached calls are cheap and the wrapping is harmless.
        let sysinfo = tauri::async_runtime::spawn_blocking(move || shell.sysinfo().to_string())
            .await
            .unwrap_or_default();

        match generation::generate_assistant_reply(&store, &ts, &sysinfo, &resolved_model).await {
            Ok(assistant_id) => {
                emit_messages_changed(&app, assistant_id.to_string());
            }
            Err(e) => {
                emit_generation_error(&app, e);
            }
        }

        generating.store(false, Ordering::SeqCst);
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_timestamp() -> String {
    Local::now().to_rfc3339()
}
