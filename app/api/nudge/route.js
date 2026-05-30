import { Receiver } from '@upstash/qstash';
import { getNudgeState, getBotStatus, markNudged } from '@/lib/redis';
import { sendText } from '@/lib/messenger';

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const NUDGE_MESSAGES = [
  'Hi, any confusion?',
  'Hello! Let us know if you need anything.',
  'Still there? Happy to help.',
];

export async function POST(request) {
  // Verify request came from QStash
  const signature = request.headers.get('upstash-signature');
  const body = await request.text();

  try {
    await receiver.verify({ signature, body });
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { psid, scheduledAt } = JSON.parse(body);

  const botActive = await getBotStatus(psid);
  if (!botActive) return new Response('Bot inactive', { status: 200 });

  const { lastClient, nudged } = await getNudgeState(psid);
  if (nudged) return new Response('Already nudged', { status: 200 });

  // If client replied after we scheduled this nudge, skip
  if (lastClient && lastClient > scheduledAt) {
    return new Response('Client replied, no nudge needed', { status: 200 });
  }

  const msg = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
  await sendText(psid, msg);
  await markNudged(psid);

  return new Response('Nudge sent', { status: 200 });
}
