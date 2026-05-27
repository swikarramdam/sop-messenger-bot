import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const HISTORY_TTL = 60 * 60 * 24; // 24 hours
const MAX_HISTORY = 8;

export async function getHistory(psid) {
  const raw = await redis.get(`history:${psid}`);
  return raw || [];
}

export async function saveHistory(psid, history) {
  const trimmed = history.slice(-MAX_HISTORY);
  await redis.set(`history:${psid}`, trimmed, { ex: HISTORY_TTL });
}

export async function getBotStatus(psid) {
  const val = await redis.get(`bot:active:${psid}`);
  // Default true if key doesn't exist yet
  return val === null ? true : val === 'true' || val === true;
}

export async function setBotStatus(psid, active) {
  await redis.set(`bot:active:${psid}`, String(active), { ex: HISTORY_TTL });
}

// Track last pending handoff per operator so /resume works without PSID
export async function setLastPendingClient(operatorPsid, clientPsid) {
  await redis.set(`pending:${operatorPsid}`, clientPsid, { ex: HISTORY_TTL });
}

export async function getLastPendingClient(operatorPsid) {
  return await redis.get(`pending:${operatorPsid}`);
}
