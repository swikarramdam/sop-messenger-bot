import { after } from 'next/server';
import { Client as QStashClient } from '@upstash/qstash';
import { getHistory, saveHistory, getBotStatus, setBotStatus, setLastPendingClient, getLastPendingClient, setLastBotMessage, setLastClientMessage, registerActivePsid } from '@/lib/redis';

const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
import { getGeminiResponse } from '@/lib/gemini';
import {
  sendText,
  sendImage,
  sendTypingOn,
  sendHandoffNotification,
} from '@/lib/messenger';

function sanitizeResponse(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold**
    .replace(/\*(.+?)\*/g, '$1')            // *italic*
    .replace(/__(.+?)__/g, '$1')            // __bold__
    .replace(/_(.+?)_/g, '$1')              // _italic_
    .replace(/#{1,6}\s+/g, '')              // ## headings
    .replace(/^\s*[-*•]\s+/gm, '')          // - bullet points
    .replace(/^\s*\d+\.\s+/gm, '')          // 1. numbered lists
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')    // [links](url)
    .replace(/\n{3,}/g, '\n\n')            // collapse excess newlines
    .trim();
}

// GET — Meta webhook verification handshake
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

// POST — Handle all incoming Messenger events
export async function POST(request) {
  const body = await request.json();

  if (body.object !== 'page') {
    return new Response('Not Found', { status: 404 });
  }

  // after() runs after response is sent — keeps function alive on Vercel serverless
  after(async () => {
    for (const entry of body.entry) {
      const events = entry.messaging || [];
      for (const event of events) {
        await handleEvent(event).catch((err) =>
          console.error('Event handler error:', err)
        );
      }
    }
  });

  return new Response('EVENT_RECEIVED', { status: 200 });
}

async function handleEvent(event) {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;

  // Log all sender IDs during setup — needed to find Sandesh/Swikar PSIDs
  console.log('Event sender PSID:', senderId, '| type:', getEventType(event));

  // Ignore all echoes — bot is disabled only via explicit /pause command from operator
  if (event.message?.is_echo) return;

  // Skip delivery/read receipts
  if (event.delivery || event.read) return;

  // Regular incoming message from a user
  if (event.message?.text) {
    const text = event.message.text.trim();

    // Operator commands — only Sandesh or Swikar
    const isAuthorized =
      senderId === process.env.SANDESH_PSID ||
      senderId === process.env.SWIKAR_PSID;

    if (text.startsWith('/resume') && isAuthorized) {
      const parts = text.trim().split(' ');
      const targetPsid = parts[1] || await getLastPendingClient(senderId);
      if (targetPsid) {
        await setBotStatus(targetPsid, true);
        await sendText(senderId, `Bot re-enabled for client.`);
      } else {
        await sendText(senderId, 'No pending client found. Use /resume {psid}.');
      }
      return;
    }

    if (text.startsWith('/pause') && isAuthorized) {
      const parts = text.trim().split(' ');
      const targetPsid = parts[1] || await getLastPendingClient(senderId);
      if (targetPsid) {
        await setBotStatus(targetPsid, false);
        await sendText(senderId, `Bot paused for client.`);
      } else {
        await sendText(senderId, 'Usage: /pause {psid}');
      }
      return;
    }

    // Record client message timestamp for nudge tracking
    await setLastClientMessage(senderId);
    await registerActivePsid(senderId);

    // Normal client message — run AI pipeline
    await runAIPipeline(senderId, text);
  }
}

async function runAIPipeline(psid, userMessage) {
  // Gate: skip if human has taken over
  const botActive = await getBotStatus(psid);
  if (!botActive) return;

  // Show typing indicator before calling Gemini (handles 20s timeout perception)
  await sendTypingOn(psid);

  const history = await getHistory(psid);

  let responseText;
  try {
    responseText = await getGeminiResponse(history, userMessage);
  } catch (err) {
    console.error('Gemini error:', err);
    await sendText(
      psid,
      "Sorry, I'm having trouble right now. Please try again in a moment or contact us directly."
    );
    return;
  }

  // Extract control markers before sending to client
  const needsHandoff = responseText.includes('[HANDOFF_NEEDED]');
  const sendQR = responseText.includes('[SEND_QR]');
  const contextMatch = responseText.match(/\[CONTEXT:\s*([^\]]+)\]/);
  const handoffContext = contextMatch ? contextMatch[1].trim() : null;

  console.log(`Markers — SEND_QR: ${sendQR}, HANDOFF: ${needsHandoff}, CONTEXT: ${handoffContext}`);

  // Strip all markers then sanitize markdown before sending to client
  const cleanResponse = sanitizeResponse(
    responseText
      .replace('[HANDOFF_NEEDED]', '')
      .replace('[SEND_QR]', '')
      .replace(/\[CONTEXT:[^\]]*\]/g, '')
  );

  // Send clean response to client
  await sendText(psid, cleanResponse);
  await setLastBotMessage(psid);

  // Schedule nudge via QStash — fires after 2 mins if client goes silent
  if (!sendQR && !needsHandoff) {
    qstash.publishJSON({
      url: `https://sop-messenger-bot.vercel.app/api/nudge`,
      delay: 120,
      body: { psid, scheduledAt: Date.now() },
    }).catch((err) => console.error('QStash schedule error:', err));
  }

  // QR payment flow — send image, fallback notifies operator to send manually
  if (sendQR) {
    let qrDelivered = false;
    try {
      await sendImage(psid, process.env.QR_IMAGE_URL);
      console.log(`QR image sent to ${psid}`);
      qrDelivered = true;
    } catch (err) {
      console.error('QR image send failed:', err);
      // Don't send URL — notify operator to send QR manually instead
    }

    await sendHandoffNotification({
      psid,
      lastMessage: userMessage,
      reason: qrDelivered
        ? 'QR sent, awaiting payment screenshot verification'
        : 'QR image failed to send — please send QR to client manually',
      context: handoffContext,
    }, setLastPendingClient);

    // Disable bot — writer takes over from here
    await setBotStatus(psid, false);
  }

  // Handoff notification (frustration / complex query) — disable bot, writer takes over
  if (needsHandoff && !sendQR) {
    await sendHandoffNotification({
      psid,
      lastMessage: userMessage,
      reason: 'Complex query or client needs human assistance',
      context: handoffContext,
    }, setLastPendingClient);
    await setBotStatus(psid, false);
  }

  // Save updated history
  const updatedHistory = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'model', content: cleanResponse },
  ];
  await saveHistory(psid, updatedHistory);
}

function getEventType(event) {
  if (event.message?.is_echo) return 'echo';
  if (event.message) return 'message';
  if (event.delivery) return 'delivery';
  if (event.read) return 'read';
  return 'unknown';
}
