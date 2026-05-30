import { getActivePsids, getNudgeState, getBotStatus, markNudged } from '@/lib/redis';
import { sendText } from '@/lib/messenger';

const NUDGE_AFTER_MS = 2 * 60 * 1000; // 2 minutes

const NUDGE_MESSAGES = [
  'Hi, any confusion?',
  'Hello! Let us know if you have any questions.',
  'Still there? Happy to help if you need anything.',
];

// Vercel cron calls this every 2 minutes
export async function GET(request) {
  // Protect endpoint — only Vercel cron can call this
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const psids = await getActivePsids();
  const now = Date.now();

  for (const psid of psids) {
    try {
      const botActive = await getBotStatus(psid);
      if (!botActive) continue;

      const { lastBot, lastClient, nudged } = await getNudgeState(psid);
      if (!lastBot) continue;
      if (nudged) continue;

      // Bot sent last, client hasn't replied, and 2+ minutes passed
      const botSentLast = lastBot > lastClient;
      const silentLongEnough = now - lastBot >= NUDGE_AFTER_MS;

      if (botSentLast && silentLongEnough) {
        const msg = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
        await sendText(psid, msg);
        await markNudged(psid);
      }
    } catch (err) {
      console.error(`Nudge error for ${psid}:`, err);
    }
  }

  return new Response('OK', { status: 200 });
}
