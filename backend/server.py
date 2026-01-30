import sys
import asyncio
import os

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import socketio
import uvicorn
from fastapi import FastAPI

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assistant import AssistantLoop

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = FastAPI()
app_socketio = socketio.ASGIApp(sio, app)

audio_loop = None
loop_task = None


@app.get("/status")
async def status():
    return {"status": "running", "service": "KANA Backend"}


@sio.event
async def connect(sid, environ):
    print(f"[KANA] Client connected: {sid}")
    await sio.emit("status", {"msg": "Connected to KANA Backend"}, room=sid)


@sio.event
async def disconnect(sid):
    print(f"[KANA] Client disconnected: {sid}")


@sio.event
async def start_audio(sid, data=None):
    global audio_loop, loop_task

    if audio_loop and loop_task and not (loop_task.done() or loop_task.cancelled()):
        await sio.emit("status", {"msg": "KANA Already Running"}, room=sid)
        return

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

    try:
        audio_loop = AssistantLoop(
            on_audio_data=on_audio_data,
            on_transcription=on_transcription,
            on_error=on_error,
            input_device_index=device_index,
            input_device_name=device_name,
            output_device_index=output_device_index,
            output_device_name=output_device_name,
        )
        if muted:
            audio_loop.set_paused(True)

        loop_task = asyncio.create_task(audio_loop.run())
        loop_task.add_done_callback(lambda t: None)  # avoid unhandled exception in callback
        await sio.emit("status", {"msg": "KANA Started"}, room=sid)
    except Exception as e:
        print(f"[KANA] Failed to start: {e}")
        import traceback
        traceback.print_exc()
        await sio.emit("error", {"msg": f"Failed to start: {str(e)}"}, room=sid)
        audio_loop = None


@sio.event
async def stop_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.stop()
        audio_loop = None
    await sio.emit("status", {"msg": "KANA Stopped"}, room=sid)


@sio.event
async def pause_audio(sid):
    global audio_loop
    if audio_loop:
        audio_loop.set_paused(True)
        await sio.emit("status", {"msg": "Audio Paused"}, room=sid)


@sio.event
async def resume_audio(sid):
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
