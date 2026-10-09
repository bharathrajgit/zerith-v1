import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';

const YOUTUBE_API_URL = 'https://www.youtube.com/iframe_api';
const YOUTUBE_PLAYING = 1;
const SEEK_TOLERANCE_SECONDS = 1.5;
const NATURAL_ADVANCE_TOLERANCE_SECONDS = 0.75;
const MAX_PLAYBACK_RATE = 1.5;

let youtubeApiPromise;

const loadYouTubeApi = () => {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const script = document.querySelector(`script[src="${YOUTUBE_API_URL}"]`)
      || document.createElement('script');
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube player API did not load'));
    }, 15000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (typeof previousReady === 'function') previousReady();
      resolve(window.YT);
    };

    if (!script.src) {
      script.src = YOUTUBE_API_URL;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('YouTube player API failed to load'));
      };
      document.head.appendChild(script);
    }
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
};

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

export default function VerifiedYouTubePlayer({
  topicId,
  videoId,
  title,
  startSeconds = 0,
  endSeconds = 0,
  durationSeconds = 0,
  currentTime = 0,
  maxWatchedTime = 0,
  isCompleted = false,
  onProgressSaved,
}) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const completedRef = useRef(isCompleted);
  const maxWatchedRef = useRef(maxWatchedTime);
  const currentTimeRef = useRef(currentTime);
  const progressRequestRef = useRef(false);
  const lastNaturalSampleRef = useRef(null);
  const [playerState, setPlayerState] = useState(-1);
  const [displayTime, setDisplayTime] = useState(currentTime);
  const [localMaxWatched, setLocalMaxWatched] = useState(maxWatchedTime);
  const [blockedSeek, setBlockedSeek] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [progressError, setProgressError] = useState('');

  useEffect(() => {
    completedRef.current = isCompleted;
  }, [isCompleted]);

  useEffect(() => {
    maxWatchedRef.current = Math.max(maxWatchedRef.current, Number(maxWatchedTime) || 0);
    setLocalMaxWatched(maxWatchedRef.current);
  }, [maxWatchedTime]);

  useEffect(() => {
    currentTimeRef.current = Number(currentTime) || 0;
    setDisplayTime(currentTimeRef.current);
  }, [currentTime]);

  useEffect(() => {
    let disposed = false;
    let pollTimer = null;
    let saveTimer = null;
    let player = null;

    const createPlayer = async () => {
      try {
        const youtube = await loadYouTubeApi();
        if (disposed || !hostRef.current) return;

        player = new youtube.Player(hostRef.current, {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            end: endSeconds > 0 ? Math.floor(endSeconds) : undefined,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            start: startSeconds > 0 ? Math.floor(startSeconds) : undefined,
          },
          events: {
            onReady: (event) => {
              try {
                playerRef.current = event.target;
                playerReadyRef.current = true;
                setPlayerError('');
                const resumeOffset = Math.max(
                  0,
                  Math.min(Number(currentTimeRef.current) || 0, Number(durationSeconds) || Infinity)
                );
                event.target.seekTo(startSeconds + resumeOffset, true);
                if (event.target.getPlaybackRate() > MAX_PLAYBACK_RATE) {
                  event.target.setPlaybackRate(MAX_PLAYBACK_RATE);
                }
                lastNaturalSampleRef.current = {
                  time: startSeconds + resumeOffset,
                  at: Date.now(),
                };
              } catch (error) {
                setPlayerError(error?.message || 'Unable to initialize the video player.');
              }
            },
            onStateChange: (event) => {
              setPlayerState(event.data);
              if (event.data === YOUTUBE_PLAYING) {
                try {
                  lastNaturalSampleRef.current = {
                    time: event.target.getCurrentTime(),
                    at: Date.now(),
                  };
                } catch (error) {
                  setPlayerError(error?.message || 'Unable to read video playback state.');
                }
              }
              if (event.data === 0 && !completedRef.current) {
                const finalOffset = durationSeconds || Math.max(0, event.target.getCurrentTime() - startSeconds);
                currentTimeRef.current = finalOffset;
                setDisplayTime(finalOffset);
                saveProgress(finalOffset);
              }
            },
            onError: () => setPlayerError('This video could not be loaded. Please try again later.'),
          },
        });
        playerRef.current = player;
      } catch (error) {
        if (!disposed) {
          playerReadyRef.current = false;
          setPlayerError(error?.message || 'Unable to load the YouTube player.');
        }
      }
    };

    const saveProgress = async (time = currentTimeRef.current) => {
      if (!topicId || progressRequestRef.current || completedRef.current) return;

      progressRequestRef.current = true;
      try {
        const { data } = await api.put(`/progress/${topicId}/video-progress`, {
          currentTime: time,
          maxWatchedTime: maxWatchedRef.current,
          duration: durationSeconds,
        });
        const saved = data?.data;
        if (!saved) throw new Error('Video progress response was invalid');

        const acceptedMax = Math.max(0, Number(saved.maxWatchedTime) || 0);
        maxWatchedRef.current = Math.max(maxWatchedRef.current, acceptedMax);
        setLocalMaxWatched(maxWatchedRef.current);
        if (Number.isFinite(Number(saved.currentTime))) {
          currentTimeRef.current = Number(saved.currentTime);
          setDisplayTime(currentTimeRef.current);
        }
        if (saved.completed) completedRef.current = true;
        setProgressError('');
        onProgressSaved?.(saved);
      } catch (error) {
        setProgressError(
          error?.response?.data?.message || 'Video progress could not be saved. Please try again.'
        );
      } finally {
        progressRequestRef.current = false;
      }
    };

    const checkPlayback = () => {
      try {
        const activePlayer = playerRef.current;
        if (
          !playerReadyRef.current
          || typeof activePlayer?.getPlayerState !== 'function'
          || typeof activePlayer.getCurrentTime !== 'function'
          || typeof activePlayer.getPlaybackRate !== 'function'
          || typeof activePlayer.seekTo !== 'function'
        ) return;

        const playerStateNow = activePlayer.getPlayerState();
        if (playerStateNow === -1) return;
        const absoluteTime = activePlayer.getCurrentTime();
        const offsetTime = Math.max(0, absoluteTime - startSeconds);
        const now = Date.now();
        const lastSample = lastNaturalSampleRef.current;
        const rate = activePlayer.getPlaybackRate();

        if (rate > MAX_PLAYBACK_RATE) {
          activePlayer.setPlaybackRate(MAX_PLAYBACK_RATE);
          setBlockedSeek(true);
          window.setTimeout(() => setBlockedSeek(false), 2500);
        }

        if (endSeconds > 0 && absoluteTime > endSeconds) {
          activePlayer.seekTo(endSeconds, true);
        } else if (!completedRef.current && offsetTime > maxWatchedRef.current + SEEK_TOLERANCE_SECONDS) {
          activePlayer.seekTo(startSeconds + maxWatchedRef.current, true);
          setBlockedSeek(true);
          window.setTimeout(() => setBlockedSeek(false), 2500);
          lastNaturalSampleRef.current = {
            time: startSeconds + maxWatchedRef.current,
            at: now,
          };
          return;
        } else if (
          playerStateNow === YOUTUBE_PLAYING
          && lastSample
          && absoluteTime >= lastSample.time
        ) {
          const elapsedSeconds = Math.max(0, (now - lastSample.at) / 1000);
          const naturalAdvanceLimit = elapsedSeconds * Math.min(rate || 1, MAX_PLAYBACK_RATE)
            + NATURAL_ADVANCE_TOLERANCE_SECONDS;
          const delta = absoluteTime - lastSample.time;
          if (delta <= naturalAdvanceLimit && !completedRef.current) {
            const nextMax = Math.max(
              maxWatchedRef.current,
              Math.min(offsetTime, Number(durationSeconds) || offsetTime)
            );
            if (nextMax > maxWatchedRef.current) {
              maxWatchedRef.current = nextMax;
              setLocalMaxWatched(nextMax);
            }
          }
          lastNaturalSampleRef.current = { time: absoluteTime, at: now };
        } else {
          lastNaturalSampleRef.current = { time: absoluteTime, at: now };
        }

        currentTimeRef.current = offsetTime;
        setDisplayTime(offsetTime);
      } catch (error) {
        setPlayerError(error?.message || 'Video playback tracking stopped unexpectedly.');
      }
    };

    createPlayer();
    pollTimer = window.setInterval(checkPlayback, 500);
    saveTimer = window.setInterval(() => {
      if (playerRef.current) saveProgress(currentTimeRef.current);
    }, 5000);

    return () => {
      disposed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      if (saveTimer) window.clearInterval(saveTimer);
      playerReadyRef.current = false;
      try {
        player?.destroy();
      } catch {
        // Player teardown is best-effort when the iframe API is still initializing.
      }
      playerRef.current = null;
    };
  }, [videoId, topicId, startSeconds, endSeconds, durationSeconds, onProgressSaved]);

  const allowedSeekTime = isCompleted
    ? Number(durationSeconds) || displayTime
    : Math.min(Number(durationSeconds) || 0, localMaxWatched);
  const watchedPercent = isCompleted
    ? 100
    : durationSeconds > 0
      ? Math.min(100, (localMaxWatched / durationSeconds) * 100)
    : 0;

  const seekTo = (value) => {
    const requested = Number(value) || 0;
    const safeTime = Math.min(requested, allowedSeekTime);
    if (!isCompleted && requested > localMaxWatched + SEEK_TOLERANCE_SECONDS) {
      setBlockedSeek(true);
      window.setTimeout(() => setBlockedSeek(false), 2500);
    }
    try {
      if (typeof playerRef.current?.seekTo !== 'function') return;
      playerRef.current.seekTo(startSeconds + safeTime, true);
      currentTimeRef.current = safeTime;
      setDisplayTime(safeTime);
      lastNaturalSampleRef.current = {
        time: startSeconds + safeTime,
        at: Date.now(),
      };
    } catch (error) {
      setPlayerError(error?.message || 'Unable to seek in this video.');
    }
  };

  const togglePlayback = () => {
    try {
      if (playerState === YOUTUBE_PLAYING) {
        if (typeof playerRef.current?.pauseVideo === 'function') playerRef.current.pauseVideo();
      } else if (typeof playerRef.current?.playVideo === 'function') {
        playerRef.current.playVideo();
      }
    } catch (error) {
      setPlayerError(error?.message || 'Unable to control video playback.');
    }
  };

  return (
    <div>
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        overflow: 'hidden',
        borderRadius: '18px',
        background: '#000',
      }}>
        <div ref={hostRef} title={title} style={{ position: 'absolute', inset: 0 }} />
      </div>
      {playerError && (
        <div role="alert" style={{ marginTop: '0.5rem', color: '#fca5a5', fontSize: '0.8rem' }}>
          {playerError}
        </div>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        marginTop: '0.75rem',
        color: '#cbd5e1',
        fontSize: '0.8rem',
      }}>
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playerState === YOUTUBE_PLAYING ? 'Pause video' : 'Play video'}
          style={{
            border: '1px solid rgba(148,163,184,0.35)',
            borderRadius: '8px',
            padding: '0.4rem 0.7rem',
            background: 'rgba(99,102,241,0.15)',
            color: '#e0e7ff',
            cursor: 'pointer',
          }}
        >
          {playerState === YOUTUBE_PLAYING ? 'Pause' : 'Play'}
        </button>
        <span>{formatTime(displayTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(Number(durationSeconds) || 0, 1)}
          step="1"
          value={Math.min(displayTime, Math.max(Number(durationSeconds) || 0, 1))}
          onChange={(event) => seekTo(event.target.value)}
          aria-label="Video progress"
          style={{
            flex: 1,
            height: '6px',
            borderRadius: '999px',
            appearance: 'none',
            cursor: 'pointer',
            background: `linear-gradient(to right, #22c55e 0%, #22c55e ${watchedPercent}%, #475569 ${watchedPercent}%, #475569 100%)`,
          }}
        />
        <span>{formatTime(durationSeconds)}</span>
      </div>
      {!isCompleted && (
        <div style={{ minHeight: '1.4rem', marginTop: '0.35rem', fontSize: '0.78rem' }}>
          {blockedSeek && <span role="status" style={{ color: '#fbbf24' }}>Finish watching to unlock skipping</span>}
          {progressError && <span role="alert" style={{ color: '#fca5a5' }}>{progressError}</span>}
        </div>
      )}
    </div>
  );
}
