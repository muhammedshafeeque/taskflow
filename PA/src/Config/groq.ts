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

  client = new Groq({ apiKey });
  return client;
}
