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

// Track last message timestamps for follow-up nudge logic
export async function setLastBotMessage(psid) {
  await redis.set(`last_bot:${psid}`, Date.now(), { ex: HISTORY_TTL });
}

export async function setLastClientMessage(psid) {
  await redis.set(`last_client:${psid}`, Date.now(), { ex: HISTORY_TTL });
  // Clear nudge sent flag so next silence triggers a fresh nudge
  await redis.del(`nudged:${psid}`);
}

export async function getNudgeState(psid) {
  const lastBot = await redis.get(`last_bot:${psid}`);
  const lastClient = await redis.get(`last_client:${psid}`);
  const nudged = await redis.get(`nudged:${psid}`);
  return { lastBot: Number(lastBot), lastClient: Number(lastClient), nudged: !!nudged };
}

export async function markNudged(psid) {
  await redis.set(`nudged:${psid}`, '1', { ex: 60 * 30 }); // 30 min cooldown
}

// Track all active PSIDs so cron knows who to check
export async function registerActivePsid(psid) {
  await redis.sadd('active_psids', psid);
}

export async function getActivePsids() {
  return await redis.smembers('active_psids');
}
