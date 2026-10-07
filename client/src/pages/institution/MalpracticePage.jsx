import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Image as ImageIcon,
  Search,
  Unlock,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import InstitutionLayout from '../../components/layout/InstitutionLayout';
import api from '../../services/api';
import styles from './MalpracticePage.module.css';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'gaze_away', label: 'Gaze Away' },
  { value: 'face_missing', label: 'Face Missing' },
  { value: 'multiple_faces', label: 'Multiple Faces' },
  { value: 'mobile_detected', label: 'Mobile Detected' },
  { value: 'tab_switch', label: 'Tab Switch' },
  { value: 'copy_attempt', label: 'Copy Attempt' },
  { value: 'behavioral_anomaly', label: 'Behavioral Anomaly' },
];

const RISK_OPTIONS = [
  { value: 'ALL', label: 'All Risk' },
  { value: 'LOW', label: 'LOW' },
  { value: 'MEDIUM', label: 'MEDIUM' },
  { value: 'HIGH', label: 'HIGH' },
];

const TYPE_LABELS = {
  gaze_away: 'Gaze Away',
  face_missing: 'Face Missing',
  multiple_faces: 'Multiple Faces',
  mobile_detected: 'Mobile Detected',
  tab_switch: 'Tab Switch',
  copy_attempt: 'Copy Attempt',
  behavioral_anomaly: 'Behavioral Anomaly',
};

const EMPTY_STATS = {
  totalViolations: 0,
  highRiskCount: 0,
  lockedStudentsCount: 0,
  mobileDetections: 0,
  tabSwitchCount: 0,
  topOffenders: [],
  recentAlerts: [],
};

const formatDateTime = (value) => (
  value ? new Date(value).toLocaleString() : 'N/A'
);

const revokeObjectUrls = (map) => {
  Object.values(map || {}).forEach((url) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  });
};

export default function MalpracticePage() {
  const previewUrlsRef = useRef({});
  const [stats, setStats] = useState(EMPTY_STATS);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [filters, setFilters] = useState({
    violationType: 'all',
    riskLevel: 'ALL',
    search: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [previewUrls, setPreviewUrls] = useState({});
  const [modalState, setModalState] = useState({
    open: false,
    log: null,
    imageUrl: '',
    loading: false,
  });
  const [lockedStudents, setLockedStudents] = useState([]);
  const [lockedStudentsLoading, setLockedStudentsLoading] = useState(false);
  const [lockedStudentEvidence, setLockedStudentEvidence] = useState({});

  const loadStats = async () => {
    setStatsLoading(true);

    try {
      const { data } = await api.get('/institution/malpractice/stats');
      if (data?.success) {
        setStats({
          ...EMPTY_STATS,
          ...data,
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to load malpractice stats');
    } finally {
      setStatsLoading(false);
    }
  };

  const loadLockedStudents = async () => {
    setLockedStudentsLoading(true);

    try {
      const { data } = await api.get('/institution/malpractice/locked-students');
      if (data?.success) {
        const students = Array.isArray(data?.lockedStudents) ? data.lockedStudents : [];
        setLockedStudents(students);
        
        // Load evidence images for students with evidence
        const evidencePromises = students
          .filter(s => s.hasEvidence && s.latestEvidenceId)
          .map(async (student) => {
            try {
              const response = await api.get(`/institution/analytics/malpractice/evidence/${student.latestEvidenceId}/image`, {
                responseType: 'blob',
              });
              const imageUrl = URL.createObjectURL(response.data);
              return { studentId: student._id, imageUrl };
            } catch (error) {
              console.error('Failed to load evidence for student:', student._id, error);
              return { studentId: student._id, imageUrl: null };
            }
          });
        
        const evidenceResults = await Promise.all(evidencePromises);
        const evidenceMap = {};
        evidenceResults.forEach(result => {
          evidenceMap[result.studentId] = result.imageUrl;
        });
        setLockedStudentEvidence(evidenceMap);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to load locked students');
      setLockedStudents([]);
    } finally {
      setLockedStudentsLoading(false);
    }
  };

  const loadLogs = async (nextPage = page, nextFilters = filters) => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: '20',
      });

      if (nextFilters.riskLevel) {
        params.set('riskLevel', nextFilters.riskLevel);
      }
      if (nextFilters.violationType) {
        params.set('violationType', nextFilters.violationType);
      }
      if (nextFilters.search.trim()) {
        params.set('search', nextFilters.search.trim());
      }
      if (nextFilters.from) {
        params.set('from', nextFilters.from);
      }
      if (nextFilters.to) {
        params.set('to', nextFilters.to);
      }

      const { data } = await api.get(`/institution/malpractice/logs?${params.toString()}`);
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setTotalPages(Math.max(1, Number(data?.totalPages || 1)));
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to load malpractice logs');
      setLogs([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadLockedStudents();
  }, []);

  useEffect(() => {
    loadLogs(page, filters);
  }, [page, filters]);

  useEffect(() => {
    let cancelled = false;

    const loadPreviews = async () => {
      revokeObjectUrls(previewUrlsRef.current);
      previewUrlsRef.current = {};
      setPreviewUrls({});

      const visibleEvidenceLogs = logs.filter((log) => log.hasEvidence && log.latestEvidenceId);
      console.log('[MalpracticePage] Loading previews for logs:', visibleEvidenceLogs.length);
      
      if (!visibleEvidenceLogs.length) {
        return;
      }

      const previewResults = await Promise.allSettled(
        visibleEvidenceLogs.map(async (log) => {
          try {
            console.log('[MalpracticePage] Loading evidence for log:', log._id, 'evidenceId:', log.latestEvidenceId);
            const response = await api.get(
              `/institution/analytics/malpractice/evidence/${log.latestEvidenceId}/image`,
              { responseType: 'blob' }
            );

            return {
              id: log._id,
              url: URL.createObjectURL(response.data),
            };
          } catch (error) {
            console.error('[MalpracticePage] Failed to load evidence for log:', log._id, error);
            return null;
          }
        })
      );

      if (cancelled) {
        previewResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            URL.revokeObjectURL(result.value.url);
          }
        });
        return;
      }

      const nextUrls = {};
      previewResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          nextUrls[result.value.id] = result.value.url;
        }
      });

      console.log('[MalpracticePage] Loaded previews:', Object.keys(nextUrls).length);
      previewUrlsRef.current = nextUrls;
      setPreviewUrls(nextUrls);
    };

    loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [logs]);

  useEffect(() => () => {
    revokeObjectUrls(previewUrlsRef.current);
  }, []);

  const handleFilterChange = (field, value) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleUnlock = async (log) => {
    if (!log?.userId?._id) return;

    try {
      const { data } = await api.post('/institution/malpractice/unlock', {
        studentId: log.userId._id,
        sessionType: log.sessionType,
        reason: 'Institution manual override',
      });

      if (!data?.success) {
        throw new Error(data?.message || 'Unlock failed');
      }

      toast.success('Student unlocked');
      await Promise.all([loadStats(), loadLogs(page, filters), loadLockedStudents()]);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to unlock student');
    }
  };

  const handleUnlockStudent = async (student) => {
    if (!student?._id) return;

    try {
      const { data } = await api.post('/institution/malpractice/unlock', {
        studentId: student._id,
        reason: 'Institution manual override',
      });

      if (!data?.success) {
        throw new Error(data?.message || 'Unlock failed');
      }

      toast.success('Student unlocked');
      
      // Clean up evidence URL for this student
      if (lockedStudentEvidence[student._id]) {
        URL.revokeObjectURL(lockedStudentEvidence[student._id]);
      }
      
      await Promise.all([loadStats(), loadLogs(page, filters), loadLockedStudents()]);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to unlock student');
    }
  };

  const openEvidence = async (log) => {
    if (!log?.hasEvidence || !log.latestEvidenceId) {
      return;
    }

    const existingUrl = previewUrlsRef.current[log._id];
    if (existingUrl) {
      setModalState({
        open: true,
        log,
        imageUrl: existingUrl,
        loading: false,
      });
      return;
    }

    setModalState({
      open: true,
      log,
      imageUrl: '',
      loading: true,
    });

    try {
      const response = await api.get(
        `/institution/analytics/malpractice/evidence/${log.latestEvidenceId}/image`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(response.data);
      previewUrlsRef.current = {
        ...previewUrlsRef.current,
        [log._id]: url,
      };
      setPreviewUrls((current) => ({
        ...current,
        [log._id]: url,
      }));
      setModalState({
        open: true,
        log,
        imageUrl: url,
        loading: false,
      });
    } catch (error) {
      setModalState({
        open: false,
        log: null,
        imageUrl: '',
        loading: false,
      });
      toast.error(error?.response?.data?.message || 'Failed to load evidence image');
    }
  };

  const closeModal = () => {
    setModalState({
      open: false,
      log: null,
      imageUrl: '',
      loading: false,
    });
  };

  const downloadEvidence = () => {
    if (!modalState.imageUrl || !modalState.log) return;

    const anchor = document.createElement('a');
    anchor.href = modalState.imageUrl;
    anchor.download = `malpractice-${modalState.log._id}.jpg`;
    anchor.click();
  };

  return (
    <InstitutionLayout>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>Malpractice Monitoring</h1>
            <p className={styles.subtitle}>Review warnings, evidence, and active locks across institution-linked assessments.</p>
          </div>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Violations</span>
            <strong className={styles.statValue}>{statsLoading ? '...' : stats.totalViolations}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statDanger}`}>
            <span className={styles.statLabel}>High Risk Cases</span>
            <strong className={styles.statValue}>{statsLoading ? '...' : stats.highRiskCount}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statWarning}`}>
            <span className={styles.statLabel}>Currently Locked Students</span>
            <strong className={styles.statValue}>{statsLoading ? '...' : stats.lockedStudentsCount}</strong>
          </div>
          <div className={`${styles.statCard} ${styles.statPrimary}`}>
            <span className={styles.statLabel}>Mobile Detections</span>
            <strong className={styles.statValue}>{statsLoading ? '...' : stats.mobileDetections}</strong>
          </div>
        </div>

        {lockedStudents.length > 0 && (
          <div className={styles.lockedStudentsCard}>
            <div className={styles.lockedStudentsHeader}>
              <h2>Currently Locked Students</h2>
              <span>{lockedStudents.length} student(s) locked</span>
            </div>
            <div className={styles.lockedStudentsList}>
              {lockedStudents.map((student) => (
                <div key={student._id} className={styles.lockedStudentItem}>
                  <div className={styles.lockedStudentInfo}>
                    <strong>{student.name}</strong>
                    <span>{student.email}</span>
                    <div className={styles.lockDetails}>
                      <span className={styles.lockType}>{student.activeSessionType}</span>
                      <span>•</span>
                      <span>{student.lockReason || 'Unknown reason'}</span>
                      <span>•</span>
                      <span>Unlocks in: {student.timeRemainingFormatted}</span>
                    </div>
                  </div>
                  <div className={styles.lockedStudentEvidence}>
                    {student.lockReason?.includes('face_missing') ? (
                      <div className={styles.noEvidenceMessage}>
                        <span className={styles.lockReasonText}>{student.lockReason || 'Unknown reason'}</span>
                      </div>
                    ) : lockedStudentEvidence[student._id] ? (
                      <img 
                        src={lockedStudentEvidence[student._id]} 
                        alt={`Evidence for ${student.name}`}
                        className={styles.evidenceThumbnail}
                      />
                    ) : (
                      <div className={styles.noEvidenceMessage}>
                        <span>No image found</span>
                        <span className={styles.lockReasonText}>Locked for: {student.lockReason || 'Unknown reason'}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type='button'
                    className={styles.unlockButton}
                    onClick={() => handleUnlockStudent(student)}
                  >
                    <Unlock size={14} />
                    Unlock
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.filtersCard}>
          <div className={styles.filtersRow}>
            <label className={styles.filterField}>
              <span>Violation Type</span>
              <select
                value={filters.violationType}
                onChange={(event) => handleFilterChange('violationType', event.target.value)}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className={styles.filterField}>
              <span>Risk Level</span>
              <select
                value={filters.riskLevel}
                onChange={(event) => handleFilterChange('riskLevel', event.target.value)}
              >
                {RISK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className={styles.filterField}>
              <span>From</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => handleFilterChange('from', event.target.value)}
                style={{ cursor: 'pointer', zIndex: 1 }}
              />
            </label>

            <label className={styles.filterField}>
              <span>To</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => handleFilterChange('to', event.target.value)}
                style={{ cursor: 'pointer', zIndex: 1 }}
              />
            </label>
          </div>

          <label className={`${styles.filterField} ${styles.searchField}`}>
            <span>Search Student</span>
            <div className={styles.searchInputWrap}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Search by name, username, or email"
                value={filters.search}
                onChange={(event) => handleFilterChange('search', event.target.value)}
              />
            </div>
          </label>
        </div>

        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <h2>Violation Logs</h2>
            <span>{loading ? 'Loading...' : `${logs.length} items on this page`}</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Loading malpractice logs...</div>
          ) : logs.length === 0 ? (
            <div className={styles.emptyState}>No malpractice logs match the current filters.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Risk</th>
                    <th>Time</th>
                    <th>Lock Reason</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log._id}>
                      <td>
                        <div className={styles.studentCell}>
                          <strong>{log.userId?.name || 'Unknown Student'}</strong>
                          <span>{log.userId?.email || 'No email'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.riskBadge} ${styles[`risk${log.riskLevel}`] || ''}`}>
                          {log.riskLevel}
                        </span>
                      </td>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        {log.lockReason ? (
                          <span className={styles.lockReasonText}>{log.lockReason}</span>
                        ) : (
                          <span className={styles.noAction}>-</span>
                        )}
                      </td>
                      <td>
                        {log.hasEvidence && log.latestEvidenceId ? (
                          <button
                            type="button"
                            className={styles.evidenceButton}
                            onClick={() => openEvidence(log)}
                          >
                            {previewUrls[log._id] ? (
                              <img
                                src={previewUrls[log._id]}
                                alt={`Evidence thumbnail`}
                                className={styles.thumbnail}
                              />
                            ) : (
                              <span className={styles.thumbnailPlaceholder}>
                                <ImageIcon size={16} />
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className={styles.noEvidence}>No image</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageButton}
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>

        {modalState.open ? (
          <div className={styles.modalOverlay} onClick={closeModal}>
            <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
              <button type="button" className={styles.closeButton} onClick={closeModal}>
                <X size={18} />
              </button>

              <div className={styles.modalHeader}>
                <div>
                  <h3>{modalState.log?.userId?.name || 'Unknown Student'}</h3>
                  <p>
                    {TYPE_LABELS[modalState.log?.violationType] || 'Monitoring Alert'} • {formatDateTime(modalState.log?.createdAt)}
                  </p>
                </div>
              </div>

              <div className={styles.modalImageWrap}>
                {modalState.loading ? (
                  <div className={styles.modalPlaceholder}>Loading evidence image...</div>
                ) : modalState.imageUrl ? (
                  <img
                    src={modalState.imageUrl}
                    alt={TYPE_LABELS[modalState.log?.violationType] || 'Evidence'}
                    className={styles.modalImage}
                  />
                ) : (
                  <div className={styles.modalPlaceholder}>Evidence image unavailable.</div>
                )}
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryButton} onClick={closeModal}>
                  Close
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={downloadEvidence}
                  disabled={!modalState.imageUrl}
                >
                  <Download size={16} />
                  Download
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </InstitutionLayout>
  );
}
