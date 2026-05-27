const GRAPH_API = 'https://graph.facebook.com/v19.0/me/messages';

async function callSendAPI(body) {
  const res = await fetch(`${GRAPH_API}?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Send API error:', err);
  }
}

export async function sendTypingOn(psid) {
  await callSendAPI({
    recipient: { id: psid },
    sender_action: 'typing_on',
  });
}

export async function sendText(psid, text) {
  await callSendAPI({
    recipient: { id: psid },
    message: { text },
  });
}

export async function sendImage(psid, imageUrl) {
  await callSendAPI({
    recipient: { id: psid },
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: imageUrl,
          is_reusable: true,
        },
      },
    },
  });
}

// Notify both Sandesh and Swikar when human attention needed
export async function sendHandoffNotification({ psid, lastMessage, reason }) {
  const text =
    `🔔 SOP Writers Nepal — A client needs attention.\n` +
    `Client PSID: ${psid}\n` +
    `Last message: ${lastMessage}\n` +
    `Reason: ${reason}\n` +
    `Reply /resume ${psid} to re-enable bot for this conversation.`;

  const recipients = [
    process.env.SANDESH_PSID,
    process.env.SWIKAR_PSID,
  ].filter(Boolean); // skip if env var not set yet

  await Promise.all(recipients.map((id) => sendText(id, text)));
}
