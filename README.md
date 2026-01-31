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

Если при запуске KANA появляются ошибки:

- **«Your API key was reported as leaked»** — ключ отозван. Создайте новый ключ в [Google AI Studio](https://aistudio.google.com/apikey), обновите `GEMINI_API_KEY` в `.env` и перезапустите бэкенд.
- **«Operation is not implemented, or supported, or enabled»** (1008) — Live API недоступен для ключа или региона. Проверьте [документацию Live API](https://ai.google.dev/gemini-api/docs/live); для некоторых ключей нужен доступ по allowlist.

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
- Аватар слева отображает состояние: **Ожидание** / **Слушает** / **Думает** / **Говорит**. Иконка шестерёнки — настройки модели VRM (URL или загрузка файла).

## Аватар (VRM)

KANA отображается как анимированный VRM-аватар: lip-sync по голосу ответа, моргание и взгляд в камеру.

- **Модель по умолчанию** задаётся переменной окружения при сборке фронта:
  ```bash
  VITE_AVATAR_VRM_URL=https://example.com/your-model.vrm
  ```
  Либо в интерфейсе: шестерёнка рядом с аватаром → ввести URL и нажать «Применить URL», или «Загрузить файл» (.vrm). URL сохраняется в `localStorage`; загруженный файл действует до перезагрузки страницы.
- При ошибке загрузки показывается сообщение и кнопки «Повторить» и «Сбросить URL».

## Структура

- `backend/server.py` — FastAPI + Socket.IO, события: `start_audio`, `stop_audio`, `user_input`, `pause_audio`, `resume_audio`.
- `backend/assistant.py` — цикл Gemini Live (микрофон → модель → ответ аудио + транскрипция).
- `frontend/src/context/AssistantContext.jsx` — состояние и сокет на фронте; в контексте также `audioLevel` и `isAssistantSpeaking` (для lip-sync аватара).
- `frontend/src/components/TopBar.jsx`, `Chat.jsx` — панель и чат.
- `frontend/src/components/AvatarViewer.jsx` — 3D-аватар (Three.js + @pixiv/three-vrm): загрузка VRM, lip-sync по `audioLevel`, idle-анимации, настройки URL/файл, состояния и overlay ошибки.

Дальше можно добавлять: жесты, Kasa, веб-агент, проекты — по одному модулю за раз.




1. Добавить кнопу сокрытия чата в таком же стиле как кнопка включения.
2. При сокрытии чата, можно продолжать говорить с аватаром.
3. при сокрытии чата, окто с аватаром растягивается на весь экран. 
4. Аватара можно перемещать, приближать, крутить мышью.
5. Убрать статус(ожидает, слушает и тд в чат)
6. Из окна аватара переместить кнопку настроек на уровень с кнопкой включения. Кнопка будет отвечать за загрузку аватара с пк. Кнопка будет с рисунком загрузки. 
7.  Добавить кнопку настройки, она будет отвечать за выбор устройства ввода и вывода. Так же там будет настройка шамоподавления. 
8. При нажати кнопки аватар занимает позу action_greeting.bvh 
8. Во время статуса ожидает аватар занимает позу neutral3 по умолчанию из папки animation и переодически(10-20 секнд) запускает одну из поз (action_crouch.bvh, anger.bvh, annoyance.bvh, confusion.bvh, curiosity.bvh, disappointment.bvh, disapproval.bvh, grief.bvh, laying_idle.bvh, nervousnes3.bvh, reaction_headshot.bvh )
9. После окончания предложения аватар использует позу pride.bvh
10. При перемещении у аватара трясуться волосы и одежда
11. Когда просишь аватара станцевать исполняется одна из поз(dance_1.bvh, dance_2.bvh, dance_backup.bvh, dance_dab.bvh, dance_gangnam_style.bvh , dance_headdrop.bvh , dance_marachinostep.bvh , dance_northern_soul_spin.bvh ,dance_ontop.bvh ,dance_pushback.bvh ,dance_rumba.bvh )