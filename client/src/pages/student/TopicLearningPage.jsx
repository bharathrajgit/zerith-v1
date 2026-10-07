// client/src/pages/student/TopicLearningPage.jsx
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import StudentLayout from '../../components/layout/StudentLayout';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Check, Lock, Clock, ArrowLeft } from 'lucide-react';
import styles from './TopicLearningPage.module.css';

const STEPS = ['Watch Video', 'MCQ Round', 'Coding Problem'];

export default function TopicLearningPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [topic, setTopic] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [videoWatched, setVideoWatched] = useState(false);
  const [guardChecked, setGuardChecked] = useState(false);

  useEffect(() => {
    const checkTopicLock = async () => {
      try {
        const res = await api.get('/progression');
        const modules = res.data?.data?.modules || [];
        const allTopics = modules.flatMap((mod) => mod.topics || []);
        const target = allTopics.find((t) => String(t._id) === String(topicId));

        if (!target?.accessible) {
          toast.error('This topic is not available for your current level.');
          navigate('/courses', { replace: true });
          return;
        }

        if (target && !target.unlocked) {
          toast.error('This topic is locked. Complete earlier topics in this course first.');
          navigate('/courses', { replace: true });
          return;
        }
      } catch {
        // Non-blocking: if progression API fails, continue with existing page fetch.
      } finally {
        setGuardChecked(true);
      }
    };
    checkTopicLock();
  }, [topicId, navigate, user?.currentLevel]);

  useEffect(() => {
    if (!guardChecked) return;
    const fetchData = async () => {
      try {
        const [topicRes, watchedRes] = await Promise.all([
          api.get(`/topics/${topicId}`),
          api.get('/videos/watched'),
        ]);
        let progressRes = null;
        try {
          progressRes = await api.get(`/progress/${topicId}`);
        } catch (progressErr) {
          // New/unattempted topics legitimately have no progress doc yet (404).
          if (progressErr?.response?.status !== 404) {
            throw progressErr;
          }
        }
        if (topicRes.data.success) {
          const topicData = topicRes.data.data.topic;
          setTopic(topicData);
          const watchedVideos = watchedRes.data?.data?.watchedVideos || [];
          const watchedSet = new Set(watchedVideos.map(String));
          const resolvedVideoId = getVideoId(topicData?.videoUrl);
          if (watchedSet.has(String(topicId)) || (resolvedVideoId && watchedSet.has(resolvedVideoId))) {
            setVideoWatched(true);
          }
        } else {
          setError(topicRes.data.message || 'Failed to load topic data');
          return;
        }
        if (progressRes?.data?.success) {
          setProgress(progressRes.data.data.progress);
        } else {
          setProgress(null);
        }
      } catch (err) {
        console.error('Topic fetch error:', err);
        setError(err.response?.data?.message || 'Failed to load topic data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [topicId, guardChecked]);

  // Persist video completion locally so refresh keeps the step unlocked.
  useEffect(() => {
    const key = `dsa_video_watched_${topicId}`;
    const saved = localStorage.getItem(key);
    if (saved === '1') setVideoWatched(true);
  }, [topicId]);

  // Determine current step based on progress
  const getCurrentStep = () => {
    if (!progress) return videoWatched ? 1 : 0;
    if (!videoWatched) return 0;
    if ((progress.round1Score || 0) >= 80) {
      if ((progress.codingScore || 0) >= 80) return 3;
      return 2;
    }
    return 1;
  };

  const currentStep = getCurrentStep();

  const parseYoutubeTime = (url, key) => {
    if (!url) return undefined;
    const match = url.match(new RegExp(`${key}=([0-9]+)s?`));
    return match ? Number(match[1]) : undefined;
  };

  const getVideoId = (url) => {
    if (!url) return '';
    const trimmed = String(url).trim();

    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.slice(1);
      }
      const params = parsed.searchParams;
      if (params.has('v')) return params.get('v');
      const pathMatch = parsed.pathname.match(/embed\/([A-Za-z0-9_-]{11})/);
      if (pathMatch) return pathMatch[1];
    } catch {
      // Not a full URL, fall back to raw string parsing below
    }

    const beforeParams = trimmed.split('?')[0].split('&')[0];
    const match = beforeParams.match(/^([A-Za-z0-9_-]{11})$/);
    return match ? match[1] : '';
  };

  const videoAssets = useMemo(() => {
    const learningAssets = Array.isArray(topic?.learningAssets) ? topic.learningAssets : [];
    if (learningAssets.length > 0) {
      return learningAssets.filter((asset) => asset?.type === 'video' && asset?.videoId);
    }

    if (!topic?.videoUrl) return [];
    return [{
      videoId: topic.videoUrl,
      title: topic.videoTitle || topic.title,
      durationMinutes: Number(topic.videoDuration) || 0,
      source: 'primary-curated',
      language: 'English',
      tech: 'Java',
      isCodingRelevant: true,
    }];
  }, [topic]);

  const primaryVideo = videoAssets[0] || null;
  const supplementalVideos = videoAssets.slice(1);

  const startSeconds =
    Number(topic?.videoStartSeconds ?? topic?.startSeconds ?? topic?.videoStart ?? parseYoutubeTime(topic?.videoUrl, 't') ?? parseYoutubeTime(topic?.videoUrl, 'start') ?? 0);
  const endSeconds =
    Number(topic?.videoEndSeconds ?? topic?.endSeconds ?? topic?.videoEnd ?? parseYoutubeTime(topic?.videoUrl, 'end') ?? 0);
  const videoId = getVideoId(primaryVideo?.videoId || topic?.videoUrl);
  const hasValidVideo = Boolean(videoId);
  const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(primaryVideo?.title || topic?.videoTitle || topic?.title || 'DSA topic video')}`;
  const videoParams = new URLSearchParams({ controls: 1, modestbranding: 1, rel: 0, origin: window.location.origin });
  if (startSeconds > 0) videoParams.set('start', Math.floor(startSeconds));
  if (endSeconds > 0) videoParams.set('end', Math.floor(endSeconds));
  const embedUrl = hasValidVideo ? `https://www.youtube.com/embed/${videoId}?${videoParams.toString()}` : '';

  const markVideoWatched = async () => {
    const key = `dsa_video_watched_${topicId}`;
    localStorage.setItem(key, '1');
    setVideoWatched(true);
    try {
      await api.put('/roadmap/complete-task', {
        topicId,
        taskType: 'video',
      });
    } catch {
      toast.error('Video was marked locally, but roadmap sync failed.');
    }
  };

  const canStartBasic = videoWatched;
  const canStartCoding = canStartBasic && (progress?.round1Score || 0) >= 80;
  const codingDone = (progress?.codingScore || 0) >= 80;

  const openCodingChallenge = async () => {
    try {
      const res = await api.get(`/coding/by-topic/${topicId}`);
      const problemId = res.data?.data?.problem?._id;
      if (problemId) {
        navigate(`/coding/${problemId}`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Coding challenge unavailable for this topic.');
    }
  };


  if (!guardChecked || loading) {
    return (
      <StudentLayout>
        <div className={styles.skeletonPage}>
          <div className={styles.skeletonStepper} />
          <div className={styles.skeletonVideo} />
          <div className={styles.skeletonTags} />
        </div>
      </StudentLayout>
    );
  }

  if (error) {
    return (
      <StudentLayout>
        <div className={styles.errorState}>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className={styles.retryBtn}>Retry</button>
        </div>
      </StudentLayout>
    );
  }

  if (!topic && !loading) {
    return (
      <StudentLayout>
        <div className={styles.errorState}>
          <p>Topic not found or you don't have permission to access it.</p>
          <p>Please make sure you're logged in and the topic ID is correct.</p>
          <button onClick={() => window.location.href = '/modules'} className={styles.retryBtn}>
            Go to Modules
          </button>
        </div>
      </StudentLayout>
    );
  }
  
  if (!topic) return null; // Keep this for loading state

  return (
    <StudentLayout>
      <div className={styles.page}>
        {/* Header with back button */}
        <div className={styles.header}>
          <button
            onClick={() => navigate(-1)}
            className={styles.backButton}
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>
          <h1 className={styles.topicTitle}>{topic.title}</h1>
        </div>

        {/* Stepper */}
        <div className={styles.stepper}>
          {STEPS.map((label, idx) => {
            const isCompleted = idx < currentStep;
            const isActive = idx === currentStep;
            return (
              <div key={idx} className={styles.stepWrapper}>
                <div className={`${styles.stepCircle} ${
                  isCompleted ? styles.stepCompleted : isActive ? styles.stepActive : styles.stepLocked
                }`}>
                  {isCompleted ? <Check size={16} /> : idx + 1}
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`${styles.stepLine} ${idx < currentStep ? styles.lineActive : ''}`} />
                )}
                <span className={`${styles.stepLabel} ${isActive ? styles.labelActive : ''}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Video Section */}
        <section className={styles.videoSection}>
          <h2 className={styles.sectionTitle}>1. Watch Video</h2>
          {hasValidVideo ? (
            <div className={styles.videoContainer}>
              <iframe
                src={embedUrl}
                title={primaryVideo?.title || topic.videoTitle || topic.title}
                className={styles.videoIframe}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                allowFullScreen
              />
            </div>
          ) : (
            <div className={styles.noVideo}>
              No playable embedded video available for this topic.
              <div style={{ marginTop: '0.6rem' }}>
                <a href={youtubeSearchUrl} target="_blank" rel="noreferrer" className={styles.startAssessmentBtn}>
                  Open on YouTube
                </a>
              </div>
            </div>
          )}
          <div className={styles.videoInfo}>
            <p className={styles.videoTitle}>{primaryVideo?.title || topic.videoTitle}</p>
            <span className={styles.durationBadge}><Clock size={12} /> {primaryVideo?.durationMinutes || topic.videoDuration} min</span>
          </div>
          {videoWatched ? (
            <div className={styles.watchedBadge}><Check size={16} /> Watched!</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div className={styles.lockedTag}>
                <Lock size={12} /> Watch the video to unlock MCQs
              </div>
              <button
                onClick={markVideoWatched}
                style={{
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#a5b4fc',
                  padding: '0.4rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
              >
                I've watched this ✓
              </button>
            </div>
          )}
        </section>

        {supplementalVideos.length > 0 && (
          <section className={styles.conceptsSection}>
            <h2 className={styles.sectionTitle}>Supplemental Videos</h2>
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              {supplementalVideos.map((asset) => (
                <div
                  key={`${asset.videoId}-${asset.title}`}
                  style={{
                    border: '1px solid rgba(99, 102, 241, 0.18)',
                    borderRadius: '14px',
                    padding: '1rem 1.1rem',
                    background: 'rgba(15, 23, 42, 0.35)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <p className={styles.videoTitle} style={{ marginBottom: '0.35rem' }}>{asset.title}</p>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: '#94a3b8', fontSize: '0.85rem' }}>
                        <span>{asset.source || 'curated-supplement'}</span>
                        <span>{asset.language || 'English'}</span>
                        <span>{asset.tech || 'Java'}</span>
                        <span>{asset.durationMinutes || 0} min</span>
                      </div>
                    </div>
                    <a
                      href={`https://www.youtube.com/watch?v=${asset.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.startAssessmentBtn}
                    >
                      Open Video
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Java Concepts */}
        {topic.javaConceptTags && topic.javaConceptTags.length > 0 && (
          <section className={styles.conceptsSection}>
            <h2 className={styles.sectionTitle}>Key Java Concepts</h2>
            <div className={styles.tagCloud}>
              {topic.javaConceptTags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
            <p className={styles.description}>{topic.description}</p>
          </section>
        )}

        {/* Assessment Start */}
        {canStartBasic && (
          <section className={styles.assessmentSection}>
            <div className={styles.assessmentCard}>
              <h2>Ready to test your knowledge?</h2>
              <button
                className={styles.startAssessmentBtn}
                onClick={() => navigate(`/assessment/${topicId}/Basic`)}
              >
                Start MCQ Round →
              </button>
            </div>
          </section>
        )}

        {canStartCoding && (
          <section className={styles.assessmentSection}>
            <div className={styles.assessmentCard}>
              <h2>Coding task</h2>
              {codingDone ? (
                <div className={styles.watchedBadge}><Check size={16} /> Coding completed</div>
              ) : (
                <button
                  className={styles.startAssessmentBtn}
                  onClick={openCodingChallenge}
                >
                  Open Coding Challenge →
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </StudentLayout>
  );
}
