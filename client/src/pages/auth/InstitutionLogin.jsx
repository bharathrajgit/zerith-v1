import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Building2, Zap, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import styles from './Auth.module.css';

export default function InstitutionLogin() {
  const navigate                      = useNavigate();
  const { loginInstitution, isAuthenticated } = useAuth();
  const [email,    setEmail]          = useState('');
  const [password, setPassword]       = useState('');
  const [showPass, setShowPass]       = useState(false);
  const [loading,  setLoading]        = useState(false);
  const [errors,   setErrors]         = useState({});

  useEffect(() => {
    console.log('[InstitutionLogin] useEffect triggered, isAuthenticated:', isAuthenticated);
    if (isAuthenticated) {
      console.log('[InstitutionLogin] Navigating to dashboard');
      // Use replace to prevent going back to login page
      navigate('/institution/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Check for previous 401 errors from sessionStorage
  useEffect(() => {
    const authError = sessionStorage.getItem('lastAuthError');
    if (authError) {
      try {
        const errorDetails = JSON.parse(authError);
        const errorMsg = `Authentication failed on ${errorDetails.url}: ${errorDetails.message || 'Unknown error'}`;
        console.error('🔴 Previous Auth Error:', errorDetails);
        toast.error(errorMsg, { duration: 5000 });
        sessionStorage.removeItem('lastAuthError'); // Clear it after showing
      } catch (e) {
        console.error('Failed to parse auth error:', e);
      }
    }
  }, []);

  const validate = () => {
    const e = {};
    if (!email.trim())
      e.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(email))
      e.email = 'Enter a valid email';
    if (!password)
      e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    console.log('[InstitutionLogin] handleSubmit called');
    if (!validate()) return;
    setLoading(true);
    try {
      console.log('[InstitutionLogin] Attempting login with email:', email);
      const res = await loginInstitution(email, password);
      console.log('[InstitutionLogin] Login response:', res);
      if (!res.success) {
        console.log('[InstitutionLogin] Login failed, showing error:', res.message);
        toast.error(res.message || 'Login failed. Please check your credentials.');
        return;
      }
      console.log('[InstitutionLogin] Login successful - useEffect will handle navigation');
      // Don't manually navigate - let the useEffect handle it when isAuthenticated becomes true
    } catch (error) {
      console.error('[InstitutionLogin] Login error:', error);
      toast.error(error?.response?.data?.message || error?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.pageWrapper}>
      {/* Institution-specific background */}
      <div className={styles.institutionBg}>
        <div className={styles.institutionOrb1} />
        <div className={styles.institutionOrb2} />
        <div className={styles.institutionOrb3} />
      </div>
      <div className={styles.institutionRings}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className={styles.institutionRing} />
        ))}
      </div>

      <div className={`${styles.card} ${styles.cardInstitution}`}>
        {/* Logo with Institution theme */}
        <Link to="/" className={`${styles.logo} ${styles.logoInstitution}`}>
          <span className={`${styles.logoIcon} ${styles.logoIconInstitution}`}>
            <Zap size={18} />
          </span>
          Zerith
        </Link>

        {/* Institution badge with Institution theme */}
        <div className={`${styles.badge} ${styles.badgeInstitution}`}>
          <Building2 size={16} />
          Institution Portal
        </div>

        <h1 className={`${styles.title} ${styles.titleInstitution}`}>
          Institution Login
        </h1>
        <p className={styles.subtitle}>
          Access your admin dashboard
        </p>

        <div className={styles.form}>

          {/* Email */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Official Email
            </label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <Mail size={16} />
              </span>
              <input
                type="email"
                className={`${styles.input} ${styles.inputInstitution} ${
                  errors.email ? styles.inputError : ''
                }`}
                placeholder="admin@institution.edu"
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
                className={`${styles.input} ${styles.inputInstitution} ${
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

          {/* Submit Button with Institution theme */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className={`${styles.submitBtn} ${styles.submitBtnInstitution}`}
          >
            {loading
              ? <span className={`${styles.spinner} ${styles.spinnerInstitution}`} />
              : 'Login to Dashboard'}
          </button>
        </div>

        {/* Back to Home link */}
        <div className={styles.backToHome}>
          <Link to="/" className={styles.backLink}>
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>

        {/* Links with Institution theme */}
        <div className={styles.links}>
          <p>
            New institution?{' '}
            <Link
              to="/institution/register"
              className={styles.linkInstitution}
            >
              Register here
            </Link>
          </p>
          <div className={styles.separator}>
            <span>or</span>
          </div>
          <p>
            Student?{' '}
            <Link to="/login" className={styles.linkInstitution}>
              Login here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}