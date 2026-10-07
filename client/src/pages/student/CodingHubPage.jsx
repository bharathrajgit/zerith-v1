import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentLayout from '../../components/layout/StudentLayout';
import api from '../../services/api';

const FILTERS = ['All', 'Unlocked', 'Solved', 'Locked'];

const badgeStyle = (state) => {
  if (state === 'solved') {
    return { background: 'rgba(34,197,94,0.16)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.28)' };
  }
  if (state === 'unlocked') {
    return { background: 'rgba(99,102,241,0.16)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.28)' };
  }
  return { background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.22)' };
};

export default function CodingHubPage() {
  const navigate = useNavigate();
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const { data } = await api.get('/coding');
        if (data.success) {
          setProblems(data.data?.problems || []);
        } else {
          setError(data.message || 'Failed to load coding problems.');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load coding problems.');
      } finally {
        setLoading(false);
      }
    };

    fetchProblems();
  }, []);

  const filteredProblems = useMemo(() => {
    let filtered = problems.filter((problem) => {
      const matchesSearch = !search.trim()
        || `${problem.title} ${problem.topicTitle} ${problem.moduleTitle}`
          .toLowerCase()
          .includes(search.trim().toLowerCase());
      if (!matchesSearch) return false;

      if (filter === 'Unlocked') return problem.state === 'unlocked';
      if (filter === 'Solved') return problem.state === 'solved';
      if (filter === 'Locked') return problem.state === 'locked';
      return true;
    });

    // Sort: unlocked first, then solved, then locked
    const stateOrder = { unlocked: 0, solved: 1, locked: 2 };
    filtered.sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);

    return filtered;
  }, [filter, problems, search]);

  const paginatedProblems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredProblems.slice(startIndex, endIndex);
  }, [filteredProblems, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredProblems.length / itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, search]);

  const solvedCount = problems.filter((problem) => problem.state === 'solved').length;
  const unlockedCount = problems.filter((problem) => problem.state === 'unlocked').length;

  return (
    <StudentLayout>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '1.5rem' }}>
        <header
          style={{
            border: '1px solid rgba(99,102,241,0.18)',
            background: 'linear-gradient(135deg, rgba(15,23,42,0.92), rgba(30,41,59,0.82))',
            borderRadius: 24,
            padding: '1.5rem',
            boxShadow: '0 24px 60px rgba(2,6,23,0.36)',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ color: '#818cf8', marginBottom: '0.35rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Coding Arena
              </p>
              <h1 style={{ color: '#f8fafc', margin: 0, fontSize: '2rem' }}>Java DSA Problems</h1>
              <p style={{ color: '#94a3b8', marginTop: '0.6rem', maxWidth: 720 }}>
                Practice in a real editor, run sample tests, submit against hidden cases, and unlock the next topic only after an accepted solution.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: '0.85rem', minWidth: 260 }}>
              <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>Unlocked</p>
                <p style={{ margin: '0.35rem 0 0', color: '#f8fafc', fontWeight: 800, fontSize: '1.5rem' }}>{unlockedCount}</p>
              </div>
              <div style={{ padding: '1rem', borderRadius: 18, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>Solved</p>
                <p style={{ margin: '0.35rem 0 0', color: '#f8fafc', fontWeight: 800, fontSize: '1.5rem' }}>{solvedCount}</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by problem, topic, or module"
              style={{
                flex: '1 1 260px',
                background: 'rgba(15,23,42,0.76)',
                border: '1px solid rgba(148,163,184,0.22)',
                borderRadius: 14,
                color: '#e2e8f0',
                padding: '0.85rem 1rem',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {FILTERS.map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: 12,
                    border: filter === item ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(148,163,184,0.18)',
                    background: filter === item ? 'rgba(99,102,241,0.18)' : 'rgba(15,23,42,0.58)',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </header>

        {loading ? (
          <div style={{ color: '#94a3b8' }}>Loading coding problems...</div>
        ) : error ? (
          <div style={{ color: '#fca5a5' }}>{error}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1rem' }}>
              {paginatedProblems.map((problem) => (
              <article
                key={problem._id}
                style={{
                  borderRadius: 22,
                  padding: '1.25rem',
                  border: '1px solid rgba(30,41,59,0.9)',
                  background: 'linear-gradient(180deg, rgba(15,23,42,0.95), rgba(17,24,39,0.82))',
                  boxShadow: '0 18px 40px rgba(2,6,23,0.28)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.9rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem' }}>
                  <div>
                    <p style={{ margin: 0, color: '#f8fafc', fontSize: '1.05rem', fontWeight: 700 }}>{problem.title}</p>
                    <p style={{ margin: '0.35rem 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                      {problem.topicTitle} • {problem.moduleTitle}
                    </p>
                  </div>
                  <span style={{ ...badgeStyle(problem.state), padding: '0.45rem 0.7rem', borderRadius: 999, height: 'fit-content', fontSize: '0.78rem', fontWeight: 700, textTransform: 'capitalize' }}>
                    {problem.state}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ padding: '0.35rem 0.65rem', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', fontSize: '0.8rem' }}>
                    {problem.difficulty}
                  </span>
                  <span style={{ padding: '0.35rem 0.65rem', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', fontSize: '0.8rem' }}>
                    {problem.courseLevel}
                  </span>
                  <span style={{ padding: '0.35rem 0.65rem', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', fontSize: '0.8rem' }}>
                    {problem.timeLimit}s
                  </span>
                </div>

                <div style={{ minHeight: 48, color: problem.state === 'locked' ? '#fca5a5' : '#94a3b8', fontSize: '0.9rem' }}>
                  {problem.state === 'locked'
                    ? problem.lockReason
                    : problem.solved
                      ? 'Accepted already. Reopen to improve or review your solution.'
                      : 'Ready to solve. Run sample tests before submitting.'}
                </div>

                <button
                  onClick={() => problem.state !== 'locked' && navigate(`/coding/${problem._id}`)}
                  disabled={problem.state === 'locked'}
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: '0.9rem 1rem',
                    borderRadius: 14,
                    border: 'none',
                    background: problem.state === 'locked'
                      ? 'rgba(71,85,105,0.75)'
                      : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: problem.state === 'locked' ? 'not-allowed' : 'pointer',
                    opacity: problem.state === 'locked' ? 0.6 : 1,
                  }}
                >
                  {problem.state === 'locked' ? 'Locked' : problem.solved ? 'Open Solved Problem' : 'Solve Problem'}
                </button>
              </article>
            ))}
          </div>

          {filteredProblems.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 10,
                  border: '1px solid rgba(99,102,241,0.3)',
                  background: currentPage === 1 ? 'rgba(15,23,42,0.5)' : 'rgba(99,102,241,0.15)',
                  color: currentPage === 1 ? '#64748b' : '#e2e8f0',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                }}
              >
                Previous
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: 10,
                    border: currentPage === page ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(148,163,184,0.2)',
                    background: currentPage === page ? 'rgba(99,102,241,0.25)' : 'rgba(15,23,42,0.5)',
                    color: currentPage === page ? '#a5b4fc' : '#94a3b8',
                    cursor: 'pointer',
                    fontWeight: currentPage === page ? 700 : 600,
                    fontSize: '0.9rem',
                  }}
                >
                  {page}
                </button>
              ))}

              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 10,
                  border: '1px solid rgba(99,102,241,0.3)',
                  background: currentPage === totalPages ? 'rgba(15,23,42,0.5)' : 'rgba(99,102,241,0.15)',
                  color: currentPage === totalPages ? '#64748b' : '#e2e8f0',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                }}
              >
                Next
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </StudentLayout>
  );
}
