import { z } from "zod";

const providerSchema = z.enum(["openrouter", "anthropic", "openai", "google"]);

export type AiProvider = z.infer<typeof providerSchema>;

type FetchFn = typeof fetch;
type JsonObject = Record<string, unknown>;

type GenerateAiTextInput = {
  apiKey: string;
  fetchFn?: FetchFn;
  jsonSchema?: JsonObject;
  maxTokens?: number;
  model?: string;
  origin?: string;
  prompt: string;
  provider?: string | null;
  schemaName?: string;
  system?: string;
};

type GenerateAiResult = {
  model: string;
  provider: AiProvider;
  text: string;
};

type GenerateAiJsonResult<T> = GenerateAiResult & {
  json: T;
};

const defaultModels: Record<AiProvider, string> = {
  anthropic: "claude-opus-4-8",
  google: "gemini-3.5-flash",
  openai: "gpt-5.5",
  openrouter: "~openai/gpt-latest",
};

const providerLabels: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

function resolveProvider(provider: string | null | undefined): AiProvider {
  return providerSchema.catch("openrouter").parse(provider ?? "openrouter");
}

function requireApiKey(apiKey: string) {
  const normalized = apiKey.trim();

  if (!normalized) {
    throw new Error("AI API key is required.");
  }

  return normalized;
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "TutorLoft/0.1",
    ...extra,
  };
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

function getErrorMessage(payload: unknown, fallback: string, apiKey: string) {
  const body = asObject(payload);
  const error = asObject(body.error);
  const message = typeof error.message === "string" ? error.message : fallback;
  return message.replaceAll(apiKey, "[redacted]");
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function postJson(
  fetchFn: FetchFn,
  input: {
    apiKey: string;
    body: JsonObject;
    headers: Record<string, string>;
    label: string;
    url: string;
  },
) {
  const response = await fetchFn(input.url, {
    body: JSON.stringify(input.body),
    headers: input.headers,
    method: "POST",
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      `${input.label} request failed: ${response.status} ${getErrorMessage(
        payload,
        response.statusText,
        input.apiKey,
      )}`,
    );
  }

  return payload;
}

function messages(prompt: string, system?: string) {
  return [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
}

function responseFormat(input: GenerateAiTextInput) {
  if (!input.jsonSchema) {
    return undefined;
  }

  return {
    type: "json_schema",
    json_schema: {
      name: input.schemaName ?? "tutorloft_json",
      schema: input.jsonSchema,
      strict: true,
    },
  };
}

function openAiTextFormat(input: GenerateAiTextInput) {
  if (!input.jsonSchema) {
    return undefined;
  }

  return {
    format: {
      name: input.schemaName ?? "tutorloft_json",
      schema: input.jsonSchema,
      strict: true,
      type: "json_schema",
    },
  };
}

function googleGenerationConfig(input: GenerateAiTextInput) {
  const config: JsonObject = {};

  if (input.maxTokens) {
    config.maxOutputTokens = input.maxTokens;
  }

  if (input.jsonSchema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = input.jsonSchema;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const partObject = asObject(part);
        return typeof partObject.text === "string" ? partObject.text : "";
      })
      .join("");
  }

  return "";
}

function textFromOpenAi(payload: unknown) {
  const body = asObject(payload);

  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  const output = Array.isArray(body.output) ? body.output : [];
  return output
    .map((item) => {
      const content = asObject(item).content;
      return textFromContent(content);
    })
    .join("");
}

function textFromOpenAiCompatible(payload: unknown) {
  const body = asObject(payload);
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = asObject(choices[0]);
  const message = asObject(firstChoice.message);
  return textFromContent(message.content);
}

function textFromAnthropic(payload: unknown) {
  const body = asObject(payload);
  return textFromContent(body.content);
}

function textFromGoogle(payload: unknown) {
  const body = asObject(payload);
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const content = asObject(asObject(candidates[0]).content);
  return textFromContent(content.parts);
}

function requireText(text: string, provider: AiProvider) {
  if (!text.trim()) {
    throw new Error(`${providerLabels[provider]} response did not include text.`);
  }

  return text;
}

async function generateOpenRouter(input: GenerateAiTextInput, model: string, apiKey: string) {
  const format = responseFormat(input);
  const body: JsonObject = {
    messages: messages(input.prompt, input.system),
    model,
  };

  if (input.maxTokens) {
    body.max_tokens = input.maxTokens;
  }

  if (format) {
    body.response_format = format;
  }

  const payload = await postJson(input.fetchFn ?? fetch, {
    apiKey,
    body,
    headers: jsonHeaders({
      Authorization: `Bearer ${apiKey}`,
      ...(input.origin ? { "HTTP-Referer": input.origin } : {}),
      "X-OpenRouter-Title": "TutorLoft",
    }),
    label: providerLabels.openrouter,
    url: "https://openrouter.ai/api/v1/chat/completions",
  });

  return requireText(textFromOpenAiCompatible(payload), "openrouter");
}

async function generateOpenAi(input: GenerateAiTextInput, model: string, apiKey: string) {
  const text = openAiTextFormat(input);
  const body: JsonObject = {
    input: input.prompt,
    model,
  };

  if (input.system) {
    body.instructions = input.system;
  }

  if (input.maxTokens) {
    body.max_output_tokens = input.maxTokens;
  }

  if (text) {
    body.text = text;
  }

  const payload = await postJson(input.fetchFn ?? fetch, {
    apiKey,
    body,
    headers: jsonHeaders({ Authorization: `Bearer ${apiKey}` }),
    label: providerLabels.openai,
    url: "https://api.openai.com/v1/responses",
  });

  return requireText(textFromOpenAi(payload), "openai");
}

async function generateAnthropic(input: GenerateAiTextInput, model: string, apiKey: string) {
  const prompt = input.jsonSchema
    ? `${input.prompt}\n\nReturn only valid JSON matching the requested schema.`
    : input.prompt;
  const body: JsonObject = {
    max_tokens: input.maxTokens ?? 2048,
    messages: [{ role: "user", content: prompt }],
    model,
  };

  if (input.system) {
    body.system = input.system;
  }

  const payload = await postJson(input.fetchFn ?? fetch, {
    apiKey,
    body,
    headers: jsonHeaders({
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    }),
    label: providerLabels.anthropic,
    url: "https://api.anthropic.com/v1/messages",
  });

  return requireText(textFromAnthropic(payload), "anthropic");
}

async function generateGoogle(input: GenerateAiTextInput, model: string, apiKey: string) {
  const generationConfig = googleGenerationConfig(input);
  const body: JsonObject = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  };

  if (input.system) {
    body.systemInstruction = { parts: [{ text: input.system }] };
  }

  if (generationConfig) {
    body.generationConfig = generationConfig;
  }

  const payload = await postJson(input.fetchFn ?? fetch, {
    apiKey,
    body,
    headers: jsonHeaders(),
    label: providerLabels.google,
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
  });

  return requireText(textFromGoogle(payload), "google");
}

export async function generateAiText(input: GenerateAiTextInput): Promise<GenerateAiResult> {
  const provider = resolveProvider(input.provider);
  const apiKey = requireApiKey(input.apiKey);
  const model = input.model?.trim() || defaultModels[provider];
  const text =
    provider === "openai"
      ? await generateOpenAi(input, model, apiKey)
      : provider === "anthropic"
        ? await generateAnthropic(input, model, apiKey)
        : provider === "google"
          ? await generateGoogle(input, model, apiKey)
          : await generateOpenRouter(input, model, apiKey);

  return { model, provider, text };
}

function stripFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function firstJsonSlice(text: string) {
  const start = text.search(/[\[{]/);

  if (start < 0) {
    return text;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        break;
      }

      if (stack.length === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
}

function repairJson(text: string) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

export function extractJsonFromText(text: string) {
  const stripped = stripFence(text);
  const sliced = firstJsonSlice(stripped);
  const candidates = [text.trim(), stripped, sliced, repairJson(sliced)];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next increasingly repaired candidate.
    }
  }

  throw new Error("AI response did not contain valid JSON.");
}

export async function generateAiJson<T = unknown>(
  input: GenerateAiTextInput & { jsonSchema: JsonObject },
): Promise<GenerateAiJsonResult<T>> {
  const result = await generateAiText(input);
  return {
    ...result,
    json: extractJsonFromText(result.text) as T,
  };
}
