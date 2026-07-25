/**
 * Yup schema and helpers for the LLM providers settings form. Mirrors the
 * backend validation in `src-tauri/src/settings.rs` so the user gets inline
 * feedback before the round trip, and the BE rejection message is the rare
 * edge case.
 *
 * `Provider.kind` is genai's own `AdapterKind` (a flat serde enum); we reuse
 * the generated `Provider['kind']` literal union as the canonical type rather
 * than maintaining a side mirror of the variants.
 */
import * as yup from 'yup';
import type { ModelEntry, Provider, Settings } from '@/generated';
import { sanitizeAlias } from './provider-alias.helpers';

/**
 * Provider kind = genai `AdapterKind`. The variants are genai's serde names
 * (see `AdapterKind::as_str`); the `type_mappings` in `tauri.conf.json` makes
 * `tauri-typegen` emit them as an inline literal union on `Provider.kind`.
 */
export type AdapterKind = Provider['kind'];

/**
 * Display label for a kind. Mirrors genai's `AdapterKind::as_str()` so the UI
 * matches the names the crate reports elsewhere.
 */
export function adapterKindLabel(kind: AdapterKind): string {
  switch (kind) {
    case 'OpenAI':
      return 'OpenAI';
    case 'OpenAIResp':
      return 'OpenAI Responses';
    case 'Gemini':
      return 'Gemini';
    case 'Anthropic':
      return 'Anthropic';
    case 'Fireworks':
      return 'Fireworks';
    case 'Together':
      return 'Together';
    case 'Groq':
      return 'Groq';
    case 'Aihubmix':
      return 'AIHubMix';
    case 'Mimo':
      return 'Mimo';
    case 'Moonshot':
      return 'Moonshot';
    case 'Nebius':
      return 'Nebius';
    case 'Xai':
      return 'xAI';
    case 'DeepSeek':
      return 'DeepSeek';
    case 'Zai':
      return 'ZAI';
    case 'BigModel':
      return 'BigModel';
    case 'Aliyun':
      return 'Aliyun';
    case 'Baidu':
      return 'Baidu';
    case 'Cohere':
      return 'Cohere';
    case 'Ollama':
      return 'Ollama';
    case 'OllamaCloud':
      return 'Ollama Cloud';
    case 'Vertex':
      return 'Vertex AI';
    case 'GithubCopilot':
      return 'GitHub Copilot';
    case 'OpenCodeGo':
      return 'OpenCode Go';
    case 'BedrockApi':
      return 'Bedrock API';
    case 'OpenRouter':
      return 'OpenRouter';
    case 'MiniMax':
      return 'MiniMax';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export const modelSchema: yup.ObjectSchema<ModelEntry> = yup.object({
  name: yup.string().trim().required('Model name is required'),
  isCustom: yup.boolean().default(true).required(),
  maxTokens: yup
    .number()
    .nullable()
    .notRequired()
    .transform((v) => (v === '' ? null : v))
    .integer()
    .min(1, 'Max tokens must be a positive integer'),
  maxOutputTokens: yup
    .number()
    .nullable()
    .notRequired()
    .transform((v) => (v === '' ? null : v))
    .integer()
    .min(1, 'Max output tokens must be a positive integer'),
});

export const providerSchema: yup.ObjectSchema<Provider> = yup.object({
  id: yup.string().required(),
  name: yup
    .string()
    .trim()
    .default('')
    .when('isPrimary', ([isPrimary], schema) =>
      isPrimary === false
        ? schema.required('Provider name is required for non-default providers')
        : schema.notRequired(),
    ),
  alias: yup
    .string()
    .trim()
    .default('')
    .matches(
      /^$|^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/,
      'Alias must be lowercase alphanumeric with underscores and dashes inside',
    ),
  kind: yup.string<AdapterKind>().required(),
  baseUrl: yup
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .notRequired()
    .nullable(),
  enabled: yup.boolean().default(true).required(),
  isPrimary: yup.boolean().required(),
  apiKey: yup.string().trim().notRequired().nullable(),
  models: yup.array().of(modelSchema).default([]),
});

export type ProvidersFormValues = Settings['llmProviders'];

export const providersSectionSchema: yup.ObjectSchema<ProvidersFormValues> = yup.object({
  providers: yup
    .array()
    .of(providerSchema)
    .default([])
    .test(
      'unique-id-name-alias',
      'Provider name/alias must be unique across providers',
      // A non-arrow function is required to access `this.createError` /
      // `this.path`, so each duplicate field gets its own inline error rather
      // than one opaque error on the whole array. Empty `name`/`alias` are
      // exempt: the primary provider of a kind defaults to empty for both, so
      // multiple primaries would otherwise trip the uniqueness check.
      function (providers) {
        if (!providers) return true;

        // Indices of providers whose keying value collides with another's,
        // ignoring entries with an empty key.
        const duplicateIndices = (key: (p: Provider, index: number) => string | undefined) => {
          const byKey = new Map<string, number[]>();
          providers.forEach((p, index) => {
            const k = key(p, index);
            if (!k) return;
            byKey.set(k, [...(byKey.get(k) ?? []), index]);
          });
          return [...byKey.values()].filter((group) => group.length > 1).flat();
        };

        const dupNames = duplicateIndices((p) => p.name?.trim());
        const flaggedForName = new Set(dupNames);

        // Alias uniqueness uses the UI placeholder when `alias` is empty: a
        // name-only provider contributes `sanitizeAlias(name)` to the pool, so
        // two whose sanitized names collide are still flagged. Providers
        // already flagged for a duplicate name are skipped — that error is the
        // actionable one and surfacing both would be noise.
        const dupAliases = duplicateIndices((p, index) =>
          flaggedForName.has(index) ? undefined : p.alias?.trim() || sanitizeAlias(p.name ?? ''),
        );

        const errors = [
          ...dupNames.map((index) =>
            this.createError({
              path: `${this.path}.${index}.name`,
              message: 'Provider name must be unique across providers',
            }),
          ),
          ...dupAliases.map((index) =>
            this.createError({
              path: `${this.path}.${index}.alias`,
              message: 'Alias must be unique across providers',
            }),
          ),
        ];

        return errors.length === 0 ? true : new yup.ValidationError(errors);
      },
    ),
});
