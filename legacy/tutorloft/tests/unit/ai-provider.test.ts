import { describe, expect, it } from "vitest";

import { extractJsonFromText, generateAiJson, generateAiText } from "@/lib/ai/provider";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("AI provider adapters", () => {
  it("uses OpenRouter chat completions by default", async () => {
    const calls: { body: unknown; headers: Headers; url: string }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        url: String(url),
      });
      return jsonResponse({
        choices: [{ message: { content: "Hello from OpenRouter" } }],
      });
    }) as typeof fetch;

    const result = await generateAiText({
      apiKey: "openrouter-key",
      fetchFn,
      prompt: "Say hello.",
    });

    expect(result).toMatchObject({
      model: "~openai/gpt-latest",
      provider: "openrouter",
      text: "Hello from OpenRouter",
    });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].headers.get("authorization")).toBe("Bearer openrouter-key");
    expect(calls[0].body).toMatchObject({
      messages: [{ role: "user", content: "Say hello." }],
      model: "~openai/gpt-latest",
    });
  });

  it("maps OpenAI, Anthropic, and Google requests to their native endpoints", async () => {
    const calls: { body: unknown; headers: Headers; url: string }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        url: String(url),
      });

      if (String(url).includes("api.openai.com")) {
        return jsonResponse({ output_text: "OpenAI text" });
      }

      if (String(url).includes("api.anthropic.com")) {
        return jsonResponse({ content: [{ type: "text", text: "Anthropic text" }] });
      }

      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "Google text" }] } }],
      });
    }) as typeof fetch;

    await expect(
      generateAiText({
        apiKey: "openai-key",
        fetchFn,
        model: "gpt-5.5",
        prompt: "Draft.",
        provider: "openai",
        system: "You are concise.",
      }),
    ).resolves.toMatchObject({ text: "OpenAI text" });
    await expect(
      generateAiText({
        apiKey: "anthropic-key",
        fetchFn,
        model: "claude-opus-4-8",
        prompt: "Draft.",
        provider: "anthropic",
        system: "You are concise.",
      }),
    ).resolves.toMatchObject({ text: "Anthropic text" });
    await expect(
      generateAiText({
        apiKey: "google-key",
        fetchFn,
        model: "gemini-3.5-flash",
        prompt: "Draft.",
        provider: "google",
        system: "You are concise.",
      }),
    ).resolves.toMatchObject({ text: "Google text" });

    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/responses",
    });
    expect(calls[0].headers.get("authorization")).toBe("Bearer openai-key");
    expect(calls[0].body).toMatchObject({
      input: "Draft.",
      instructions: "You are concise.",
      model: "gpt-5.5",
    });
    expect(calls[1].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[1].headers.get("x-api-key")).toBe("anthropic-key");
    expect(calls[1].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[1].body).toMatchObject({
      max_tokens: 2048,
      messages: [{ role: "user", content: "Draft." }],
      model: "claude-opus-4-8",
      system: "You are concise.",
    });
    expect(calls[2].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=google-key",
    );
    expect(calls[2].body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Draft." }] }],
      systemInstruction: { parts: [{ text: "You are concise." }] },
    });
  });

  it("requests structured output and repairs fenced JSON responses", async () => {
    const calls: { body: unknown }[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return jsonResponse({
        choices: [{ message: { content: "```json\n{\"title\":\"Algebra\",}\n```" } }],
      });
    }) as typeof fetch;

    const result = await generateAiJson<{ title: string }>({
      apiKey: "openrouter-key",
      fetchFn,
      jsonSchema: {
        additionalProperties: false,
        properties: { title: { type: "string" } },
        required: ["title"],
        type: "object",
      },
      prompt: "Return JSON.",
      schemaName: "lesson_seed",
    });

    expect(result.json).toEqual({ title: "Algebra" });
    expect(calls[0].body).toMatchObject({
      response_format: {
        json_schema: {
          name: "lesson_seed",
          strict: true,
        },
        type: "json_schema",
      },
    });
    expect(extractJsonFromText("Before {\"ok\": true,} after")).toEqual({ ok: true });
  });

  it("surfaces provider HTTP errors without leaking API keys", async () => {
    const fetchFn = (async () =>
      jsonResponse({ error: { message: "No credits" } }, 402)) as typeof fetch;

    await expect(
      generateAiText({
        apiKey: "secret-key",
        fetchFn,
        prompt: "Draft.",
      }),
    ).rejects.toThrow("OpenRouter request failed: 402 No credits");
    await expect(
      generateAiText({
        apiKey: "secret-key",
        fetchFn,
        prompt: "Draft.",
      }),
    ).rejects.not.toThrow("secret-key");
  });
});
