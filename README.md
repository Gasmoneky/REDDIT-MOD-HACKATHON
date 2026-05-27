# JijiGuard 🛡️

> An autonomous, LLM-powered moderation bouncer for Reddit.  
> Catch AI slop, spam, and low-effort posts the second they are submitted.

[![GitHub release](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/yourusername/JijiGuard)
[![Devvit](https://img.shields.io/badge/Devvit-App-orange)](https://developers.reddit.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

# 📖 Inspiration

Reddit communities are increasingly being flooded with AI-generated “slop,” repost spam, and low-effort automated content that weakens genuine human discussion.

Traditional Automod regex filters struggle to detect modern LLM-generated phrasing, while manual moderation becomes exhausting at scale.

**JijiGuard** acts as an autonomous moderation bouncer — leveraging lightweight modern LLMs to evaluate post intent in real time, instantly remove noise, and keep subreddit feeds clean.

---

# ⚡ Core Features

## 🧠 AI Slop Detection
Connects to **Grok-2** and **Gemini 2.5** (`temperature = 0.1`) to analyze post text and detect AI-generated phrasing patterns in real time.

## 💸 Pre-API Token Guard
Instantly blocks blank, spammy, or single-word posts before making expensive API requests, dramatically reducing token costs.

## 🛡️ Fault-Tolerant Parsing
Aggressive regex sanitization strips markdown wrappers such as:

```txt
```json
```

to guarantee clean payload execution and reliable parsing.

## 📱 Secure Mobile Configuration
Custom Devvit UI forms allow moderators to securely:

- Paste API keys
- Adjust sensitivity thresholds
- Configure settings directly from the official Reddit mobile app

No hardcoded secrets required.

---

# 🛠️ Tech Stack

| Area | Technologies |
|------|--------------|
| Language | TypeScript |
| Platform | Reddit Devvit SDK |
| Storage | Redis (built-in cache) |
| AI APIs | xAI API (Grok-2), Google AI Studio (Gemini 2.5) |
| Tooling | Cursor, npm, Devvit CLI |

---

# 🚀 Setup & Installation Guide

Follow these steps to configure, build, and deploy JijiGuard into your subreddit development environment.

---

## Step 1 — Clone & Configure Manifest

Ensure your Devvit permissions allow outbound API requests.

Add the following domains to your `devvit.json` allowlist:

```json
{
  "permissions": {
    "http": [
      "api.x.ai",
      "generativelanguage.googleapis.com"
    ]
  }
}
```

---

## Step 2 — (Optional) Clear Cache Bloat

If your environment feels stale or cached logic is interfering with deployment:

```bash
rm -rf ~/.cursor/ ~/.config/Cursor/ ~/.cache/Cursor/
```

---

## Step 3 — Authenticate & Deploy

Log into your Reddit developer account and upload the app container:

```bash
npx devvit login
npx devvit upload
```

---

## Step 4 — Activate via Reddit Mobile App

1. Open the official Reddit mobile app
2. Navigate to your moderator tools
3. Select:

```txt
Configure JijiGuard
```

4. Paste your:
   - Grok API key
   - Gemini API key

5. Configure:
   - Sensitivity threshold
   - Logging level
   - Pre-filter toggle

---

## Step 5 — Monitor Live Logs

Keep your development environment running to inspect real-time moderation events:

```bash
npx devvit logs
```

---

# 📁 Project Structure

```txt
JijiGuard/
├── src/
│   └── main.tsx          # Main trigger hooks, UI layers, and API logic
├── devvit.json           # Permissions and allowlists
└── README.md             # Project documentation
```

---

# ⚙️ Configuration

Moderators can customize behavior directly from the Devvit UI.

| Setting | Description |
|---------|-------------|
| API Key | Your Grok or Gemini API key (encrypted storage) |
| Sensitivity | Integer threshold (0–100) |
| Enable Pre-filter | Toggle blank/single-word guard |
| Log Level | Control verbosity of Devvit logs |

---

# 📝 Usage Notes

- The bot evaluates **new posts only** (not comments) to minimize latency.
- Detected AI slop is:
  - Automatically removed
  - Logged with a moderator note
- API requests are fully non-blocking.
- Most moderation decisions complete in under **2 seconds**.
- Redis caching prevents duplicate evaluation of identical content.
- Built-in rate limiting helps reduce API abuse and token waste.

---

# 🧪 Example Detection Results

| User Post | Verdict |
|-----------|----------|
| `"As an AI language model, I don't have personal opinions..."` | 🚫 AI Slop (99%) |
| `"I just baked my first sourdough bread!"` | ✅ Human (12%) |
| `"a"` | 🚫 Pre-filter |

---

# 🤝 Contributing

Contributions are welcome.

Feel free to:
- Open issues
- Submit pull requests
- Suggest improvements
- Report bugs

For major changes, please discuss them in the issue tracker first.

---

# 📄 License

MIT © Your Name

---

# 🙏 Acknowledgements

- **Reddit Devvit** — moderation framework
- **xAI** — Grok-2 API
- **Google AI Studio** — Gemini 2.5
- **Open-source moderation communities** — inspiration and testing feedback

---

# ⭐ Future Improvements

Planned features include:

- Comment moderation support
- Shadow-ban confidence scoring
- Multi-model consensus voting
- AI fingerprint memory cache
- Moderator analytics dashboard
- Automatic false-positive review queue
- Per-subreddit custom tuning profiles

---

# 🛡️ JijiGuard Philosophy

> “Real communities deserve real conversations.”

JijiGuard exists to reduce AI-generated clutter while preserving authentic discussion and minimizing moderator burnout.
