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
    throw new Error(`Send API failed: ${err}`);
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
export async function sendHandoffNotification({ psid, lastMessage, reason, context }, setLastPendingClient) {
  const text =
    `🔔 SOP Writers Nepal — A client needs attention.\n` +
    `Last message: ${lastMessage}\n` +
    `Reason: ${reason}\n` +
    (context ? `Context: ${context}\n` : '') +
    `Reply /resume to re-enable bot (or /resume ${psid} for a specific conversation).`;

  const recipients = [
    process.env.SANDESH_PSID,
    process.env.SWIKAR_PSID,
  ].filter(Boolean);

  await Promise.all(
    recipients.map(async (operatorId) => {
      await sendText(operatorId, text);
      // Save which client this operator needs to resume — enables /resume with no args
      if (setLastPendingClient) {
        await setLastPendingClient(operatorId, psid);
      }
    })
  );
}
