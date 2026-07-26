# ChaTin AI Chat

A PC web client for the sboomtools AI chat API, featuring a ChaTin-inspired design with neo-brutalist doodle aesthetic, notebook-grid background, and dual-tone chat interface.

## Features

- **3-screen flow:** Welcome landing → Explore hub → Active chat
- **ChaTin design:** Cream/grid background, stamp-style doodles, pink/green prompt cards, dark chat area
- **Streaming responses** via Server-Sent Events
- **Conversation history** with persistent chat context
- **Image support** (paste, drag-drop, or file pick)
- **English auto-titles** — conversation titles set from your first message
- **Bot model selector** with search and filters
- **Ollama integration** for local LLMs
- **Dark mode**

## Setup

```bash
pip install -r requirements.txt
python3 server.py
```

Open http://localhost:8000 in your browser.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `8000` | Server port |
| `API_BASE_URL` | `https://chatopenai.sboomtools.net` | Upstream API |
| `API_VERSION` | `v6.2` | API version |
| `OLLAMA_HOST` | `192.168.100.125` | Ollama server host |

## Tech

- **Backend:** FastAPI + httpx
- **Frontend:** Vanilla JS SPA + marked.js
- **Design:** ChaTin concept (cream #F8F5EC, yellow #FFD93D, dark #1A1A1A)
