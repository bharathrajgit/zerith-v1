import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Zap, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import styles from './Auth.module.css';

export default function StudentLogin() {
  const navigate                    = useNavigate();
  const { loginStudent, isAuthenticated } = useAuth();
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [errors,     setErrors]     = useState({});

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const authError = sessionStorage.getItem('lastAuthError');
    if (!authError) return;

    try {
      const errorDetails = JSON.parse(authError);
      toast.error(
        errorDetails.message || 'Your session expired. Please sign in again.',
        { duration: 5000 }
      );
    } catch {
      toast.error('Your session expired. Please sign in again.', { duration: 5000 });
    } finally {
      sessionStorage.removeItem('lastAuthError');
    }
  }, []);

  /* ── Validation ───────────────────────────────── */
  const validate = () => {
    const e = {};
    if (!email.trim())
      e.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(email))
      e.email = 'Enter a valid email address';
    if (!password)
      e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ── Submit ───────────────────────────────────── */
  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await loginStudent(email, password);
      if (!res.success) {
        toast.error(res.message || 'Login failed');
        return;
      }
      navigate('/dashboard');
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  /* ── Render ───────────────────────────────────── */
  return (
    <div className={styles.pageWrapper}>
      {/* Student-specific background */}
      <div className={styles.studentBg}>
        <div className={styles.studentOrb1} />
        <div className={styles.studentOrb2} />
        <div className={styles.studentOrb3} />
      </div>
      <div className={styles.studentParticles}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className={styles.studentParticle} />
        ))}
      </div>

      <div className={`${styles.card} ${styles.cardStudent}`}>
        {/* Logo with Student theme */}
        <Link to="/" className={`${styles.logo} ${styles.logoStudent}`}>
          <span className={`${styles.logoIcon} ${styles.logoIconStudent}`}>
            <Zap size={18} />
          </span>
          Zerith
        </Link>

        <h1 className={`${styles.title} ${styles.titleStudent}`}>Welcome back</h1>
        <p className={styles.subtitle}>
          Sign in to continue your DSA journey
        </p>

        <form onSubmit={handleSubmit}
              className={styles.form}
              noValidate>

          {/* Email */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Email address
            </label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <Mail size={16} />
              </span>
              <input
                type="email"
                className={`${styles.input} ${styles.inputStudent} ${
                  errors.email ? styles.inputError : ''
                }`}
                placeholder="you@example.com"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  if (errors.email)
                    setErrors(p => ({...p, email: ''}));
                }}
                autoComplete="email"
              />
            </div>
            {errors.email && (
              <p className={styles.errorMsg}>
                {errors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Password
            </label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <Lock size={16} />
              </span>
              <input
                type={showPass ? 'text' : 'password'}
                className={`${styles.input} ${styles.inputStudent} ${
                  errors.password ? styles.inputError : ''
                }`}
                placeholder="••••••••"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  if (errors.password)
                    setErrors(p => ({...p, password:''}));
                }}
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPass(p => !p)}
                tabIndex={-1}
                aria-label="Toggle password"
              >
                {showPass
                  ? <EyeOff size={16} />
                  : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <p className={styles.errorMsg}>
                {errors.password}
              </p>
            )}
          </div>

          {/* Institution hint */}
          <p className={styles.hint}>
            First time login? Check your email for
            temporary credentials from your institution.
          </p>

          {/* Submit Button with Student theme */}
          <button
            type="submit"
            disabled={loading}
            className={`${styles.submitBtn} ${styles.submitBtnStudent}`}
          >
            {loading
              ? <span className={`${styles.spinner} ${styles.spinnerStudent}`} />
              : 'Sign In'}
          </button>
        </form>

        {/* Back to Home link */}
        <div className={styles.backToHome}>
          <Link to="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>

        {/* Links with Student theme */}
        <div className={styles.links}>
          <p>
            Don't have an account?{' '}
            <Link to="/register" className={styles.linkStudent}>
              Register here
            </Link>
          </p>
          <div className={styles.separator}>
            <span>or</span>
          </div>
          <p>
            Institution admin?{' '}
            <Link
              to="/institution/login"
              className={styles.linkStudent}
            >
              Login here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
