//! LLM providers / models settings section.
//!
//! Owns the providers data model, validation, and the OS-keychain handling for
//! API keys. The section-agnostic Tauri commands (`get_settings`,
//! `save_settings`) live in [`super`]; this module owns the providers-specific
//! commands (`all_model_names`, `get_providers`, `new_provider_id`).
//!
//! ## API keys live *on* `Provider`, but never in `settings.json`
//!
//! [`Provider::api_key`] is a real, in-memory field — [`super::Settings`] holds
//! *everything*, whether it is backed by the file or the keychain. What differs
//! is **how** each section is mapped in each direction. This module provides the
//! four per-section mappers the root [`super::SettingsState`] calls:
//!
//! - **reading** ([`load_provider_keys`]): after `settings.json` is parsed, the
//!   keys are read back from the OS keychain into `Provider::api_key`.
//! - **storing** ([`store_provider_keys`] + [`strip_provider_keys`]): on
//!   `persist`, keys are written to the keychain and stripped from the copy that
//!   is serialized to the file — so the plaintext document never holds a secret.
//! - **sending to the FE** ([`redact_provider_keys`]): a stored key is replaced
//!   with a common [`API_KEY_PLACEHOLDER`] so the UI can tell a key exists
//!   without the secret ever leaving the backend.
//! - **receiving from the FE** ([`apply_incoming_provider_keys`]): an incoming
//!   value equal to the placeholder means "the user didn't touch it" — the
//!   stored key is kept; any other value is a new key (empty = clear).
//!
//! Derived facets (which env vars are set, which models a provider exposes) are
//! *not* part of the settings document. They are computed on demand by the
//! dedicated commands [`get_providers`] and [`all_model_names`].

use std::collections::HashSet;

use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ProviderConfig};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use super::SettingsState;

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// LLM providers / models section of [`super::Settings`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmProviderSettings {
    pub providers: Vec<Provider>,
}

/// A configured LLM provider.
///
/// [`kind`](Provider::kind) is genai's own [`AdapterKind`] — a single enum that
/// already covers both the native vendors (OpenAI, Anthropic, Gemini, Groq,
/// Ollama, DeepSeek, Cohere, xAI, …) and the OpenAI-compatible custom-endpoint
/// case (use [`AdapterKind::OpenAI`] with a `base_url`). Treating all kinds
/// uniformly keeps the provider model flat: `base_url` is an optional custom
/// endpoint override on top of whichever adapter `kind` selects.
///
/// [`api_key`](Provider::api_key) is the one field with special lifecycle: it is
/// held in memory but backed by the OS keychain, never `settings.json`. See the
/// module docs for the four mappers that move it in each direction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    /// Stable opaque id (UUID). Also the keychain entry name.
    pub id: String,
    /// Display label.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// Logs alias.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub alias: String,
    /// Which genai adapter this provider routes to. `OpenAI` doubles for
    /// OpenAI-compatible custom endpoints (set `base_url`).
    pub kind: AdapterKind,
    /// Optional custom endpoint override for `kind`. When absent, genai uses the
    /// adapter's native endpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub models: Vec<ModelEntry>,

    #[serde(default = "default_true")]
    pub enabled: bool,

    pub is_primary: bool,

    /// API key, backed by the OS keychain — **never** persisted to
    /// `settings.json` (see [`strip_provider_keys`]). Loaded from the keychain
    /// on startup ([`load_provider_keys`]), redacted to [`API_KEY_PLACEHOLDER`]
    /// when sent to the FE ([`redact_provider_keys`]), and reconciled against the
    /// stored value on save ([`apply_incoming_provider_keys`]).
    ///
    /// `None`/empty means "no key stored — let genai fall back to its env-var
    /// lookup". It is (de)serialized over IPC (so the placeholder can round-trip
    /// to and from the FE); the file write path strips it explicitly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// A model offered by a [`Provider`].
///
/// Besides [`name`], the **primary** model settings are [`max_tokens`] and
/// [`max_output_tokens`].
///
/// Note: `genai 0.6.5` only consumes `max_tokens` at present; `max_output_tokens`
/// is stored here for forward compatibility with adapter-specific limits.
///
/// [`name`]: ModelEntry::name
/// [`max_tokens`]: ModelEntry::max_tokens
/// [`max_output_tokens`]: ModelEntry::max_output_tokens
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    /// Model id, e.g. `gpt-4o`.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,

    #[serde(default = "default_true")]
    pub is_custom: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMeta {
    pub kind: AdapterKind,
    pub supports_custom_models: bool,
    pub env_key: String,
    pub env_key_provided: bool,
}

// ---------------------------------------------------------------------------
// Resolved model (selected-model → genai inputs)
// ---------------------------------------------------------------------------

/// A model selected for generation, resolved from a [`Settings`] provider list
/// against a model alias (bare name for a primary provider, or
/// `{provider_alias}::{model_name}` otherwise).
///
/// Carries everything `generation` needs to build a `genai::Client` and a
/// `ChatOptions` — the real `model_name` (alias prefix stripped), the adapter
/// `kind`, the optional custom `base_url`, the optional keychain-backed
/// `api_key` (set when the user provided a key; `None` lets genai fall back to
/// the adapter's default env-var lookup), and the per-model token caps.
///
/// Owned and `Send`, so it can move across the `.await` boundary in
/// `send_chat_message`'s spawned task.
#[derive(Debug, Clone)]
pub struct ResolvedModel {
    /// Echoed into the assistant message's `model` field for traceability.
    pub alias: String,
    pub kind: AdapterKind,
    /// Real model name sent to genai (the `namespace::` prefix is stripped).
    pub model_name: String,
    pub base_url: Option<String>,
    /// Keychain key, when the user set one. `None` => genai env-var fallback.
    pub api_key: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

/// Split `alias` on the first `::` into `(namespace, name)`, returning
/// `None` for the namespace when there isn't one (the primary-provider case).
fn split_alias(alias: &str) -> (Option<&str>, &str) {
    match alias.split_once("::") {
        Some((ns, name)) => (Some(ns), name),
        None => (None, alias),
    }
}

/// Resolve a model alias against the configured providers.
///
/// - `alias = None` (no selection): pick the default — the first enabled
///   primary provider's first model, else the first enabled model of any
///   provider, else return a user-facing error instructing the user to add a
///   model in Settings.
/// - bare `alias`: an exact model-name match among enabled primary providers.
/// - `{ns}::{name}`: an exact match where `ns` equals a non-primary
///   provider's `alias` (and `name` matches one of its models).
///
/// Disabled providers are skipped. Empty non-primary aliases are unmatchable
/// (validation would reject them, but they are defensive-skipped here).
pub fn resolve_model(providers: &[Provider], alias: &str) -> Result<ResolvedModel, String> {
    let from_entry =
        |p: &Provider, m: &ModelEntry, real_name: String, alias_out: String| ResolvedModel {
            alias: alias_out,
            kind: p.kind,
            model_name: real_name,
            base_url: p.base_url.clone(),
            api_key: p.api_key.clone().filter(|k| !k.is_empty()),
            max_tokens: m.max_tokens,
            max_output_tokens: m.max_output_tokens,
        };

    // Match against a bare/non-bare alias.

    let (ns, name) = split_alias(alias.trim());
    for p in providers {
        if !p.enabled {
            continue;
        }
        let primary_match = ns.is_none() && p.is_primary;
        let alias_match = ns.is_some() && !p.is_primary && p.alias.trim() == ns.unwrap();
        if !(primary_match || alias_match) {
            continue;
        }
        if let Some(m) = p.models.iter().find(|m| m.name == name) {
            return Ok(from_entry(p, m, m.name.clone(), alias.to_string()));
        }
    }
    return Err(format!(
        "No provider/model matches `{alias}`. Add or enable it in Settings."
    ));
}

// ---------------------------------------------------------------------------
// Keychain helpers
// ---------------------------------------------------------------------------

const KEYCHAIN_SERVICE: &str = "trinitty";

/// Sentinel the FE receives in place of a stored key and returns unchanged when
/// the user does not edit the field. A returning value equal to this means
/// "leave the keychain entry as-is".
pub(super) const API_KEY_PLACEHOLDER: &str = "••••••••••••••••••••••••";

fn entry_for(provider_id: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, provider_id).ok()
}

/// Returns the stored key, if any. `None` means "no key — fall back to env-var
/// lookup".
fn lookup_key(provider_id: &str) -> Option<String> {
    let entry = entry_for(provider_id)?;
    match entry.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        Ok(_) => None,
        Err(keyring::Error::NoEntry) | Err(keyring::Error::Ambiguous(_)) => None,
        Err(e) => {
            tracing::warn!(error = %e, provider_id, "keychain lookup failed");
            None
        }
    }
}

fn set_provider_key(provider_id: &str, key: &str) -> Result<(), String> {
    let entry = entry_for(provider_id).ok_or("keychain unavailable")?;
    entry
        .set_password(key)
        .map_err(|e| format!("keychain set_password: {e}"))
}

fn clear_provider_key(provider_id: &str) -> Result<(), String> {
    // A missing keychain (or missing entry) means there is nothing to clear —
    // treat both as success so saving key-less settings never fails on a host
    // without a secret service.
    let Some(entry) = entry_for(provider_id) else {
        return Ok(());
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete_credential: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Section mappers (the four directions the root SettingsState wires up)
// ---------------------------------------------------------------------------

/// **Reading** (keychain → memory). Populate each provider's in-memory
/// `api_key` from the OS keychain. Called by [`super::SettingsState::load`]
/// right after `settings.json` is parsed.
pub(super) fn load_provider_keys(providers: &mut [Provider]) {
    for p in providers.iter_mut() {
        p.api_key = lookup_key(&p.id);
    }
}

/// **Storing** (memory → keychain). Write each provider's `api_key` to the OS
/// keychain, or clear the entry when the key is absent/empty. Called by
/// [`super::SettingsState::persist`] alongside [`strip_provider_keys`], which
/// keeps the keys out of the serialized file.
pub(super) fn store_provider_keys(providers: &[Provider]) -> Result<(), String> {
    for p in providers {
        match p.api_key.as_deref() {
            Some(k) if !k.is_empty() => set_provider_key(&p.id, k)?,
            _ => clear_provider_key(&p.id)?,
        }
    }
    // TODO: remove keys for removed providers
    Ok(())
}

/// **Storing** (file copy). Drop every `api_key` so the value serialized to
/// `settings.json` never contains a secret. Operates on the throwaway clone the
/// caller serializes, not the live in-memory document.
pub(super) fn strip_provider_keys(providers: &mut [Provider]) {
    for p in providers.iter_mut() {
        p.api_key = None;
    }
}

/// **Sending to the FE**. Replace a stored key with [`API_KEY_PLACEHOLDER`] so
/// the UI can render "a key is set" without the secret leaving the backend; a
/// provider with no key gets `None`.
pub(super) fn redact_provider_keys(providers: &mut [Provider]) {
    for p in providers.iter_mut() {
        p.api_key = match p.api_key.as_deref() {
            Some(k) if !k.is_empty() => Some(API_KEY_PLACEHOLDER.to_string()),
            _ => None,
        };
    }
}

/// **Receiving from the FE**. Reconcile the keys on `incoming` against `current`
/// (the live, in-memory providers):
///
/// - placeholder (or field omitted) → the user did not edit the key; carry over
///   the current stored key so `persist` leaves the keychain entry alone.
/// - empty string → the user cleared the key.
/// - anything else → a new key the user typed.
pub(super) fn apply_incoming_provider_keys(current: &[Provider], incoming: &mut [Provider]) {
    let current_key = |id: &str| {
        current
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.api_key.clone())
    };

    for p in incoming.iter_mut() {
        match p.api_key.as_deref() {
            // Untouched: FE echoed the placeholder or omitted the field.
            Some(k) if k == API_KEY_PLACEHOLDER => p.api_key = current_key(&p.id),
            None => p.api_key = current_key(&p.id), // TODO: verify
            // Explicit clear.
            Some(k) if k.is_empty() => p.api_key = None,
            // New key typed by the user — keep as-is.
            Some(_) => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn default_true() -> bool {
    true
}

/// Whether `s` matches the alias grammar shared with the FE schema:
/// empty, or alphanumeric with `_`/`-` allowed inside (not at the ends).
///
/// Mirrors the yup regex `^$|^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$` in
/// `providers-section.schemas.ts`. Keeping this in lock-step means the
/// backend never persists an alias the UI would later reject.
fn is_valid_alias(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return true;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    if s.len() == 1 {
        return true;
    }
    let last = s.chars().next_back().unwrap();
    if !last.is_ascii_alphanumeric() {
        return false;
    }
    // First and last already vetted; the interior may use `_`/`-` as well.
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Validate the whole providers section before persisting. Returns a
/// user-facing message on failure.
///
/// Exposed as `pub(super)` so `save_settings` (in [`super`]) can call it.
pub(super) fn validate_providers(providers: &[Provider]) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut aliases = HashSet::new();
    for p in providers {
        if p.id.trim().is_empty() {
            return Err("provider id cannot be empty".into());
        }
        if !ids.insert(p.id.clone()) {
            return Err(format!("duplicate provider id: {}", p.id));
        }
        // `name` is required only for non-primary providers, mirroring the FE
        // yup schema in `providers-section.schemas.ts`: the primary provider of
        // a kind defaults to `''` and its UI field is disabled, so the backend
        // must not reject the empty default that the FE always sends for it.
        if !p.is_primary && p.name.trim().is_empty() {
            return Err("provider name cannot be empty".into());
        }
        // Alias surface for error messages: when `name` is empty (a primary
        // provider), use `id` so the message is still identifiable.
        let who = if p.name.trim().is_empty() {
            p.id.as_str()
        } else {
            p.name.as_str()
        };
        // Alias is optional, but when set it must match the same grammar the
        // FE enforces (alphanumeric with `_`/`-` only inside, not at the ends).
        if !is_valid_alias(&p.alias) {
            return Err(format!(
                "provider `{who}` has invalid alias: must be alphanumeric with `_`/`-` only inside"
            ));
        }
        // Names must be unique across providers when set; the primary provider
        // of a kind defaults to an empty `name` (its UI field is disabled), so
        // empty names are exempt — same convention as aliases.
        let name = p.name.trim();
        if !name.is_empty() && !names.insert(name.to_string()) {
            return Err(format!("provider `{who}` has duplicate name: {name}"));
        }
        // Aliases must be unique across providers when set; an empty alias is
        // not a real identifier, so multiple providers may leave it blank.
        let alias = p.alias.trim();
        if !alias.is_empty() && !aliases.insert(alias.to_string()) {
            return Err(format!("provider `{who}` has duplicate alias: {alias}"));
        }
        // `base_url` is optional for every kind: a custom endpoint override on
        // top of the adapter named by `kind`. We only reject an explicit empty
        // string — a `None` means "use the adapter's native endpoint".
        if let Some(u) = &p.base_url {
            if u.trim().is_empty() {
                return Err(format!("provider `{who}` has empty base URL"));
            }
        }

        // TODO: check single is_primary = true per AdapterKind

        let mut model_names = HashSet::new();
        for m in &p.models {
            if m.name.trim().is_empty() {
                return Err(format!("provider `{who}` has a model with empty name"));
            }
            if !model_names.insert(m.name.clone()) {
                return Err(format!("provider `{who}` has duplicate model: {}", m.name));
            }
            match (m.max_tokens, m.max_output_tokens) {
                (Some(mx), Some(out)) if out > mx => {
                    return Err(format!(
                        "provider `{who}` model `{}`: maxOutputTokens ({out}) must be <= maxTokens ({mx})",
                        m.name
                    ));
                }
                _ => {}
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Provider-specific Tauri commands
// ---------------------------------------------------------------------------

/// Resolve the effective API key for an ad-hoc provider request. A caller-supplied
/// `key` wins unless it is empty or the placeholder; in that case, if `id` names
/// a stored provider, its in-memory key is used. `None` lets genai fall back to
/// its env-var lookup.
///
/// Used by [`all_model_names`] so the settings UI can list models for a
/// provider whose key it only ever sees as the [`API_KEY_PLACEHOLDER`].
fn resolve_request_api_key(
    state: &SettingsState,
    key: Option<String>,
    id: Option<&str>,
) -> Option<String> {
    if let Some(k) = key {
        if !k.is_empty() && k != API_KEY_PLACEHOLDER {
            return Some(k);
        }
    }
    let id = id?;
    let guard = state.inner.lock().unwrap();
    guard
        .llm_providers
        .providers
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| p.api_key.clone())
        .filter(|k| !k.is_empty())
}

/// Live-fetch the model names a provider exposes via `genai::Client::all_model_names`.
///
/// `base_url` overrides the adapter's native endpoint; `key` (when present) is
/// sent as the auth credential, and otherwise genai falls back to the
/// adapter's env-var lookup. Both [`all_model_names`] (the settings-UI command)
/// and [`list_available_models`] (the chat-dropdown command, for Ollama) route
/// through here so the genai invocation lives in one place.
async fn fetch_models_from_genai(
    kind: AdapterKind,
    base_url: Option<&str>,
    key: Option<String>,
) -> Result<Vec<String>, String> {
    let mut config = ProviderConfig::default();
    if let Some(url) = base_url.filter(|u| !u.trim().is_empty()) {
        config = config.with_endpoint(Endpoint::from_owned(url.to_string()));
    }
    if let Some(k) = key {
        config = config.with_auth(AuthData::from_single(k));
    }
    // TODO: override for Anthropic
    genai::Client::default()
        .all_model_names(kind, config)
        .await
        .map_err(|e| format!("failed to list models: {e}"))
}

/// List the models a provider exposes, live (network) via `genai`.
///
/// `base_url` overrides the adapter's endpoint; `key`/`id` supply auth. When
/// `key` is the placeholder (or omitted) and `id` names a stored provider, that
/// provider's stored key is used — so the UI can list models for a provider
/// whose key it only ever sees as the placeholder.
#[tauri::command]
pub async fn all_model_names(
    kind: AdapterKind,
    base_url: Option<String>,
    key: Option<String>,
    id: Option<String>,
    state: State<'_, SettingsState>,
) -> Result<Vec<String>, String> {
    // Resolve the key before any `.await` so the non-Send MutexGuard is dropped
    // (the command future must be `Send`).
    let resolved_key = resolve_request_api_key(&state, key, id.as_deref());
    fetch_models_from_genai(kind, base_url.as_deref(), resolved_key).await
}

// ---------------------------------------------------------------------------
// list_available_models (chat model dropdown)
// ---------------------------------------------------------------------------

/// One selectable model in the chat model dropdown.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelOption {
    /// Human-readable label, currently the bare model name.
    pub display_name: String,
    /// Selection alias stored on the chat session. Bare for a primary provider,
    /// `{provider_alias}::{model_name}` otherwise — matches [`resolve_model`].
    pub alias: String,
}

/// A group of models offered by one provider, for the chat model dropdown.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderModels {
    /// Group label: the provider's display name if non-empty, else the kind's.
    pub provider_name: String,
    pub models: Vec<LlmModelOption>,
}

/// All models the user can select for chat, grouped by provider.
///
/// For Ollama providers the model list is fetched live via `genai` (Ollama is
/// the only adapter `all_model_names` queries dynamically); other adapters use
/// the models the user configured. Disabled providers, and non-primary providers
/// missing an `alias` (their models aren't addressable by alias), are skipped.
///
/// Live-fetch failures per provider do not fail the whole command — the group
/// comes back empty and the error is logged, so the dropdown still renders.
#[tauri::command]
pub async fn list_available_models(
    state: State<'_, SettingsState>,
) -> Result<Vec<LlmProviderModels>, String> {
    // Snapshot providers (including keychain keys) under the lock, then drop the
    // guard before any `.await` (command future must be `Send`).
    let providers = state.inner.lock().unwrap().llm_providers.providers.clone();

    let mut groups = Vec::with_capacity(providers.len());
    for p in providers {
        if !p.enabled {
            continue;
        }
        // Non-primary providers need a non-empty alias to be addressable.
        if !p.is_primary && p.alias.trim().is_empty() {
            tracing::warn!(
                provider_id = %p.id,
                "skipping non-primary provider with empty alias in list_available_models"
            );
            continue;
        }

        let group_name = if !p.name.trim().is_empty() {
            p.name.clone()
        } else {
            format!("{:?}", p.kind)
        };

        // Resolve effective auth for a potential live fetch: the keychain key
        // (already present in `p.api_key`), or None to let genai use the env var.
        let key = p.api_key.clone().filter(|k| !k.is_empty());

        let model_names: Vec<String> = match p.kind {
            AdapterKind::Ollama => {
                match fetch_models_from_genai(p.kind, p.base_url.as_deref(), key).await {
                    Ok(names) => names,
                    Err(e) => {
                        tracing::warn!(
                            provider_id = %p.id,
                            error = %e,
                            "failed to list models for provider; emitting empty group"
                        );
                        Vec::new()
                    }
                }
            }
            _ => p.models.iter().map(|m| m.name.clone()).collect(),
        };

        let options = model_names
            .into_iter()
            .map(|name| {
                let alias = if p.is_primary {
                    name.clone()
                } else {
                    format!("{}::{}", p.alias.trim(), name)
                };
                LlmModelOption {
                    display_name: name,
                    alias,
                }
            })
            .collect();

        groups.push(LlmProviderModels {
            provider_name: group_name,
            models: options,
        });
    }

    Ok(groups)
}

const PROVIDER_KINDS: &[AdapterKind] = &[
    AdapterKind::Anthropic,
    AdapterKind::DeepSeek,
    AdapterKind::Fireworks,
    AdapterKind::Gemini,
    AdapterKind::Groq,
    AdapterKind::MiniMax,
    AdapterKind::Moonshot,
    AdapterKind::Ollama,
    AdapterKind::OllamaCloud,
    AdapterKind::OpenAI,
    AdapterKind::OpenRouter,
    AdapterKind::Together,
    AdapterKind::Vertex,
    AdapterKind::Xai,
    AdapterKind::Zai,
];

#[tauri::command]
pub fn get_providers() -> Vec<ProviderMeta> {
    PROVIDER_KINDS
        .iter()
        .map(|kind| {
            let env_key = kind.default_key_env_name();
            let env_key_provided = env_key
                .map(|name| std::env::var(name).is_ok())
                .unwrap_or(false);

            let supports_custom_models = match kind {
                AdapterKind::Ollama => false,
                _ => true,
            };

            ProviderMeta {
                kind: *kind,
                env_key_provided,
                env_key: env_key.unwrap_or_default().to_string(),
                supports_custom_models,
            }
        })
        .collect()
}

/// New unique provider id. Exposed as a command so the UI can request one when
/// adding a provider without constructing a uuid client-side.
#[tauri::command]
pub fn new_provider_id() -> String {
    Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str, name: &str, kind: AdapterKind, base_url: Option<&str>) -> Provider {
        Provider {
            id: id.into(),
            name: name.into(),
            alias: String::new(),
            kind,
            base_url: base_url.map(Into::into),
            models: vec![],
            enabled: true,
            is_primary: false,
            api_key: None,
        }
    }

    fn model(name: &str) -> ModelEntry {
        ModelEntry {
            name: name.into(),
            max_tokens: None,
            max_output_tokens: None,
            is_custom: true,
        }
    }

    #[test]
    fn validate_accepts_provider_without_base_url() {
        // `base_url` is optional for every kind: None means "use the adapter's
        // native endpoint".
        let providers = vec![p("a", "OpenAI compat", AdapterKind::OpenAI, None)];
        validate_providers(&providers).unwrap();
    }

    #[test]
    fn validate_rejects_duplicate_provider_ids() {
        let providers = vec![
            p("a", "One", AdapterKind::OpenAI, Some("https://x/v1/")),
            p("a", "Two", AdapterKind::OpenAI, Some("https://y/v1/")),
        ];
        let err = validate_providers(&providers).unwrap_err();
        assert!(err.contains("duplicate provider id"));
    }

    #[test]
    fn validate_rejects_duplicate_model_names() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, Some("https://x/v1/"));
        prov.models.push(model("m"));
        prov.models.push(model("m"));
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("duplicate model"));
    }

    #[test]
    fn validate_rejects_output_above_tokens() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, Some("https://x/v1/"));
        prov.models.push(ModelEntry {
            name: "m".into(),
            max_tokens: Some(100),
            max_output_tokens: Some(200),
            is_custom: true,
        });
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("maxOutputTokens"));
    }

    #[test]
    fn validate_accepts_native_kind_without_base_url() {
        let prov = p("a", "Gemini", AdapterKind::Gemini, None);
        validate_providers(&[prov]).unwrap();
    }

    #[test]
    fn api_key_never_serialized_to_file() {
        // The file-copy strip mapper must remove any key before serialization,
        // so `settings.json` never carries a secret.
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.api_key = Some("sk-secret".into());

        let mut file_copy = [prov.clone()];
        strip_provider_keys(&mut file_copy);
        let json = serde_json::to_string(&file_copy[0]).unwrap();
        assert!(!json.contains("sk-secret"));
        assert!(!json.contains("apiKey"));
    }

    #[test]
    fn empty_name_and_alias_omitted_from_serialization() {
        // A primary provider defaults to empty `name`/`alias`; both fields
        // carry `#[serde(default, skip_serializing_if = "String::is_empty")]`,
        // so the wire format omits them when empty — matching the FE's TS type
        // where they're effectively optional after a primary round-trip.
        let mut prov = p("a", "", AdapterKind::OpenAI, None);
        prov.is_primary = true;
        let json = serde_json::to_string(&prov).unwrap();
        assert!(!json.contains("\"name\""));
        assert!(!json.contains("\"alias\""));

        // Non-empty values serialize normally.
        let mut prov = p("a", "My Provider", AdapterKind::OpenAI, None);
        prov.alias = "mine".into();
        let json = serde_json::to_string(&prov).unwrap();
        assert!(json.contains("\"name\":\"My Provider\""));
        assert!(json.contains("\"alias\":\"mine\""));
    }

    #[test]
    fn redact_replaces_stored_key_with_placeholder() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.api_key = Some("sk-secret".into());
        let mut with_key = [prov];
        redact_provider_keys(&mut with_key);
        assert_eq!(with_key[0].api_key.as_deref(), Some(API_KEY_PLACEHOLDER));

        // A provider without a key stays `None` (not the placeholder).
        let mut without_key = [p("b", "Empty", AdapterKind::OpenAI, None)];
        redact_provider_keys(&mut without_key);
        assert_eq!(without_key[0].api_key, None);
    }

    #[test]
    fn incoming_placeholder_keeps_stored_key() {
        let mut current = p("a", "OpenAI", AdapterKind::OpenAI, None);
        current.api_key = Some("sk-stored".into());

        // FE echoes the placeholder back → the stored key must be preserved.
        let mut incoming = p("a", "OpenAI", AdapterKind::OpenAI, None);
        incoming.api_key = Some(API_KEY_PLACEHOLDER.into());

        let mut incoming = [incoming];
        apply_incoming_provider_keys(&[current], &mut incoming);
        assert_eq!(incoming[0].api_key.as_deref(), Some("sk-stored"));
    }

    #[test]
    fn incoming_new_key_and_clear_are_honored() {
        let mut current = p("a", "OpenAI", AdapterKind::OpenAI, None);
        current.api_key = Some("sk-old".into());
        let current = [current];

        // A new, non-placeholder value replaces the stored key.
        let mut new_key = p("a", "OpenAI", AdapterKind::OpenAI, None);
        new_key.api_key = Some("sk-new".into());
        let mut new_key = [new_key];
        apply_incoming_provider_keys(&current, &mut new_key);
        assert_eq!(new_key[0].api_key.as_deref(), Some("sk-new"));

        // An empty string clears the key.
        let mut cleared = p("a", "OpenAI", AdapterKind::OpenAI, None);
        cleared.api_key = Some(String::new());
        let mut cleared = [cleared];
        apply_incoming_provider_keys(&current, &mut cleared);
        assert_eq!(cleared[0].api_key, None);
    }

    #[test]
    fn provider_env_keys_maps_requested_kinds() {
        let metas = get_providers();
        // Ollama has no default key env var → always false, and doesn't
        // support custom models.
        let ollama = metas
            .iter()
            .find(|m| m.kind == AdapterKind::Ollama)
            .expect("Ollama listed");
        assert_eq!(
            *ollama,
            ProviderMeta {
                kind: AdapterKind::Ollama,
                supports_custom_models: false,
                env_key: String::new(),
                env_key_provided: false,
            }
        );
        // OpenAI mirrors the presence of its default key env var in the
        // environment.
        let openai = metas
            .iter()
            .find(|m| m.kind == AdapterKind::OpenAI)
            .expect("OpenAI listed");
        assert_eq!(
            openai.env_key_provided,
            AdapterKind::OpenAI
                .default_key_env_name()
                .map(|name| std::env::var(name).is_ok())
                .unwrap_or(false)
        );
    }

    // --- alias validation (parity with the FE yup schema) ------------------

    #[test]
    fn validate_accepts_empty_alias() {
        // An unset alias is the common case — it must always pass.
        let prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        validate_providers(&[prov]).unwrap();
    }

    #[test]
    fn validate_accepts_well_formed_aliases() {
        for alias in ["a", "gpt", "work-1", "my_provider", "A-B_C"] {
            let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
            prov.alias = alias.into();
            validate_providers(&[prov])
                .unwrap_or_else(|e| panic!("alias `{alias}` should be valid: {e}"));
        }
    }

    #[test]
    fn validate_rejects_alias_with_leading_dash() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.alias = "-bad".into();
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("invalid alias"), "got: {err}");
    }

    #[test]
    fn validate_rejects_alias_with_trailing_underscore() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.alias = "bad_".into();
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("invalid alias"));
    }

    #[test]
    fn validate_rejects_alias_with_space() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.alias = "two words".into();
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("invalid alias"));
    }

    #[test]
    fn validate_rejects_duplicate_alias() {
        let mut a = p("a", "OpenAI", AdapterKind::OpenAI, None);
        a.alias = "shared".into();
        let mut b = p("b", "Anthropic", AdapterKind::Anthropic, None);
        b.alias = "shared".into();
        let err = validate_providers(&[a, b]).unwrap_err();
        assert!(err.contains("duplicate alias"), "got: {err}");
    }

    #[test]
    fn validate_allows_multiple_providers_with_empty_alias() {
        // Empty alias is not a real identifier, so it's not subject to the
        // uniqueness check.
        let a = p("a", "OpenAI", AdapterKind::OpenAI, None);
        let b = p("b", "Anthropic", AdapterKind::Anthropic, None);
        validate_providers(&[a, b]).unwrap();
    }

    // --- duplicate name validation (parity with the FE yup schema) ----------

    #[test]
    fn validate_rejects_duplicate_name() {
        let a = p("a", "My Provider", AdapterKind::OpenAI, None);
        let b = p("b", "My Provider", AdapterKind::Anthropic, None);
        let err = validate_providers(&[a, b]).unwrap_err();
        assert!(err.contains("duplicate name"), "got: {err}");
        assert!(err.contains("My Provider"), "got: {err}");
    }

    #[test]
    fn validate_allows_multiple_providers_with_empty_name() {
        // A primary provider of a kind defaults to empty `name`; multiple such
        // primaries must not trip the uniqueness check (and must not trip the
        // separate "name required" rule, which only applies to non-primary).
        let mut a = p("a", "", AdapterKind::OpenAI, None);
        a.is_primary = true;
        let mut b = p("b", "", AdapterKind::Anthropic, None);
        b.is_primary = true;
        validate_providers(&[a, b]).unwrap();
    }

    // --- previously-untested validation rules ------------------------------

    #[test]
    fn validate_rejects_empty_provider_id() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.id = "  ".into();
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("provider id cannot be empty"));
    }

    #[test]
    fn validate_rejects_empty_provider_name_for_non_primary() {
        // The FE only requires `name` for non-primary providers; the BE
        // follows suit, so a non-primary provider with an empty name errors.
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.name = "".into();
        prov.is_primary = false;
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("provider name cannot be empty"));
    }

    #[test]
    fn validate_accepts_empty_name_for_primary_provider() {
        // A primary provider can have an empty `name` — the FE always sends the
        // empty default for it (the field is disabled, placeholder is the kind).
        let mut prov = p("a", "", AdapterKind::OpenAI, None);
        prov.is_primary = true;
        validate_providers(&[prov]).unwrap();
    }

    #[test]
    fn validate_primary_with_empty_name_names_id_in_error() {
        // When `name` is empty, error messages for *other* failures must
        // identify the provider by `id` — so a user can still see which
        // provider is misconfigured.
        let mut prov = p("abc-id", "", AdapterKind::OpenAI, None);
        prov.is_primary = true;
        prov.alias = "-bad".into();
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("`abc-id`"));
        assert!(err.contains("invalid alias"));
    }

    #[test]
    fn validate_rejects_empty_base_url_string() {
        // `None` is fine (use the adapter's native endpoint); an explicit empty
        // string is a mistake we surface as an error.
        let prov = p("a", "OpenAI", AdapterKind::OpenAI, Some("   "));
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("empty base URL"));
    }

    #[test]
    fn validate_rejects_model_with_empty_name() {
        let mut prov = p("a", "OpenAI", AdapterKind::OpenAI, None);
        prov.models.push(ModelEntry {
            name: "  ".into(),
            max_tokens: None,
            max_output_tokens: None,
            is_custom: true,
        });
        let err = validate_providers(&[prov]).unwrap_err();
        assert!(err.contains("empty name"));
    }

    // --- apply_incoming_provider_keys: None branch --------------------------

    #[test]
    fn incoming_omitted_key_keeps_stored_key() {
        // When the FE sends no `apiKey` field (None after deserialization), the
        // stored key must be carried over — the user didn't touch the field.
        let mut current = p("a", "OpenAI", AdapterKind::OpenAI, None);
        current.api_key = Some("sk-stored".into());

        let mut incoming = p("a", "OpenAI", AdapterKind::OpenAI, None);
        incoming.api_key = None;
        let mut incoming = [incoming];
        apply_incoming_provider_keys(&[current], &mut incoming);
        assert_eq!(incoming[0].api_key.as_deref(), Some("sk-stored"));
    }

    #[test]
    fn incoming_omitted_key_for_unknown_provider_stays_none() {
        // An incoming provider with no matching stored id and no key stays empty
        // rather than becoming the placeholder.
        let mut incoming = p("unknown-id", "OpenAI", AdapterKind::OpenAI, None);
        incoming.api_key = None;
        let mut incoming = [incoming];
        apply_incoming_provider_keys(&[], &mut incoming);
        assert_eq!(incoming[0].api_key, None);
    }

    // --- resolve_model ------------------------------------------------------

    /// Primary provider (empty alias, `is_primary = true`) with two models.
    fn primary(id: &str, kind: AdapterKind, models: &[&str]) -> Provider {
        Provider {
            id: id.into(),
            name: String::new(),
            alias: String::new(),
            kind,
            base_url: None,
            models: models.iter().map(|m| model(m)).collect(),
            enabled: true,
            is_primary: true,
            api_key: None,
        }
    }

    /// Non-primary provider with an alias and custom endpoint.
    fn aliased(
        id: &str,
        name: &str,
        alias: &str,
        kind: AdapterKind,
        base_url: &str,
        models: &[&str],
    ) -> Provider {
        Provider {
            id: id.into(),
            name: name.into(),
            alias: alias.into(),
            kind,
            base_url: Some(base_url.into()),
            models: models.iter().map(|m| model(m)).collect(),
            enabled: true,
            is_primary: false,
            api_key: None,
        }
    }

    #[test]
    fn resolve_model_primary_bare_alias() {
        let providers = vec![primary("openai", AdapterKind::OpenAI, &["gpt-4o", "gpt-5"])];
        let r = resolve_model(&providers, "gpt-4o").unwrap();
        assert_eq!(r.alias, "gpt-4o");
        assert_eq!(r.model_name, "gpt-4o");
        assert_eq!(r.kind, AdapterKind::OpenAI);
        assert_eq!(r.base_url, None);
        assert_eq!(r.api_key, None);
    }

    #[test]
    fn resolve_model_non_primary_namespaced_alias() {
        let providers = vec![
            primary("openai", AdapterKind::OpenAI, &["gpt-4o"]),
            aliased(
                "router",
                "My Router",
                "myrouter",
                AdapterKind::OpenAI,
                "https://router/v1/",
                &["openai/gpt-4o", "claude-opus-4-5"],
            ),
        ];
        let r = resolve_model(&providers, "myrouter::openai/gpt-4o").unwrap();
        assert_eq!(r.alias, "myrouter::openai/gpt-4o");
        assert_eq!(r.model_name, "openai/gpt-4o");
        assert_eq!(r.kind, AdapterKind::OpenAI);
        assert_eq!(r.base_url.as_deref(), Some("https://router/v1/"));
    }

    #[test]
    fn resolve_model_strips_prefix_in_real_name() {
        // The alias stored on the session keeps the `alias::` prefix; the name
        // sent to genai must be the bare model name.
        let providers = vec![
            primary("openai", AdapterKind::OpenAI, &["gpt-4o"]),
            aliased("r", "R", "r", AdapterKind::OpenAI, "https://x", &["m1"]),
        ];
        let r = resolve_model(&providers, "r::m1").unwrap();
        assert_eq!(r.alias, "r::m1");
        assert_eq!(r.model_name, "m1");
    }

    #[test]
    fn resolve_model_uses_keychain_key_when_present() {
        let mut prov = primary("openai", AdapterKind::OpenAI, &["gpt-4o"]);
        prov.api_key = Some("sk-from-keychain".to_string());
        let r = resolve_model(&[prov], "gpt-4o").unwrap();
        assert_eq!(r.api_key.as_deref(), Some("sk-from-keychain"));
    }

    #[test]
    fn resolve_model_propagates_max_tokens() {
        let mut prov = primary("openai", AdapterKind::OpenAI, &["gpt-4o"]);
        prov.models[0].max_tokens = Some(4096);
        prov.models[0].max_output_tokens = Some(1024);
        let r = resolve_model(&[prov], "gpt-4o").unwrap();
        assert_eq!(r.max_tokens, Some(4096));
        assert_eq!(r.max_output_tokens, Some(1024));
    }

    #[test]
    fn resolve_model_skips_disabled_providers() {
        let mut prov = primary("openai", AdapterKind::OpenAI, &["gpt-4o"]);
        prov.enabled = false;
        let providers = vec![prov];
        let err = resolve_model(&providers, "gpt-4o").unwrap_err();
        assert!(err.contains("No provider/model matches"));
    }

    #[test]
    fn resolve_model_unresolvable_alias_errors() {
        let providers = vec![primary("openai", AdapterKind::OpenAI, &["gpt-4o"])];
        let err = resolve_model(&providers, "grok-99").unwrap_err();
        assert!(err.contains("No provider/model matches"));
    }
}
