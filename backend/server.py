import sys
import asyncio
import os

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import socketio
import uvicorn
import pyaudio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assistant import AssistantLoop

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"])
app_socketio = socketio.ASGIApp(sio, app)

audio_loop = None
loop_task = None

pya = pyaudio.PyAudio()


@app.get("/status")
async def status():
    return {"status": "running", "service": "KANA Backend"}


def _fix_device_name(name):
    """Fix mojibake: UTF-8 bytes wrongly decoded as cp1251 (Russian Windows) or cp1252."""
    if not name or not isinstance(name, str):
        return name or ""
    for enc in ("cp1251", "cp1252", "cp866"):
        try:
            fixed = name.encode(enc).decode("utf-8")
            if fixed != name and any("\u0400" <= c <= "\u04FF" for c in fixed):
                return fixed
            if fixed != name:
                return fixed
        except (UnicodeDecodeError, UnicodeEncodeError):
            continue
    return name


def _deduplicate_devices(devices, default_idx):
    """Remove duplicates: merge devices where one name is prefix of another. Keep default or longest name."""
    if not devices:
        return []
    result = []
    for d in devices:
        name = d["name"]
        merged = False
        for i, existing in enumerate(result):
            ex_name = existing["name"]
            if name == ex_name:
                if d["index"] == default_idx:
                    result[i] = d
                merged = True
                break
            if name.startswith(ex_name) or ex_name.startswith(name):
                keep = d if (d["index"] == default_idx or (existing["index"] != default_idx and len(name) >= len(ex_name))) else existing
                result[i] = keep
                merged = True
                break
        if not merged:
            result.append(d)
    result.sort(key=lambda x: (not x.get("default", False), x["name"]))
    return result


@app.get("/api/devices")
async def get_devices():
    """Return PyAudio input and output devices for backend selection."""
    inputs = []
    outputs = []
    try:
        default_in = pya.get_default_input_device_info()
        default_out = pya.get_default_output_device_info()
        default_in_idx = default_in.get("index", -1)
        default_out_idx = default_out.get("index", -1)
        for i in range(pya.get_device_count()):
            try:
                info = pya.get_device_info_by_index(i)
                raw = info.get("name", f"Device {i}")
                name = _fix_device_name(raw) or str(raw)
                if info.get("maxInputChannels", 0) > 0:
                    inputs.append({"index": i, "name": name, "default": i == default_in_idx})
                if info.get("maxOutputChannels", 0) > 0:
                    outputs.append({"index": i, "name": name, "default": i == default_out_idx})
            except Exception:
                continue
        inputs = _deduplicate_devices(inputs, default_in_idx)
        outputs = _deduplicate_devices(outputs, default_out_idx)
    except Exception as e:
        return {"error": str(e), "inputs": [], "outputs": []}
    return {"inputs": inputs, "outputs": outputs}


@sio.event
async def connect(sid, environ):
    print(f"[KANA] Client connected: {sid}")
    await sio.emit("status", {"msg": "Connected to KANA Backend"}, room=sid)


@sio.event
async def disconnect(sid):
    print(f"[KANA] Client disconnected: {sid}")


async def _wait_loop_stop(timeout=8.0):
    global audio_loop, loop_task
    if audio_loop:
        audio_loop.stop()
        audio_loop = None
    old_task = loop_task
    loop_task = None
    if old_task and not (old_task.done() or old_task.cancelled()):
        try:
            await asyncio.wait_for(asyncio.shield(old_task), timeout=timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            old_task.cancel()
            try:
                await old_task
            except asyncio.CancelledError:
                pass


@sio.event
async def start_audio(sid, data=None):
    global audio_loop, loop_task

    if audio_loop and loop_task and not (loop_task.done() or loop_task.cancelled()):
        await sio.emit("status", {"msg": "KANA Already Running"}, room=sid)
        return

    if loop_task and not (loop_task.done() or loop_task.cancelled()):
        await _wait_loop_stop()

    device_index = data.get("device_index") if data else None
    device_name = data.get("device_name") if data else None
    output_device_index = data.get("output_device_index") if data else None
    output_device_name = data.get("output_device_name") if data else None
    muted = data.get("muted", False) if data else False

    def on_audio_data(data_bytes):
        asyncio.create_task(sio.emit("audio_data", {"data": list(data_bytes)}, room=sid))

    def on_transcription(data):
        asyncio.create_task(sio.emit("transcription", data, room=sid))

    def on_error(msg):
        asyncio.create_task(sio.emit("error", {"msg": msg}, room=sid))

    def on_ready():
        asyncio.create_task(sio.emit("status", {"msg": "KANA Started"}, room=sid))

    def on_stopped():
        asyncio.create_task(sio.emit("status", {"msg": "KANA Stopped"}, room=sid))

    await sio.emit("status", {"msg": "Connecting to KANA..."}, room=sid)

    try:
        audio_loop = AssistantLoop(
            on_audio_data=on_audio_data,
            on_transcription=on_transcription,
            on_error=on_error,
            on_ready=on_ready,
            on_stopped=on_stopped,
            input_device_index=device_index,
            input_device_name=device_name,
            output_device_index=output_device_index,
            output_device_name=output_device_name,
        )
        if muted:
            audio_loop.set_paused(True)

        loop_task = asyncio.create_task(audio_loop.run())
        loop_task.add_done_callback(lambda t: None)  # avoid unhandled exception in callback
    except Exception as e:
        print(f"[KANA] Failed to start: {e}")
        import traceback
        traceback.print_exc()
        await sio.emit("error", {"msg": f"Failed to start: {str(e)}"}, room=sid)
        audio_loop = None


@sio.event
async def stop_audio(sid):
    global audio_loop, loop_task
    try:
        await _wait_loop_stop()
    finally:
        await sio.emit("status", {"msg": "KANA Stopped"}, room=sid)


@sio.event
async def pause_audio(sid, data=None):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(True)
        await sio.emit("status", {"msg": "Audio Paused"}, room=sid)


@sio.event
async def resume_audio(sid, data=None):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(False)
        await sio.emit("status", {"msg": "Audio Resumed"}, room=sid)


@sio.event
async def user_input(sid, data):
    text = (data or {}).get("text", "").strip()
    if not text:
        return
    if not audio_loop or not audio_loop.session:
        await sio.emit("error", {"msg": "KANA not ready. Start audio first."}, room=sid)
        return
    try:
        await audio_loop.session.send(input=text, end_of_turn=True)
    except Exception as e:
        await sio.emit("error", {"msg": str(e)}, room=sid)


@sio.event
async def shutdown(sid, data=None):
    global audio_loop, loop_task
    if audio_loop:
        audio_loop.stop()
        audio_loop = None
    if loop_task and not loop_task.done():
        loop_task.cancel()
        loop_task = None
    os._exit(0)


if __name__ == "__main__":
    uvicorn.run(app_socketio, host="0.0.0.0", port=8000)
