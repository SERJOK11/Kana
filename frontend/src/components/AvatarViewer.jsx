import React, { useRef, useState, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useAssistant } from '../context/AssistantContext';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Settings, RotateCcw, Upload, X } from 'lucide-react';
import * as THREE from 'three';

const STORAGE_KEY = 'kana_avatar_vrm_url';
const DEFAULT_AVATAR_URL =
  import.meta.env.VITE_AVATAR_VRM_URL ||
  `${import.meta.env.BASE_URL || '/'}6493143135142452442.vrm`.replace(/\/+/g, '/');

function getStoredUrl() {
  try {
    const u = localStorage.getItem(STORAGE_KEY);
    return u && u.trim() ? u.trim() : null;
  } catch {
    return null;
  }
}

const CAMERA_VIEWS = {
  front: { position: [0, 0.2, 1.5], label: 'Спереди' },
  side: { position: [1.2, 0.2, 0], label: 'Сбоку' },
  back: { position: [0, 0.2, -1.5], label: 'Сзади' },
};

function CameraController({ viewKey }) {
  const { camera } = useThree();
  const view = CAMERA_VIEWS[viewKey] || CAMERA_VIEWS.front;
  const target = useRef(new THREE.Vector3(0, 0, 0));
  useFrame(() => {
    const [x, y, z] = view.position;
    camera.position.lerp(new THREE.Vector3(x, y, z), 0.08);
    camera.lookAt(target.current);
    camera.updateProjectionMatrix();
  });
  return null;
}

function AvatarScene({ vrmUrl, onLoadError, onLoaded, onLoadProgress }) {
  const vrmRef = useRef(null);
  const lookAtTargetRef = useRef(new THREE.Object3D());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadStartRef = useRef(0);
  const { audioLevel, isListening, isAssistantSpeaking, messages } = useAssistant();
  const { scene } = useThree();
  const mouthWeightRef = useRef(0);
  const blinkAccumRef = useRef(0);
  const blinkWeightRef = useRef(0);

  const loadVrm = useCallback(
    (url) => {
      if (!url) return;
      setLoading(true);
      setError(null);
      onLoadError?.(null);
      loadStartRef.current = Date.now();
      onLoadProgress?.({ percent: 0, loaded: 0, total: 0 });

      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      loader.load(
        url,
        (gltf) => {
          const elapsed = (Date.now() - loadStartRef.current) / 1000;
          const vrm = gltf.userData.vrm;
          if (!vrm) {
            const err = 'Invalid VRM';
            setError(err);
            onLoadError?.(err);
            setLoading(false);
            return;
          }
          try {
            VRMUtils.rotateVRM0(vrm);
          } catch (_) {}
          vrmRef.current = vrm;
          vrm.scene.position.set(0, -1.2, 0);
          vrm.scene.scale.setScalar(1.2);
          scene.add(vrm.scene);
          if (vrm.lookAt) {
            lookAtTargetRef.current.position.set(0, 0.25, 1.4);
            scene.add(lookAtTargetRef.current);
            vrm.lookAt.target = lookAtTargetRef.current;
            vrm.lookAt.autoUpdate = true;
          }
          setLoading(false);
          onLoaded?.(elapsed);
        },
        (progress) => {
          const total = progress.total || 1;
          const loaded = progress.loaded || 0;
          const percent = total > 0 ? Math.min(100, (100 * loaded) / total) : 0;
          onLoadProgress?.({ percent, loaded, total });
        },
        (err) => {
          const msg = err?.message || 'Failed to load VRM';
          setError(msg);
          onLoadError?.(msg);
          setLoading(false);
        }
      );

      return () => {
        loader.manager.onLoad = () => {};
        loader.manager.onError = () => {};
      };
    },
    [scene, onLoadError, onLoaded, onLoadProgress]
  );

  useEffect(() => {
    loadVrm(vrmUrl);
    return () => {
      scene.remove(lookAtTargetRef.current);
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        vrmRef.current.scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose();
          }
        });
        vrmRef.current = null;
      }
    };
  }, [vrmUrl, scene, loadVrm]);

  useFrame((state, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;

    vrm.update(delta);

    const em = vrm.expressionManager;
    if (em) {
      const mouthTarget = Math.min(1, audioLevel * 2.5);
      mouthWeightRef.current += (mouthTarget - mouthWeightRef.current) * 0.3;
      const hasAa = em.getExpression('aa') != null;
      if (hasAa) em.setValue('aa', mouthWeightRef.current);

      blinkAccumRef.current += delta;
      if (blinkAccumRef.current > 3.5) {
        blinkAccumRef.current = 0;
        blinkWeightRef.current = 1;
      }
      if (blinkWeightRef.current > 0) {
        blinkWeightRef.current = Math.max(0, blinkWeightRef.current - delta * 12);
        const hasBlink = em.getExpression('blink') != null;
        if (hasBlink) em.setValue('blink', blinkWeightRef.current);
      }
    }
  });

  if (loading) {
    return (
      <mesh>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial color="#334155" wireframe />
      </mesh>
    );
  }
  if (error) {
    return null;
  }

  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-2, 2, 3]} intensity={0.4} />
    </>
  );
}

function AvatarStateBadge({ state }) {
  const labels = {
    idle: 'Ожидание',
    listening: 'Слушает',
    thinking: 'Думает',
    speaking: 'Говорит',
  };
  const colors = {
    idle: 'bg-zinc-600',
    listening: 'bg-emerald-600',
    thinking: 'bg-amber-600',
    speaking: 'bg-violet-600',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colors[state] || 'bg-zinc-600'}`}
    >
      {labels[state] || state}
    </span>
  );
}

export default function AvatarViewer({ className }) {
  const [vrmUrl, setVrmUrl] = useState(() => getStoredUrl() || DEFAULT_AVATAR_URL);
  const [loadError, setLoadError] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [loadProgress, setLoadProgress] = useState(null);
  const [loadTimeSec, setLoadTimeSec] = useState(null);
  const [viewTab, setViewTab] = useState('front');
  const [fileNameFromFile, setFileNameFromFile] = useState(null);
  const fileInputRef = useRef(null);
  const blobUrlRef = useRef(null);
  const { isListening, isAssistantSpeaking, messages } = useAssistant();

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const isLoading = loadProgress !== null && loadTimeSec === null && !loadError;

  const handleLoadProgress = useCallback((p) => {
    setLoadProgress(p);
    if (p?.percent === 0) setLoadTimeSec(null);
  }, []);
  const handleLoaded = useCallback((elapsed) => {
    setLoadTimeSec(elapsed);
    setLoadProgress(null);
    setLoadError(null);
  }, []);
  const handleLoadError = useCallback((err) => {
    setLoadError(err);
    setLoadProgress(null);
  }, []);

  const avatarState =
    isAssistantSpeaking
      ? 'speaking'
      : isListening
        ? messages.length > 0 && messages[messages.length - 1]?.sender === 'User'
          ? 'thinking'
          : 'listening'
        : 'idle';

  const applyUrl = () => {
    const u = urlInput.trim();
    if (u) {
      try {
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
        localStorage.setItem(STORAGE_KEY, u);
        setFileNameFromFile(null);
        setVrmUrl(u);
        setLoadError(null);
      } catch (e) {
        setLoadError('Не удалось сохранить URL');
      }
    }
  };

  const loadFile = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setFileNameFromFile(file.name);
    setVrmUrl(url);
    setLoadError(null);
    setUrlInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetToDefault = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setFileNameFromFile(null);
    setVrmUrl(DEFAULT_AVATAR_URL);
    setUrlInput('');
    setLoadError(null);
  };

  const openSettings = () => {
    setUrlInput(getStoredUrl() || '');
    setSettingsOpen(true);
  };

  return (
    <div className={`${className} relative flex flex-col`} style={{ minHeight: 200, background: '#18181b' }}>
      <div className="absolute top-1 left-1 right-1 flex items-center justify-between z-10">
        <AvatarStateBadge state={avatarState} />
        <button
          type="button"
          onClick={openSettings}
          className="p-1.5 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300"
          title="Настройки аватара"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs: loading progress or view */}
      <div className="flex items-center gap-1 px-2 pt-8 pb-1 border-b border-zinc-800 shrink-0 z-10 bg-zinc-900/80">
        {isLoading && (
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                {vrmUrl.startsWith('blob:')
                  ? `Загрузка из файла${fileNameFromFile ? `: ${fileNameFromFile}` : ''}`
                  : 'Загрузка модели'}
              </span>
              <span>
                {loadProgress?.percent != null ? `${Math.round(loadProgress.percent)}%` : '…'}
                {loadProgress?.total > 0 && (
                  <span className="ml-2 text-zinc-500">
                    ({(loadProgress.loaded / 1024).toFixed(1)} / {(loadProgress.total / 1024).toFixed(1)} KB)
                  </span>
                )}
                {vrmUrl.startsWith('blob:') && (!loadProgress?.total || loadProgress.total === 0) && (
                  <span className="ml-2 text-zinc-500">чтение файла…</span>
                )}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${loadProgress?.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}
        {!isLoading && loadTimeSec != null && (
          <>
            <span className="text-xs text-zinc-500 mr-2">Загружено за {loadTimeSec.toFixed(1)} с</span>
            <div className="flex gap-0.5">
            {Object.entries(CAMERA_VIEWS).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                onClick={() => setViewTab(key)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  viewTab === key
                    ? 'bg-zinc-600 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
            </div>
          </>
        )}
      </div>

      {settingsOpen && (
        <div className="absolute inset-0 bg-zinc-900/95 z-20 flex flex-col p-3 gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium">Модель VRM</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="URL модели .vrm"
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-600 text-zinc-100 placeholder-zinc-500 text-xs"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={applyUrl}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              Применить URL
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded bg-zinc-600 hover:bg-zinc-500 text-zinc-200 text-xs flex items-center gap-1"
            >
              <Upload className="w-3.5 h-3.5" />
              Загрузить файл
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".vrm"
              className="hidden"
              onChange={loadFile}
            />
            <button
              type="button"
              onClick={resetToDefault}
              className="px-3 py-1.5 rounded bg-zinc-600 hover:bg-zinc-500 text-zinc-200 text-xs flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Сброс
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Файл из «Загрузить файл» действует до перезагрузки страницы.
          </p>
        </div>
      )}

      {loadError && !settingsOpen && (
        <div className="absolute inset-0 bg-zinc-900/95 z-20 flex flex-col items-center justify-center p-4 gap-3 text-sm">
          <p className="text-zinc-300 text-center">Не удалось загрузить модель: {loadError}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setLoadError(null); setRetryKey((k) => k + 1); }}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Повторить
            </button>
            <button
              type="button"
              onClick={() => { resetToDefault(); setLoadError(null); }}
              className="px-4 py-2 rounded bg-zinc-600 hover:bg-zinc-500 text-zinc-200"
            >
              Сбросить URL
            </button>
          </div>
        </div>
      )}

      <Canvas
        camera={{ position: [0, 0.2, 1.5], fov: 35 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <color attach="background" args={['#18181b']} />
        <Lights />
        <CameraController viewKey={viewTab} />
        <Suspense fallback={null}>
          <AvatarScene
            key={`${vrmUrl}-${retryKey}`}
            vrmUrl={vrmUrl}
            onLoadError={handleLoadError}
            onLoaded={handleLoaded}
            onLoadProgress={handleLoadProgress}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
