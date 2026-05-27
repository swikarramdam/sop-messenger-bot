# SOP Writers Nepal — Messenger Bot

Facebook Messenger chatbot for SOP Writers Nepal. Handles client queries via AI, quotes prices, collects requirements, sends payment QR, and notifies human operators when needed.

## Stack

- Next.js 16 (App Router) on Vercel
- Google Gemini API (gemini-2.0-flash)
- Upstash Redis (conversation history + bot toggle)
- Facebook Messenger Platform (Webhooks + Send API)

## Setup

### 1. Environment Variables

Fill in `.env.local` (for local dev) and add all vars to Vercel project settings:

```
PAGE_ACCESS_TOKEN=       # Facebook Page Access Token
VERIFY_TOKEN=            # Any string — must match what you enter in Meta dashboard
GEMINI_API_KEY=          # From Google AI Studio (aistudio.google.com)
UPSTASH_REDIS_REST_URL=  # From Upstash dashboard
UPSTASH_REDIS_REST_TOKEN=
SANDESH_PSID=            # Sandesh's Messenger Page-Scoped ID (see below)
SWIKAR_PSID=             # Swikar's Messenger Page-Scoped ID (see below)
QR_IMAGE_URL=            # Public URL of payment QR image
```

### 2. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Webhook URL will be: `https://your-app.vercel.app/api/webhook`

### 3. Meta App Setup

1. Go to developers.facebook.com, create an app, add Messenger product
2. Generate a Page Access Token for the SOP Writers Nepal page
3. Add webhook URL, set verify token to match VERIFY_TOKEN
4. Subscribe to: `messages`, `message_echoes`

### 4. Get Sandesh + Swikar PSIDs

Both should message the SOP Writers Nepal page from their personal Facebook accounts. Check Vercel function logs — every incoming message logs `Event sender PSID: <id>`. Copy those IDs into env vars.

### 5. Vercel Plan Note

`vercel.json` sets `maxDuration: 30s` for the webhook function. Hobby plan caps at 10s — upgrade to Pro if Gemini responses are timing out.

## Bot Commands (for operators)

Send these to the SOP Writers Nepal page from your personal account:

- `/resume {client_psid}` — re-enables bot for a conversation after human takeover

## How it works

1. Client messages page → webhook fires
2. Bot checks if it's active for that conversation (Redis key `bot:active:{psid}`)
3. If active: sends typing indicator, calls Gemini with full conversation history
4. Gemini response may contain hidden markers:
   - `[SEND_QR]` — triggers QR payment image + handoff notification to Sandesh + Swikar
   - `[HANDOFF_NEEDED]` — triggers handoff notification without disabling bot
5. When Sandesh/Swikar manually reply from the page, `message_echo` fires → bot auto-disables for that conversation
6. Operator sends `/resume {psid}` to re-enable bot
