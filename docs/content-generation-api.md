# Content Generation API

## `POST /api/content/generate`

Generates platform-optimised social media content using GPT-4o or Claude Sonnet.

**Authentication:** Bearer JWT required.

---

### Request Headers

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

### Request Body

```json
{
  "idea": "We just launched Postly v2 — the AI-native multi-platform publishing engine for modern creators.",
  "post_type": "announcement",
  "platforms": ["twitter", "linkedin", "instagram", "threads"],
  "tone": "professional",
  "language": "en",
  "model": "openai"
}
```

| Field       | Type       | Required | Constraints                                                                                |
|-------------|------------|----------|--------------------------------------------------------------------------------------------|
| `idea`      | `string`   | ✅        | Max 500 chars                                                                              |
| `post_type` | `string`   | ✅        | `announcement` \| `thread` \| `story` \| `promotional` \| `educational` \| `opinion`      |
| `platforms` | `string[]` | ✅        | Non-empty; values: `twitter`, `linkedin`, `instagram`, `threads`                           |
| `tone`      | `string`   | ✅        | `professional` \| `casual` \| `witty` \| `authoritative` \| `friendly`                    |
| `language`  | `string`   | ❌        | ISO language code. Auto-detected via `franc` if omitted.                                   |
| `model`     | `string`   | ✅        | `openai` (GPT-4o) \| `anthropic` (Claude Sonnet 4.5)                                      |

---

### Response `200 OK`

```json
{
  "generated": {
    "twitter": {
      "content": "🚀 Postly v2 is live. Multi-platform publishing, powered by AI. Your content, everywhere — instantly. #Postly #AIContent #CreatorTools",
      "char_count": 138,
      "hashtags": ["#Postly", "#AIContent", "#CreatorTools"]
    },
    "linkedin": {
      "content": "We are thrilled to announce the launch of Postly v2 — the AI-native multi-platform publishing engine built for the modern creator economy.\n\nPostly v2 brings together intelligent content generation, cross-platform scheduling, and deep analytics into one seamless workflow. Whether you're a solo creator or an enterprise marketing team, Postly v2 adapts to your voice and amplifies your reach.\n\nKey highlights:\n→ GPT-4o & Claude Sonnet content generation\n→ Platform-aware prompt engineering\n→ One-click publish to Twitter, LinkedIn, Instagram & Threads\n\nWe built Postly v2 because great ideas deserve great distribution. The future of content is here.\n\n#Postly #ProductLaunch #AIMarketing #ContentStrategy #CreatorEconomy",
      "char_count": 892,
      "hashtags": ["#Postly", "#ProductLaunch", "#AIMarketing", "#ContentStrategy", "#CreatorEconomy"]
    },
    "instagram": {
      "content": "✨ Big news — Postly v2 is officially here! 🎉\n\nWe built the AI-native publishing engine that creators have been waiting for. Write once, publish everywhere — Twitter, LinkedIn, Instagram, Threads — all with content optimised for each platform. 🚀\n\nYour ideas deserve to be heard. Postly makes sure they are. 💡\n\n#Postly #PostlyV2 #AIContent #SocialMediaMarketing #ContentCreator #CreatorTools #AIMarketing #DigitalMarketing #ContentStrategy #MultiPlatform #CreatorEconomy #SocialMedia #MarketingTech #ContentMarketing #ProductLaunch",
      "hashtags": ["#Postly", "#PostlyV2", "#AIContent", "#SocialMediaMarketing", "#ContentCreator", "#CreatorTools", "#AIMarketing", "#DigitalMarketing", "#ContentStrategy", "#MultiPlatform", "#CreatorEconomy", "#SocialMedia", "#MarketingTech", "#ContentMarketing", "#ProductLaunch"]
    },
    "threads": {
      "content": "Postly v2 just dropped and honestly? It changes everything for creators. AI-generated content that actually sounds like you, published to every platform in seconds. Give it a try — link in bio."
    }
  },
  "model_used": "gpt-4o",
  "tokens_used": 843
}
```

---

### Error Responses

| Status | Scenario                                            |
|--------|-----------------------------------------------------|
| `400`  | Validation failure (missing field, bad enum, etc.)  |
| `401`  | Missing or invalid JWT                              |
| `422`  | No API key available (user + system both missing)   |
| `502`  | AI provider returned an error or malformed response |

**Example 400:**
```json
{ "error": "idea exceeds the maximum length of 500 characters" }
```

**Example 422:**
```json
{ "error": "No OpenAI API key available. Add your key under Settings → AI Keys." }
```

---

### Key Resolution Logic

```
User stored key (ai_keys table, AES-256-GCM encrypted)
  └─ Decrypted at runtime → passed to SDK
       └─ Falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY in .env
            └─ If neither exists → 422 error
```

---

### Platform Constraints Enforced

| Platform    | Char limit | Hashtags | Notes                        |
|-------------|------------|----------|------------------------------|
| `twitter`   | ≤ 280      | 2–3      | Strong hook required         |
| `linkedin`  | 800–1300   | 3–5      | Always professional tone     |
| `instagram` | —          | 10–15    | Emoji-friendly, caption style|
| `threads`   | ≤ 500      | 0–2      | Conversational tone          |
