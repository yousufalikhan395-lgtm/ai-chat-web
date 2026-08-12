import os, json, uuid, hmac, hashlib, tempfile, re, base64, time, asyncio, logging
from pathlib import Path
from contextlib import asynccontextmanager

logger = logging.getLogger("server")

import httpx
from fastapi import FastAPI, HTTPException, Header, Query, Body
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

STATIC_DIR = Path(__file__).parent / "static"
CHAT_DB_PATH = Path(__file__).parent / "chat_ids.json"
AUTH_DB_PATH = Path(__file__).parent / "auth_tokens.json"

BASE_URL = os.environ.get("API_BASE_URL", "https://chatopenai.sboomtools.net")
VER_API = os.environ.get("API_VERSION", "v6.2")
PLATFORM = os.environ.get("API_PLATFORM", "android")
VERSION_APP = os.environ.get("API_VERSION_APP", "10.5.3")
IS_VIP = os.environ.get("IS_VIP", "1")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "192.168.100.125")
OLLAMA_PORT = int(os.environ.get("OLLAMA_PORT", "11434"))

SIGN_KEY = "NEWWAY-SM-HUNGMANH-CHATAI"
PACKAGE = "newway.open.chatgpt.ai.chat.bot.free"
SALT = "AA:41:A5:CB:23:F5:F8:24:32:09:36:41:NW:13:69:69:32:5D:C8:B6:32:CC:47:90:SM:28:0F:3F:40:32:02:FF"

bot_cache = {}
chat_ids_store = {}
auth_tokens = {}


def _sign(msg):
    content = f"{SALT}&{msg}&{PACKAGE}"
    return hmac.new(SIGN_KEY.encode(), content.encode(), hashlib.sha256).hexdigest()


def _load_chat_ids():
    global chat_ids_store
    try:
        if CHAT_DB_PATH.exists():
            chat_ids_store = json.loads(CHAT_DB_PATH.read_text())
    except:
        pass


def _save_chat_ids():
    try:
        CHAT_DB_PATH.write_text(json.dumps(chat_ids_store, indent=2))
    except:
        pass


def _load_auth_tokens():
    global auth_tokens
    try:
        if AUTH_DB_PATH.exists():
            auth_tokens = json.loads(AUTH_DB_PATH.read_text())
    except:
        pass


def _save_auth_tokens():
    try:
        AUTH_DB_PATH.write_text(json.dumps(auth_tokens, indent=2))
    except:
        pass


class AuthRequest(BaseModel):
    uuid: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class VerifyRequest(BaseModel):
    email: str
    code: str


class ChatRequest(BaseModel):
    message: str
    model: str = "smagent-1.0"
    service: str = "sm-agent"
    bot_id: str = "66446f6414e2f2ecdc0b1474"
    chat_id: str | None = None
    image: str | None = None


class TitleRequest(BaseModel):
    title: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_chat_ids()
    _load_auth_tokens()
    yield
    _save_chat_ids()
    _save_auth_tokens()


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
app = FastAPI(title="AI Chat Web", lifespan=lifespan)


async def sboom_request(method: str, path: str, token: str | None = None,
                        data: dict | None = None, json_data: dict | None = None,
                        files: dict | None = None, stream: bool = False,
                        timeout: int = 120):
    url = f"{BASE_URL}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        if files:
            resp = await client.post(url, headers=headers, files=files, data=data)
        elif json_data:
            resp = await client.post(url, headers=headers, json=json_data)
        elif data:
            resp = await client.post(url, headers=headers, data=data)
        else:
            resp = await client.get(url, headers=headers)
        return resp


def _check_response(resp):
    try:
        result = resp.json()
    except:
        raise HTTPException(502, f"Bad upstream response: {resp.text[:200]}")
    if result.get("code") != 200:
        msg = result.get("message") or result.get("error", {}).get("message", str(result))
        raise HTTPException(502, msg)
    return result


@app.post("/api/auth")
async def auth_device(req: AuthRequest):
    uid = req.uuid or str(uuid.uuid4())
    resp = await sboom_request("POST", "/api/user/identifier",
                                data={"uuid": uid, "platform": PLATFORM})
    result = _check_response(resp)
    token = result["data"]["token"]
    session_id = str(uuid.uuid4())
    auth_tokens[session_id] = {"token": token, "uuid": uid}
    _save_auth_tokens()
    return {"session_id": session_id, "token": token[:20] + "..."}


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest):
    uid = str(uuid.uuid4())
    resp = await sboom_request("POST", "/api/user/login_email_v2",
                                data={"email": req.email, "password": req.password,
                                      "guest_id": "0", "platform": PLATFORM, "uuid": uid})
    result = _check_response(resp)
    token = result["data"]["token"]
    session_id = str(uuid.uuid4())
    auth_tokens[session_id] = {"token": token, "uuid": uid}
    _save_auth_tokens()
    return {"session_id": session_id, "token": token[:20] + "..."}


@app.post("/api/auth/register")
async def auth_register(req: RegisterRequest):
    resp = await sboom_request("POST", "/api/user/register",
                                data={"email": req.email, "password": req.password,
                                      "password_confirmation": req.password,
                                      "name": req.name, "platform": PLATFORM})
    return _check_response(resp)


@app.post("/api/auth/verify")
async def auth_verify(req: VerifyRequest):
    uid = str(uuid.uuid4())
    resp = await sboom_request("POST", "/api/user/register/verify_v2",
                                data={"email": req.email, "verification_code": req.code,
                                      "platform": PLATFORM, "uuid": uid})
    result = _check_response(resp)
    token = result["data"]["token"]
    session_id = str(uuid.uuid4())
    auth_tokens[session_id] = {"token": token, "uuid": uid}
    _save_auth_tokens()
    return {"session_id": session_id, "token": token[:20] + "..."}


@app.post("/api/auth/refresh")
async def auth_refresh(session_id: str = Header(None, alias="X-Session-Id")):
    token_data = auth_tokens.get(session_id)
    if not token_data:
        raise HTTPException(401, "Invalid session")
    resp = await sboom_request("POST", "/api/user/refresh_token",
                                token=token_data["token"])
    result = _check_response(resp)
    if result.get("code") == 200:
        token_data["token"] = result["data"]["token"]
        _save_auth_tokens()
    return {"token": token_data["token"][:20] + "..."}


async def _auto_title(token: str, chat_id: str, title: str):
    if not title or not chat_id:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BASE_URL}/api/update-conversation",
                headers={"Authorization": f"Bearer {token}"},
                data={"chat_id": chat_id, "title": title}
            )
            body = await resp.aread()
            return resp.status_code, body
    except Exception as e:
        return 0, str(e)


def _get_token(session_id: str | None):
    if not session_id:
        raise HTTPException(401, "No session")
    token_data = auth_tokens.get(session_id)
    if not token_data:
        raise HTTPException(401, "Invalid session")
    return token_data["token"]


@app.get("/api/bots")
async def list_bots(session_id: str = Header(None, alias="X-Session-Id")):
    token = _get_token(session_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{BASE_URL}/api/{VER_API}/general/services_v2",
            headers={"Authorization": f"Bearer {token}"}
        )
    result = _check_response(resp)
    data = result.get("data", {})
    sections = ["featured_bots", "official_bots", "aistore_bots", "new_tools_bots"]
    all_bots = {}
    for section in sections:
        bots = data.get(section, [])
        for b in bots:
            bid = b.get("bot_id") or b.get("_id")
            if bid:
                b["_section"] = section
                all_bots[bid] = b
    bot_cache.clear()
    bot_cache.update(all_bots)
    return {"bots": list(all_bots.values()), "sections": sections}


IMAGE_BOT_TYPES = ("chat-image", "gen-image")


def _is_image_bot(bot: dict | None) -> bool:
    return bool(bot and (bot.get("type") in IMAGE_BOT_TYPES
                         or str(bot.get("stream")).lower() == "false"))


def _extract_images(data: dict | None) -> list:
    images = []
    mc = (data or {}).get("mixed_content")
    if isinstance(mc, list):
        for item in mc:
            if isinstance(item, dict) and item.get("url"):
                images.append(item["url"])
    if not images:
        extra = (data or {}).get("images")
        if isinstance(extra, list):
            images.extend(u for u in extra if isinstance(u, str) and u)
    return images


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest,
                      session_id: str = Header(None, alias="X-Session-Id")):
    token = _get_token(session_id)
    is_image_gen = req.message.strip() == "" and req.image is not None
    is_image_bot = _is_image_bot(bot_cache.get(req.bot_id))

    chat_key = f"{req.bot_id}:{req.chat_id or 'new'}"
    chat_id = req.chat_id

    parts = {
        "message": (None, req.message),
        "model": (None, req.model),
        "service": (None, req.service),
        "signature": (None, _sign(req.message)),
        "stream": (None, "false" if is_image_bot else "true"),
        "platform": (None, PLATFORM),
        "version_app": (None, VERSION_APP),
        "is_vip": (None, IS_VIP),
        "bot_id": (None, req.bot_id),
    }
    if chat_id:
        parts["chat_id"] = (None, chat_id)

    temp_files = []
    if req.image:
        match = re.match(r"data:image/(\w+);base64,(.+)", req.image)
        if match:
            ext = match.group(1)
            if ext == "jpeg":
                ext = "jpg"
            raw = base64.b64decode(match.group(2))
            f = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
            f.write(raw)
            f.close()
            temp_files.append(f.name)
            parts["file"] = (os.path.basename(f.name), open(f.name, "rb"), "multipart/form-data")

    timeout_val = 180 if (is_image_gen or is_image_bot) else 120

    is_new_chat = chat_id is None
    alt_text = (req.message or "").strip() or f"[image] {(req.image or '')[:40]}"
    title_to_set = alt_text[:50] if alt_text else None

    async def event_stream():
        nonlocal chat_key
        extracted_chat_id = None
        first = True
        full_text = ""

        async with httpx.AsyncClient(timeout=timeout_val, follow_redirects=True) as client:
            async with client.stream(
                "POST",
                f"{BASE_URL}/api/{VER_API}/general/completionFast",
                headers={"Authorization": f"Bearer {token}"},
                files=parts
            ) as upstream:
                ct = upstream.headers.get("content-type", "")

                if "application/json" in ct or "text/json" in ct:
                    body = await upstream.aread()
                    try:
                        root = json.loads(body)
                    except:
                        root = {}
                    data = root.get("data", {})
                    content = data.get("content", "")
                    cc = data.get("created_chat")
                    if cc and cc.get("_id"):
                        chat_ids_store[chat_key] = cc["_id"]
                        _save_chat_ids()
                    images = _extract_images(data)
                    payload = {"type": "json", "content": content or "",
                               "images": images,
                               "chat_id": (cc or {}).get("_id")}
                    yield f"data: {json.dumps(payload)}\n\n"
                    if cc and cc.get("_id") and is_new_chat and title_to_set:
                        result = await _auto_title(token, cc["_id"], title_to_set)
                        logger.info(f"auto_title (json): chat_id={cc['_id']} title={title_to_set} result={result}")
                    yield "data: [DONE]\n\n"
                    return

                async for line in upstream.aiter_lines():
                    if not line:
                        continue
                    raw = line
                    if raw.startswith("data: "):
                        raw = raw[6:]
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                        if first and "_id" in chunk and "text" not in chunk:
                            extracted_chat_id = chunk["_id"]
                            chat_ids_store[chat_key] = chunk["_id"]
                            _save_chat_ids()
                            first = False
                            yield f"data: {json.dumps({'chat_id': extracted_chat_id})}\n\n"
                            continue
                        first = False
                        if chunk.get("code") != 200:
                            if not full_text:
                                quota = chunk.get("quota", {})
                                if quota:
                                    reset = quota.get("reset_at", "later")
                                    msg = f"Daily limit reached. Resets at {reset}."
                                else:
                                    msg = chunk.get("message", "Service error. Try again.")
                                yield f"data: {json.dumps({'error': msg})}\n\n"
                            break
                        text = chunk.get("text", "")
                        if text:
                            full_text += text
                            yield f"data: {json.dumps({'text': text})}\n\n"
                    except json.JSONDecodeError:
                        pass

                if extracted_chat_id and is_new_chat and title_to_set:
                    result = await _auto_title(token, extracted_chat_id, title_to_set)
                    logger.info(f"auto_title done: {result}")

                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/conversations")
async def list_conversations(session_id: str = Header(None, alias="X-Session-Id"),
                              page: int = Query(1)):
    token = _get_token(session_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{BASE_URL}/api/conversations?page={page}",
            headers={"Authorization": f"Bearer {token}"}
        )
    result = _check_response(resp)
    return {"conversations": result.get("data", [])}


@app.delete("/api/conversations/{chat_id}")
async def delete_conversation(chat_id: str,
                               session_id: str = Header(None, alias="X-Session-Id")):
    token = _get_token(session_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(
            f"{BASE_URL}/api/conversation",
            headers={"Authorization": f"Bearer {token}"},
            data={"chat_id": chat_id}
        )
    return _check_response(resp)


@app.post("/api/conversations/{chat_id}/title")
async def update_conversation_title(chat_id: str, req: TitleRequest,
                                     session_id: str = Header(None, alias="X-Session-Id")):
    token = _get_token(session_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{BASE_URL}/api/update-conversation",
            headers={"Authorization": f"Bearer {token}"},
            data={"chat_id": chat_id, "title": req.title}
        )
    return _check_response(resp)


@app.get("/api/ollama/health")
async def ollama_health():
    ollama_url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}"
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.get(ollama_url)
            return {"status": "ok" if resp.status_code == 200 else "error"}
        except:
            return {"status": "unreachable"}


@app.get("/api/ollama/models")
async def ollama_models():
    ollama_url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(ollama_url)
            return resp.json()
        except Exception as e:
            raise HTTPException(502, f"Ollama unreachable: {e}")


@app.post("/api/ollama/chat")
async def ollama_chat(req: ChatRequest):
    ollama_url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/v1/chat/completions"
    model = req.model if req.model != "smagent-1.0" else "llama3"

    images = []
    if req.image:
        images.append(req.image)

    messages = [{"role": "user", "content": req.message}]
    if images:
        messages = [{"role": "user", "content": [
            {"type": "text", "text": req.message or "Analyze this image"},
            {"type": "image_url", "image_url": {"url": req.image}}
        ]}]

    async def event_stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", ollama_url,
                json={"model": model, "messages": messages, "stream": True},
                headers={"Content-Type": "application/json"}
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            data = json.loads(data_str)
                            choices = data.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield f"data: {json.dumps({'text': content})}\n\n"
                        except json.JSONDecodeError:
                            pass
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
