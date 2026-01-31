import React, { useRef, useState, useEffect, Suspense, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useAssistant } from '../context/AssistantContext';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import * as THREE from 'three';

const STORAGE_KEY = 'kana_avatar_vrm_url';
const DEFAULT_AVATAR_URL =
  import.meta.env.VITE_AVATAR_VRM_URL ||
  `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/avatar/model2.vrm`.replace(/\/+/g, '/');

const ANIMATION_BASE_URL = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/animation/`.replace(/\/+/g, '/');

// Idle animations (excluded laying_idle - moves out of frame)
const IDLE_ANIMATIONS = [
  'action_crouch', 'anger', 'annoyance', 'confusion',
  'curiosity', 'disappointment', 'disapproval', 'grief',
  'nervousnes3', 'reaction_headshot'
];

// Dance animations
const DANCE_ANIMATIONS = [
  'dance_1', 'dance_2', 'dance_backup', 'dance_dab',
  'dance_gangnam_style', 'dance_headdrop', 'dance_marachinostep',
  'dance_northern_soul_spin', 'dance_ontop', 'dance_pushback', 'dance_rumba'
];

// BVH bone names to VRM humanoid bone names (BVH uses lowercase/camelCase)
const BVH_TO_VRM_BONE_MAP = {
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperChest: 'upperChest',
  neck: 'neck',
  head: 'head',
  leftShoulder: 'leftShoulder',
  leftUpperArm: 'leftUpperArm',
  leftLowerArm: 'leftLowerArm',
  leftHand: 'leftHand',
  rightShoulder: 'rightShoulder',
  rightUpperArm: 'rightUpperArm',
  rightLowerArm: 'rightLowerArm',
  rightHand: 'rightHand',
  leftUpperLeg: 'leftUpperLeg',
  leftLowerLeg: 'leftLowerLeg',
  leftFoot: 'leftFoot',
  leftToes: 'leftToes',
  rightUpperLeg: 'rightUpperLeg',
  rightLowerLeg: 'rightLowerLeg',
  rightFoot: 'rightFoot',
  rightToes: 'rightToes',
};

function getStoredUrl() {
  try {
    const u = localStorage.getItem(STORAGE_KEY);
    return u && u.trim() ? u.trim() : null;
  } catch {
    return null;
  }
}

function AvatarOrbitControls() {
  const targetVec = useRef(new THREE.Vector3(0, -0.5, 0));
  return (
    <OrbitControls
      target={targetVec.current}
      enablePan={true}
      enableDamping={true}
      dampingFactor={0.1}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI - 0.15}
      minDistance={0.8}
      maxDistance={5}
      panSpeed={1}
      keyPanSpeed={20}
    />
  );
}

function AvatarScene({ vrmUrl, onLoadError, onLoaded, onLoadProgress, animationTrigger }) {
  const groupRef = useRef(null);
  const vrmRef = useRef(null);
  const mixerRef = useRef(null);
  const currentActionRef = useRef(null);
  const lookAtTargetRef = useRef(new THREE.Object3D());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadStartRef = useRef(0);
  const animationCacheRef = useRef({});
  const idleTimerRef = useRef(null);
  const prevIsListeningRef = useRef(false);
  const {
    audioLevel,
    isListening,
    isAssistantSpeaking,
    sentenceEnded,
    clearSentenceEnded,
    danceRequested,
    clearDanceRequested
  } = useAssistant();
  const { scene } = useThree();
  const mouthWeightRef = useRef(0);
  const blinkAccumRef = useRef(0);
  const blinkWeightRef = useRef(0);

  // Load BVH animation
  const loadBvhAnimation = useCallback(async (animName) => {
    if (animationCacheRef.current[animName]) {
      return animationCacheRef.current[animName];
    }

    const vrm = vrmRef.current;
    if (!vrm) return null;

    try {
      const bvhLoader = new BVHLoader();
      const url = `${ANIMATION_BASE_URL}${animName}.bvh`;
      const bvh = await new Promise((resolve, reject) => {
        bvhLoader.load(url, resolve, undefined, reject);
      });

      // Create animation clip from BVH
      const clip = bvh.clip;
      
      // Retarget tracks to VRM bones; skip root position to keep avatar in frame
      const retargetedTracks = [];
      const rootBones = ['hips', 'Hips'];
      for (const track of clip.tracks) {
        const parts = track.name.split('.');
        const bvhBoneName = parts[0];
        const property = parts.slice(1).join('.');
        const isRoot = rootBones.includes(bvhBoneName);
        if (isRoot && (property === 'position' || property.startsWith('position'))) continue;

        const vrmBoneName = BVH_TO_VRM_BONE_MAP[bvhBoneName] ?? bvhBoneName;
        const vrmBone = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName);
        if (!vrmBone) continue;
        
        const newTrack = track.clone();
        newTrack.name = `${vrmBone.name}.${property}`;
        retargetedTracks.push(newTrack);
      }

      if (retargetedTracks.length === 0) {
        console.warn(`No valid tracks found for animation: ${animName}`);
        return null;
      }

      const retargetedClip = new THREE.AnimationClip(animName, clip.duration, retargetedTracks);
      animationCacheRef.current[animName] = retargetedClip;
      return retargetedClip;
    } catch (err) {
      console.warn(`Failed to load animation ${animName}:`, err);
      return null;
    }
  }, []);

  // Play animation
  const playAnimation = useCallback(async (animName, options = {}) => {
    const { loop = false, fadeIn = 0.3, fadeOut = 0.3 } = options;
    const vrm = vrmRef.current;
    const mixer = mixerRef.current;
    if (!vrm || !mixer) return;

    const clip = await loadBvhAnimation(animName);
    if (!clip) return;

    // Fade out current action
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(fadeOut);
    }

    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !loop;
    action.fadeIn(fadeIn);
    action.play();
    currentActionRef.current = action;

    // If not looping, return to idle after animation ends
    if (!loop) {
      const onFinished = () => {
        mixer.removeEventListener('finished', onFinished);
        playAnimation('neutral3', { loop: true, fadeIn: 0.5 });
      };
      mixer.addEventListener('finished', onFinished);
    }
  }, [loadBvhAnimation]);

  // Random idle animation timer
  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    const scheduleNext = () => {
      const delay = 10000 + Math.random() * 10000; // 10-20 seconds
      idleTimerRef.current = setTimeout(() => {
        const randomAnim = IDLE_ANIMATIONS[Math.floor(Math.random() * IDLE_ANIMATIONS.length)];
        playAnimation(randomAnim, { loop: false });
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }, [playAnimation]);

  const stopIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

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
          vrmRef.current = vrm;
          
          // Create animation mixer
          mixerRef.current = new THREE.AnimationMixer(vrm.scene);
          
          if (groupRef.current) {
            groupRef.current.add(vrm.scene);
          }
          if (vrm.lookAt) {
            lookAtTargetRef.current.position.set(0, 0.25, 1.4);
            scene.add(lookAtTargetRef.current);
            vrm.lookAt.target = lookAtTargetRef.current;
            vrm.lookAt.autoUpdate = true;
          }
          setLoading(false);
          onLoaded?.(elapsed);
          
          // Start with neutral pose (ignore errors - BVH may fail)
          Promise.resolve().then(() => playAnimation('neutral3', { loop: true, fadeIn: 0 })).catch(() => {});
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
    [scene, onLoadError, onLoaded, onLoadProgress, playAnimation]
  );

  useEffect(() => {
    loadVrm(vrmUrl);
    return () => {
      stopIdleTimer();
      scene.remove(lookAtTargetRef.current);
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
      if (vrmRef.current) {
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
  }, [vrmUrl, scene, loadVrm, stopIdleTimer]);

  // Handle isListening change - play greeting animation
  useEffect(() => {
    if (isListening && !prevIsListeningRef.current) {
      // Just started listening - play greeting
      playAnimation('action_greeting', { loop: false });
      startIdleTimer();
    } else if (!isListening && prevIsListeningRef.current) {
      // Stopped listening
      stopIdleTimer();
      playAnimation('neutral3', { loop: true });
    }
    prevIsListeningRef.current = isListening;
  }, [isListening, playAnimation, startIdleTimer, stopIdleTimer]);

  // Handle sentence end - play pride animation
  useEffect(() => {
    if (sentenceEnded) {
      playAnimation('pride', { loop: false });
      clearSentenceEnded();
    }
  }, [sentenceEnded, clearSentenceEnded, playAnimation]);

  // Handle dance request
  useEffect(() => {
    if (danceRequested) {
      const randomDance = DANCE_ANIMATIONS[Math.floor(Math.random() * DANCE_ANIMATIONS.length)];
      playAnimation(randomDance, { loop: false, fadeIn: 0.5 });
      clearDanceRequested();
    }
  }, [danceRequested, clearDanceRequested, playAnimation]);

  useFrame((state, delta) => {
    const vrm = vrmRef.current;
    const mixer = mixerRef.current;
    if (!vrm) return;

    // Update animation mixer
    if (mixer) {
      mixer.update(delta);
    }

    // Update VRM (springbone physics, etc.)
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

  if (error) {
    return null;
  }

  return (
    <group ref={groupRef} position={[0, -1.2, 0]} scale={1.2}>
      {loading && (
        <mesh>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshBasicMaterial color="#334155" wireframe />
        </mesh>
      )}
    </group>
  );
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

export default function AvatarViewer({ className, avatarFile }) {
  const [vrmUrl, setVrmUrl] = useState(() => getStoredUrl() || DEFAULT_AVATAR_URL);
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [loadProgress, setLoadProgress] = useState(null);
  const [loadTimeSec, setLoadTimeSec] = useState(null);
  const [fileNameFromFile, setFileNameFromFile] = useState(null);
  const blobUrlRef = useRef(null);

  // Handle avatarFile from parent
  useEffect(() => {
    if (avatarFile) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      const url = URL.createObjectURL(avatarFile);
      blobUrlRef.current = url;
      setFileNameFromFile(avatarFile.name);
      setVrmUrl(url);
      setLoadError(null);
    }
  }, [avatarFile]);

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
    setLoadError(null);
  };

  return (
    <div className={`${className} relative flex flex-col`} style={{ minHeight: 200, background: '#18181b' }}>
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-zinc-800 shrink-0 z-10 bg-zinc-900/80">
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
          <span className="text-xs text-zinc-500">Загружено за {loadTimeSec.toFixed(1)} с</span>
        )}
      </div>

      {loadError && (
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
        <AvatarOrbitControls />
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
