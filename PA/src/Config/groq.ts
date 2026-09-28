import Groq from 'groq-sdk';

let client: Groq | null = null;

export function getGroq(): Groq {
  if (client) return client;

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not set. Add it to PA/.env (see .env.example).'
    );
  }

  const timeout = Number(process.env.GROQ_TIMEOUT_MS) || 30_000;
  // Fail fast instead of hanging a chat; SDK retries 429/5xx with backoff.
  client = new Groq({ apiKey, timeout, maxRetries: 2 });
  return client;
}
