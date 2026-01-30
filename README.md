# KANA — MVP

Минимальный ассистент: чат + голос через Gemini Live API. Electron + React + Python (FastAPI + Socket.IO).

## Требования

- Python 3.11+
- Node.js 18+
- Ключ [Google Gemini API](https://aistudio.google.com/apikey)

## Установка

### Backend

```bash
cd KANA/backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

Создайте файл `.env` в папке `KANA` или `KANA/backend`:

```
GEMINI_API_KEY=ваш_ключ
```

### Frontend

```bash
cd KANA
npm install
```

## Запуск

1. Запуск всего приложения (Electron сам поднимет бэкенд и Vite):

```bash
cd KANA
npm run dev
```

2. Либо вручную: в одном терминале — `cd KANA/backend && python server.py`, в другом — `cd KANA/frontend && npm run dev` (только Vite), затем при необходимости Electron: `npm run start`.

## Использование

- Нажмите зелёную кнопку (Power) — запуск KANA и подключение к Gemini.
- Говорите в микрофон или вводите текст в поле ввода и нажимайте «Отправить».
- Красная кнопка — остановить KANA. Иконка микрофона — вкл/выкл микрофона (mute).

## Структура

- `backend/server.py` — FastAPI + Socket.IO, события: `start_audio`, `stop_audio`, `user_input`, `pause_audio`, `resume_audio`.
- `backend/assistant.py` — цикл Gemini Live (микрофон → модель → ответ аудио + транскрипция).
- `frontend/src/context/AssistantContext.jsx` — состояние и сокет на фронте.
- `frontend/src/components/TopBar.jsx`, `Chat.jsx` — панель и чат.

Дальше можно добавлять: жесты, Kasa, веб-агент, проекты — по одному модулю за раз.

