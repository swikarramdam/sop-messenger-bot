import { after } from 'next/server';
import { getHistory, saveHistory, getBotStatus, setBotStatus, setLastPendingClient, getLastPendingClient } from '@/lib/redis';
import { getGeminiResponse } from '@/lib/gemini';
import {
  sendText,
  sendImage,
  sendTypingOn,
  sendHandoffNotification,
} from '@/lib/messenger';

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

  // message_echo = page sent a message
  // Only disable bot if the message was sent by a human operator (app not set as sender)
  // Automated page replies have app_id set — ignore those, only act on manual replies
  if (event.message?.is_echo) {
    const isAutomated = event.message?.app_id != null;
    if (!isAutomated && recipientId) {
      await setBotStatus(recipientId, false);
      console.log(`Bot disabled for client ${recipientId} (human took over)`);
    }
    return;
  }

  // Skip delivery/read receipts
  if (event.delivery || event.read) return;

  // Regular incoming message from a user
  if (event.message?.text) {
    const text = event.message.text.trim();

    // /resume command — only Sandesh or Swikar can use this
    if (text.startsWith('/resume')) {
      const isAuthorized =
        senderId === process.env.SANDESH_PSID ||
        senderId === process.env.SWIKAR_PSID;

      if (isAuthorized) {
        const parts = text.trim().split(' ');
        // /resume with no args → use last pending client for this operator
        const targetPsid = parts[1] || await getLastPendingClient(senderId);
        if (targetPsid) {
          await setBotStatus(targetPsid, true);
          await sendText(senderId, `Bot re-enabled for client.`);
        } else {
          await sendText(senderId, 'No pending client found. Use /resume {psid}.');
        }
      }
      return;
    }

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

  // Strip all markers from the text client will see
  const cleanResponse = responseText
    .replace('[HANDOFF_NEEDED]', '')
    .replace('[SEND_QR]', '')
    .trim();

  // Send clean response to client
  await sendText(psid, cleanResponse);

  // QR payment flow
  if (sendQR) {
    await sendText(
      psid,
      'Great! Please make half payment to proceed. Scan the QR below and send us a screenshot once done. Our team will verify and begin working on your SOP.'
    );
    await sendImage(psid, process.env.QR_IMAGE_URL);

    await sendHandoffNotification({
      psid,
      lastMessage: userMessage,
      reason: 'QR sent, awaiting payment screenshot verification',
    }, setLastPendingClient);
  }

  // Handoff notification (frustration / complex query)
  if (needsHandoff && !sendQR) {
    await sendHandoffNotification({
      psid,
      lastMessage: userMessage,
      reason: 'Complex query or client needs human assistance',
    }, setLastPendingClient);
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
