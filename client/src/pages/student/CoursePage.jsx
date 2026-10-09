import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Lock, PlayCircle } from 'lucide-react';
import StudentLayout from '../../components/layout/StudentLayout';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import styles from './CoursePage.module.css';

const TAB_CONFIG = [
  { key: 'Beginner', label: 'Beginner Course' },
  { key: 'Intermediate', label: 'Intermediate Course' },
  { key: 'Advanced', label: 'Advanced Course' },
];

const DIFFICULTY_RANK = {
  Beginner: 1,
  Intermediate: 2,
  Advanced: 3,
};

const getTrackLabel = (module) => module?.difficulty || 'Beginner';

const normalizeLevel = (rawLevel) => {
  const normalized = String(rawLevel || '').trim().toLowerCase();
  if (normalized === 'intermediate') return 'Intermediate';
  if (normalized === 'placement-ready' || normalized === 'placement ready' || normalized === 'advanced' || normalized === 'advance') {
    return 'Advanced';
  }
  return 'Beginner';
};

const getVideoId = (videoUrl) => {
  if (!videoUrl) return '';
  const raw = String(videoUrl).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.replace('/', '');
    const queryId = parsed.searchParams.get('v');
    if (queryId) return queryId;
    const embedMatch = parsed.pathname.match(/embed\/([A-Za-z0-9_-]{11})/);
    return embedMatch ? embedMatch[1] : '';
  } catch {
    return '';
  }
};

const TopicRow = ({ topic, watched, onStart }) => {
  const isWatched = watched.has(String(topic._id)) || watched.has(getVideoId(topic.videoUrl));
  const isLocked = !topic.accessible || !topic.unlocked;

  return (
    <div className={`${styles.topicRow} ${isLocked ? styles.lockedRow : ''}`}>
      <div className={styles.topicMeta}>
        <span className={styles.topicIcon}>{isLocked ? '🔒' : '🎬'}</span>
        <div>
          <p className={styles.topicTitle}>{topic.title}</p>
          <p className={styles.topicSub}>
            {topic.videoDuration ? `${topic.videoDuration} min` : 'Duration N/A'}
          </p>
        </div>
      </div>

      <div className={styles.topicActions}>
        {isWatched ? (
          <span className={styles.watchedBadge}>
            <CheckCircle2 size={14} />
            Watched
          </span>
        ) : topic.unlocked ? (
          <span className={styles.lockedBadge}>Watch to unlock</span>
        ) : (
          <span className={styles.lockedBadge}>
            <Lock size={14} />
            Locked
          </span>
        )}

        <button
          className={styles.primaryBtn}
          onClick={() => onStart(topic._id)}
          disabled={isLocked}
        >
          {topic.completed ? 'Continue' : 'Start'}
        </button>
      </div>
    </div>
  );
};

export default function CoursePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progression, setProgression] = useState(null);
  const [watchedVideos, setWatchedVideos] = useState(new Set());
  const [activeTab, setActiveTab] = useState('Beginner');

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError('');
      try {
        const [progressionRes, watchedRes] = await Promise.all([
          api.get('/progression'),
          api.get('/videos/watched'),
        ]);

        const progressionData = progressionRes.data?.data;
        const watched = watchedRes.data?.data?.watchedVideos || [];
        setProgression(progressionData);
        setWatchedVideos(new Set(watched.map(String)));
        setActiveTab(normalizeLevel(progressionData?.currentLevel));
      } catch (err) {
        setError(err?.response?.data?.message || 'Failed to load course progression.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user?.currentLevel]);

  const visibleTabs = TAB_CONFIG;

  const groupedModules = useMemo(() =>
    (progression?.modules || []).filter(
      (mod) => (DIFFICULTY_RANK[getTrackLabel(mod)] || 1) === (DIFFICULTY_RANK[activeTab] || 1)
    ),
  [progression, activeTab]);

  const renderModule = (mod) => (
    <section key={mod._id} className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h3 className={styles.moduleTitle}>
            <span className={styles.moduleIcon}>{mod.icon || '📘'}</span>
            {mod.title}
          </h3>
          <p className={styles.moduleSubtitle}>{mod.description}</p>
        </div>
        <span className={styles.badge}>{getTrackLabel(mod)}</span>
      </div>

      <div className={styles.progressWrap}>
        <div className={styles.progressMeta}>
          <span>{mod.completedTopics} / {mod.totalTopics} topics completed</span>
          <span>{mod.percentage}%</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${mod.percentage}%` }} />
        </div>
      </div>

      <div className={styles.topicList}>
        {mod.topics.map((topic) => (
          <TopicRow
            key={topic._id}
            topic={topic}
            watched={watchedVideos}
            onStart={(topicId) => navigate(`/topic/${topicId}`)}
          />
        ))}
      </div>
    </section>
  );

  return (
    <StudentLayout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Video Course</h1>
          <p className={styles.subtitle}>All three courses stay visible. Complete topics and modules in order to unlock the next stage.</p>
        </div>

        <div className={styles.tabs}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              className={`${styles.tabBtn} ${activeTab === tab.key ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className={styles.stateCard}>
            <p>Loading course content...</p>
          </div>
        )}

        {!loading && error && (
          <div className={styles.stateCard}>
            <p>{error}</p>
            <button className={styles.primaryBtn} onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (!progression?.modules || progression.modules.length === 0) && (
          <div className={styles.stateCard}>
            <p>No modules found for your course yet.</p>
          </div>
        )}

        {!loading && !error && progression?.modules?.length > 0 && (
          <div className={styles.timeline}>
            {groupedModules.map((mod) => (
              <div key={mod._id} className={styles.timelineItem}>
                <div className={styles.timelineDot}>
                  <PlayCircle size={14} />
                </div>
                <div className={styles.timelineContent}>{renderModule(mod)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudentLayout>
  );
}
