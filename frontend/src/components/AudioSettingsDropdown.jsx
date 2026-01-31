import React, { useState, useEffect, useRef } from 'react';
import { useAssistant } from '../context/AssistantContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const STORAGE_KEY_INPUT = 'kana_audio_input_device';
const STORAGE_KEY_OUTPUT = 'kana_audio_output_device';
const STORAGE_KEY_NOISE = 'kana_noise_suppression';

function loadStoredDevice(key) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' && parsed !== null ? parsed : { index: null, name: '' };
  } catch {
    return null;
  }
}

export default function AudioSettingsDropdown({ onClose }) {
  const { setAudioSettings, isListening, stopAudio, startAudio } = useAssistant();
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedInputIndex, setSelectedInputIndex] = useState(null);
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(null);
  const [noiseSuppression, setNoiseSuppression] = useState(
    () => localStorage.getItem(STORAGE_KEY_NOISE) !== 'false'
  );
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    async function loadDevices() {
      try {
        const res = await fetch(`${API_BASE}/api/devices`);
        const data = await res.json();
        if (data.error) {
          setFetchError(data.error);
          return;
        }
        const inputs = data.inputs || [];
        const outputs = data.outputs || [];
        setInputDevices(inputs);
        setOutputDevices(outputs);

        const storedInput = loadStoredDevice(STORAGE_KEY_INPUT);
        const storedOutput = loadStoredDevice(STORAGE_KEY_OUTPUT);

        const inputIndex = storedInput?.index !== undefined && storedInput?.index !== null ? storedInput.index : null;
        const outputIndex = storedOutput?.index !== undefined && storedOutput?.index !== null ? storedOutput.index : null;

        setSelectedInputIndex(inputIndex);
        setSelectedOutputIndex(outputIndex);

        const inputDev = inputIndex != null ? inputs.find((d) => d.index === inputIndex) : null;
        const outputDev = outputIndex != null ? outputs.find((d) => d.index === outputIndex) : null;

        setAudioSettings((prev) => ({
          ...prev,
          inputDevice: inputDev ? { index: inputDev.index, name: inputDev.name } : { index: null, name: '' },
          outputDevice: outputDev ? { index: outputDev.index, name: outputDev.name } : { index: null, name: '' },
          noiseSuppression,
        }));
      } catch (err) {
        setFetchError(err.message || 'Не удалось загрузить устройства');
        console.error('Failed to load devices:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDevices();
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    if (val === 'default') {
      setSelectedInputIndex(null);
      const obj = { index: null, name: '' };
      localStorage.setItem(STORAGE_KEY_INPUT, JSON.stringify(obj));
      setAudioSettings((prev) => ({ ...prev, inputDevice: obj }));
      if (isListening) {
        stopAudio();
        setTimeout(() => startAudio({ inputDevice: obj }), 1000);
      }
      return;
    }
    const index = parseInt(val, 10);
    if (Number.isNaN(index)) return;
    const device = inputDevices.find((d) => d.index === index);
    setSelectedInputIndex(index);
    const obj = { index, name: device?.name || '' };
    localStorage.setItem(STORAGE_KEY_INPUT, JSON.stringify(obj));
    setAudioSettings((prev) => ({ ...prev, inputDevice: obj }));
    if (isListening) {
      stopAudio();
      const outDev = outputDevices.find((d) => d.index === selectedOutputIndex) || outputDevices[0];
      setTimeout(() => startAudio({ inputDevice: obj, outputDevice: outDev ? { index: outDev.index, name: outDev.name } : undefined }), 1000);
    }
  };

  const handleOutputChange = (e) => {
    const val = e.target.value;
    if (val === 'default') {
      setSelectedOutputIndex(null);
      const obj = { index: null, name: '' };
      localStorage.setItem(STORAGE_KEY_OUTPUT, JSON.stringify(obj));
      setAudioSettings((prev) => ({ ...prev, outputDevice: obj }));
      if (isListening) {
        stopAudio();
        setTimeout(() => startAudio({ outputDevice: obj }), 1000);
      }
      return;
    }
    const index = parseInt(val, 10);
    if (Number.isNaN(index)) return;
    const device = outputDevices.find((d) => d.index === index);
    setSelectedOutputIndex(index);
    const obj = { index, name: device?.name || '' };
    localStorage.setItem(STORAGE_KEY_OUTPUT, JSON.stringify(obj));
    setAudioSettings((prev) => ({ ...prev, outputDevice: obj }));
    if (isListening) {
      stopAudio();
      const inDev = inputDevices.find((d) => d.index === selectedInputIndex) || inputDevices[0];
      setTimeout(() => startAudio({ outputDevice: obj, inputDevice: inDev ? { index: inDev.index, name: inDev.name } : undefined }), 1000);
    }
  };

  const handleNoiseChange = (e) => {
    const value = e.target.checked;
    setNoiseSuppression(value);
    localStorage.setItem(STORAGE_KEY_NOISE, String(value));
    setAudioSettings((prev) => ({ ...prev, noiseSuppression: value }));
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 p-3"
    >
      <div className="text-sm text-zinc-300 font-medium mb-3">Настройки аудио</div>

      {loading ? (
        <div className="text-xs text-zinc-500">Загрузка устройств...</div>
      ) : fetchError ? (
        <div className="text-xs text-red-400">{fetchError}</div>
      ) : (
        <>
          <div className="mb-3">
            <label className="block text-xs text-zinc-400 mb-1">Микрофон</label>
            <select
              value={selectedInputIndex === null ? 'default' : String(selectedInputIndex)}
              onChange={handleInputChange}
              className="w-full px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="default">По умолчанию</option>
              {inputDevices.map((d) => (
                <option key={d.index} value={String(d.index)}>
                  {d.name || `Микрофон ${d.index}`}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-zinc-400 mb-1">Динамик</label>
            <select
              value={selectedOutputIndex === null ? 'default' : String(selectedOutputIndex)}
              onChange={handleOutputChange}
              className="w-full px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="default">По умолчанию</option>
              {outputDevices.map((d) => (
                <option key={d.index} value={String(d.index)}>
                  {d.name || `Динамик ${d.index}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="noise-suppression"
              checked={noiseSuppression}
              onChange={handleNoiseChange}
              className="w-4 h-4 rounded bg-zinc-700 border-zinc-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <label htmlFor="noise-suppression" className="text-xs text-zinc-300">
              Шумоподавление
            </label>
          </div>
          <p className="text-xs text-zinc-500 mt-2">Перезапустите KANA для применения устройств.</p>
        </>
      )}
    </div>
  );
}
