"""
KANA MVP — минимальный ассистент: Gemini Live API, голос + текст, без инструментов.
"""
import asyncio
import os
import sys
import time
import struct
import math

from dotenv import load_dotenv
from google import genai
from google.genai import types
import pyaudio

if sys.version_info < (3, 11, 0):
    import taskgroup
    import exceptiongroup
    asyncio.TaskGroup = taskgroup.TaskGroup
    asyncio.ExceptionGroup = exceptiongroup.ExceptionGroup

# Load .env from KANA/ or KANA/backend/
_load_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
if os.path.isfile(_load_env):
    load_dotenv(_load_env)
load_dotenv()
client = genai.Client(http_options={"api_version": "v1beta"}, api_key=os.getenv("GEMINI_API_KEY"))

FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024
MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025"

pya = pyaudio.PyAudio()

config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    output_audio_transcription={},
    input_audio_transcription={},
    system_instruction=(
        "Отвечай по-русски. "
        "Тебя зовут KANA, ты умный ассистент программиста, говоря о себе используй женскийц род. "
        "У тебя остроумный и обаятельный характер. "
        "Твой создатель — Serjok, и ты обращаешься к нему как ты. "
        "Отвечая, используй полные и лаконичные предложения "
        "У тебя весёлый характер."
    ),
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
        ),
        language_code="ru-RU",
    ),
)


class AssistantLoop:
    """Один цикл: микрофон -> Gemini -> ответ (аудио + транскрипция). Без инструментов."""

    def __init__(
        self,
        on_audio_data=None,
        on_transcription=None,
        on_error=None,
        input_device_index=None,
        input_device_name=None,
        output_device_index=None,
        output_device_name=None,
    ):
        self.on_audio_data = on_audio_data
        self.on_transcription = on_transcription
        self.on_error = on_error
        self.input_device_index = input_device_index
        self.input_device_name = input_device_name
        self.output_device_index = output_device_index
        self.output_device_name = output_device_name

        self.audio_in_queue = None
        self.out_queue = None
        self.paused = False
        self.session = None
        self.stop_event = asyncio.Event()
        self.audio_stream = None

        self._last_input_transcription = ""
        self._last_output_transcription = ""

    def set_paused(self, paused):
        self.paused = paused

    def stop(self):
        self.stop_event.set()

    async def send_realtime(self):
        try:
            while True:
                msg = await self.out_queue.get()
                if self.session:
                    try:
                        await self.session.send(input=msg, end_of_turn=False)
                    except Exception as e:
                        print(f"[KANA] send_realtime error: {e}")
        except asyncio.CancelledError:
            raise

    async def listen_audio(self):
        mic_info = pya.get_default_input_device_info()
        resolved = self.input_device_index if self.input_device_index is not None else mic_info["index"]
        if self.input_device_name:
            for i in range(pya.get_device_count()):
                try:
                    info = pya.get_device_info_by_index(i)
                    if info["maxInputChannels"] > 0 and self.input_device_name.lower() in info.get("name", "").lower():
                        resolved = i
                        break
                except Exception:
                    continue

        try:
            self.audio_stream = await asyncio.to_thread(
                pya.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=SEND_SAMPLE_RATE,
                input=True,
                input_device_index=resolved,
                frames_per_buffer=CHUNK_SIZE,
            )
        except OSError as e:
            print(f"[KANA] Mic open failed: {e}")
            self.audio_stream = None
            return

        kwargs = {"exception_on_overflow": False} if __debug__ else {}
        while True:
            if self.paused:
                await asyncio.sleep(0.1)
                continue
            try:
                if not self.audio_stream:
                    break
                data = await asyncio.to_thread(self.audio_stream.read, CHUNK_SIZE, **kwargs)
                if self.out_queue:
                    try:
                        await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})
                    except asyncio.QueueFull:
                        try:
                            self.out_queue.get_nowait()
                            await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})
                        except Exception:
                            pass
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[KANA] listen_audio: {e}")
                await asyncio.sleep(0.1)

    async def receive_audio(self):
        while not self.session and not self.stop_event.is_set():
            await asyncio.sleep(0.1)
        if not self.session:
            return

        while True:
            try:
                turn = self.session.receive()
                async for response in turn:
                    if response.data:
                        self.audio_in_queue.put_nowait(response.data)

                    if response.server_content:
                        if response.server_content.input_transcription and response.server_content.input_transcription.text:
                            t = response.server_content.input_transcription.text
                            if t != self._last_input_transcription:
                                delta = t[len(self._last_input_transcription):] if t.startswith(self._last_input_transcription) else t
                                self._last_input_transcription = t
                                if delta and self.on_transcription:
                                    self.on_transcription({"sender": "User", "text": delta})
                        if response.server_content.output_transcription and response.server_content.output_transcription.text:
                            t = response.server_content.output_transcription.text
                            if t != self._last_output_transcription:
                                delta = t[len(self._last_output_transcription):] if t.startswith(self._last_output_transcription) else t
                                self._last_output_transcription = t
                                if delta and self.on_transcription:
                                    self.on_transcription({"sender": "KANA", "text": delta})

                    if response.tool_call:
                        pass  # MVP: игнорируем инструменты

                while not self.audio_in_queue.empty():
                    self.audio_in_queue.get_nowait()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[KANA] receive_audio: {e}")
                if self.on_error:
                    self.on_error(str(e))
                await asyncio.sleep(0.1)
                if self.stop_event.is_set():
                    break

    async def play_audio(self):
        stream = None
        pya_instance = pyaudio.PyAudio()
        try:
            stream = await asyncio.to_thread(
                pya_instance.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=RECEIVE_SAMPLE_RATE,
                output=True,
                output_device_index=self.output_device_index,
            )
        except Exception as e:
            print(f"[KANA] Speaker open failed: {e}")

        try:
            while True:
                try:
                    bytestream = await self.audio_in_queue.get()
                    if self.on_audio_data:
                        self.on_audio_data(bytestream)
                    if stream:
                        await asyncio.to_thread(stream.write, bytestream)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    print(f"[KANA] play_audio: {e}")
                    await asyncio.sleep(0.1)
        finally:
            if stream:
                try:
                    stream.close()
                except Exception:
                    pass
            try:
                pya_instance.terminate()
            except Exception:
                pass

    async def run(self, start_message=None):
        while not self.stop_event.is_set():
            try:
                print("[KANA] Connecting to Gemini Live...")
                async with (
                    client.aio.live.connect(model=MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session = session
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue = asyncio.Queue(maxsize=10)

                    tg.create_task(self.send_realtime())
                    tg.create_task(self.listen_audio())
                    tg.create_task(self.receive_audio())
                    tg.create_task(self.play_audio())

                    if start_message:
                        await self.session.send(input=start_message, end_of_turn=True)

                    await self.stop_event.wait()

            except asyncio.CancelledError:
                break
            except Exception as e:
                if hasattr(e, "exceptions"):
                    for err in e.exceptions:
                        print(f"[KANA] Connection error: {err}")
                else:
                    print(f"[KANA] Connection error: {e}")
                if self.stop_event.is_set():
                    break
                await asyncio.sleep(1)

            finally:
                if getattr(self, "audio_stream", None):
                    try:
                        self.audio_stream.close()
                    except Exception:
                        pass
                    self.audio_stream = None
