// client/src/components/layout/StudentLayout.jsx
import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, BookOpen, Map, TrendingUp, Code2, User, LogOut, 
  Menu, Sparkles, PlayCircle, X
} from 'lucide-react';
import styles from './StudentLayout.module.css';
import websiteLogo from '../../assets/websiteLogo.jpeg';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', badge: null },
  { to: '/modules', icon: BookOpen, label: 'Modules', badge: null },
  { to: '/courses', icon: PlayCircle, label: 'Video Course', badge: null },
  { to: '/roadmap', icon: Map, label: 'Roadmap', badge: 'New' },
  { to: '/progress', icon: TrendingUp, label: 'Progress', badge: null },
  { to: '/coding', icon: Code2, label: 'Coding', badge: null },
  { to: '/profile', icon: User, label: 'Profile', badge: null },
];

function getColorFromUsername(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#14b8a6'];
  return colors[Math.abs(hash) % colors.length];
}

export default function StudentLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const displayName = user?.name?.trim() || user?.username?.split('@')[0] || 'Student';
  const avatarColor = getColorFromUsername(user?.username || displayName || 'U');
  const initial = (displayName || 'U').charAt(0).toUpperCase();

  const resolvedLevel = (() => {
    const rawLevel = String(user?.currentLevel || user?.level || '').trim();
    if (!rawLevel) return 'Beginner';
    const normalized = rawLevel.toLowerCase();
    if (normalized === 'placement-ready' || normalized === 'placement ready' || normalized === 'advanced' || normalized === 'advance') return 'Placement-Ready';
    if (normalized === 'intermediate') return 'Intermediate';
    return 'Beginner';
  })();

  // Close mobile sidebar on route change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [location.pathname]);

  // Track scroll for mobile top bar shadow
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;

  return (
    <div className={styles.layout}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className={styles.overlay} onClick={() => setMobileOpen(false)} />
      )}

      {/* Enhanced Sidebar */}
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''} ${!isMobile ? styles.sidebarStatic : ''}`}>
        {/* Logo with glow effect */}
        <div className={styles.logoWrapper}>
          <img
            src={websiteLogo}
            alt="Zerith logo"
            className={styles.logoImage}
          />
          <span className={styles.logoText}>Zerith</span>
          {/* Close button for mobile */}
          <button 
            className={styles.closeButton}
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* User info with animated avatar */}
        <div className={styles.userSection}>
          <div className={styles.avatar} style={{ backgroundColor: avatarColor }}>
            {initial}
          </div>
          <div className={styles.userInfo}>
            <p className={styles.username}>{displayName}</p>
            <span className={`${styles.levelBadge} ${
              resolvedLevel === 'Placement-Ready' ? styles.levelGreen :
              resolvedLevel === 'Intermediate' ? styles.levelAmber :
              styles.levelRed
            }`}>
              {resolvedLevel}
            </span>
          </div>
        </div>

        {/* Navigation with staggered animation */}
        <nav className={styles.nav}>
          {navItems.map((item, index) => {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/dashboard'}
                className={linkClass}
                style={{ animationDelay: `${0.1 + index * 0.05}s` }}
              >
                <item.icon className={styles.navIcon} size={20} />
                <span>{item.label}</span>
                {item.badge && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: '0.65rem',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    color: 'white',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}>
                    <Sparkles size={10} />
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Logout button with hover effect */}
        <div className={styles.logoutWrapper}>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            <LogOut className={styles.navIcon} size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className={styles.main}>
        {/* Mobile top bar */}
        <div className={styles.mobileTopBar} style={{
          boxShadow: isScrolled ? '0 4px 20px rgba(0,0,0,0.3)' : 'none',
        }}>
          <button 
            onClick={() => setMobileOpen(true)} 
            className={styles.hamburger}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <img
            src={websiteLogo}
            alt="Zerith logo"
            className={styles.mobileLogoImage}
          />
          <div style={{ width: 24 }} />
        </div>

        {/* Page content */}
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
