import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, Phone,
  Building2, MapPin, Globe, CheckCircle, Check, Copy, ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import styles from './Auth.module.css';

const VALUE_POINTS = [
  { title: 'Department analytics', text: 'Track readiness, activity, and at-risk students by department.' },
  { title: 'Controlled onboarding', text: 'Create institution students with temporary passwords and managed access.' },
  { title: 'Live reporting', text: 'Export reports from real institution data without manual spreadsheets.' },
];

export default function InstitutionRegister() {
  const navigate = useNavigate();
  const { registerInstitution, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    address: '',
    website: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/institution/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const setField = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    if (errors[key]) {
      setErrors((current) => ({ ...current, [key]: '' }));
    }
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Institution name is required';
    if (!form.email.trim()) nextErrors.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email';
    if (!form.password) nextErrors.password = 'Password is required';
    else if (form.password.length < 8) nextErrors.password = 'Minimum 8 characters';
    if (!form.confirmPassword) nextErrors.confirmPassword = 'Please confirm the password';
    else if (form.password !== form.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match';
    if (!form.phone.trim()) nextErrors.phone = 'Phone number is required';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await registerInstitution({
        name: form.name,
        email: form.email,
        password: form.password,
        confirmPassword: form.confirmPassword,
        phone: form.phone,
        address: form.address || undefined,
        website: form.website || undefined,
      });
      if (result.success) {
        setSuccessData({ code: result.institutionCode });
      } else {
        toast.error(result.message || 'Registration failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (!successData?.code) return;
    await navigator.clipboard.writeText(successData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (successData) {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.institutionBg}>
          <div className={styles.institutionOrb1} />
          <div className={styles.institutionOrb2} />
          <div className={styles.institutionOrb3} />
        </div>
        <div className={styles.institutionRings}>
          {[...Array(4)].map((_, index) => <div key={index} className={styles.institutionRing} />)}
        </div>

        <div className={`${styles.card} ${styles.cardInstitution} ${styles.successCard}`}>
          <div className={`${styles.successIcon} ${styles.successIconInstitution}`}>
            <CheckCircle size={56} />
          </div>
          <h2 className={styles.successTitle}>Institution Registered</h2>
          <p className={styles.successSubtitle}>
            Your admin workspace is ready. Share this institution code with students who should join your portal.
          </p>

          <div className={styles.codeSection}>
            <p className={styles.codeLabel}>Institution Code</p>
            <div className={`${styles.codeBox} ${styles.codeBoxInstitution}`}>
              <span className={`${styles.codeText} ${styles.codeTextInstitution}`}>{successData.code}</span>
              <button
                className={`${styles.copyBtn} ${styles.copyBtnInstitution} ${copied ? styles.copyBtnSuccess : ''}`}
                onClick={copyCode}
                aria-label="Copy code"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className={styles.codeHint}>
              Students who register with this code will be linked to your institution automatically.
            </p>
          </div>

          <button
            className={`${styles.submitBtn} ${styles.submitBtnInstitution}`}
            onClick={() => navigate('/institution/dashboard')}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.institutionBg}>
        <div className={styles.institutionOrb1} />
        <div className={styles.institutionOrb2} />
        <div className={styles.institutionOrb3} />
      </div>
      <div className={styles.institutionRings}>
        {[...Array(4)].map((_, index) => <div key={index} className={styles.institutionRing} />)}
      </div>

      <div className={styles.registerShell}>
        <aside className={styles.registerShowcase}>
          <div className={`${styles.badge} ${styles.badgeInstitution}`}>
            <Building2 size={16} />
            Institution Portal
          </div>
          <h1 className={`${styles.title} ${styles.titleInstitution}`}>Launch a branded institution workspace</h1>
          <p className={styles.subtitle}>
            Create your institution account, invite students, and track readiness with live department reporting.
          </p>

          <div className={styles.registerValueGrid}>
            {VALUE_POINTS.map((point) => (
              <div key={point.title} className={styles.registerValueCard}>
                <h3>{point.title}</h3>
                <p>{point.text}</p>
              </div>
            ))}
          </div>
        </aside>

        <div className={`${styles.card} ${styles.cardInstitution} ${styles.registerFormCard}`}>
          <Link to="/" className={`${styles.logo} ${styles.logoInstitution}`}>
            <span className={`${styles.logoIcon} ${styles.logoIconInstitution}`}>
              <Building2 size={18} />
            </span>
            Zerith
          </Link>

          <h2 className={`${styles.title} ${styles.titleInstitution}`}>Register Your Institution</h2>
          <p className={styles.subtitle}>Keep the same institution theme as login, with a stronger onboarding flow.</p>

          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Institution Name</label>
              <div className={styles.inputWrap}>
                <span className={styles.inputIcon}><Building2 size={16} /></span>
                <input className={`${styles.input} ${styles.inputInstitution} ${errors.name ? styles.inputError : ''}`} value={form.name} onChange={setField('name')} placeholder="e.g. Rathinam Technical Campus" />
              </div>
              {errors.name && <p className={styles.errorMsg}>{errors.name}</p>}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Official Email</label>
              <div className={styles.inputWrap}>
                <span className={styles.inputIcon}><Mail size={16} /></span>
                <input className={`${styles.input} ${styles.inputInstitution} ${errors.email ? styles.inputError : ''}`} value={form.email} onChange={setField('email')} placeholder="admin@institution.edu" autoComplete="email" />
              </div>
              {errors.email && <p className={styles.errorMsg}>{errors.email}</p>}
            </div>

            <div className={styles.twoCol}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Password</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}><Lock size={16} /></span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.inputInstitution} ${errors.password ? styles.inputError : ''}`}
                    value={form.password}
                    onChange={setField('password')}
                    placeholder="Minimum 8 characters"
                  />
                  <button type="button" className={styles.eyeBtn} onClick={() => setShowPassword((current) => !current)}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className={styles.errorMsg}>{errors.password}</p>}
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Confirm Password</label>
                <div className={styles.inputWrap}>
                  <span className={styles.inputIcon}><Lock size={16} /></span>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    className={`${styles.input} ${styles.inputInstitution} ${errors.confirmPassword ? styles.inputError : ''}`}
                    value={form.confirmPassword}
                    onChange={setField('confirmPassword')}
                    placeholder="Repeat password"
                  />
                  <button type="button" className={styles.eyeBtn} onClick={() => setShowConfirmPassword((current) => !current)}>
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirmPassword && <p className={styles.errorMsg}>{errors.confirmPassword}</p>}
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Phone Number</label>
              <div className={styles.inputWrap}>
                <span className={styles.inputIcon}><Phone size={16} /></span>
                <input className={`${styles.input} ${styles.inputInstitution} ${errors.phone ? styles.inputError : ''}`} value={form.phone} onChange={setField('phone')} placeholder="+91 98765 43210" />
              </div>
              {errors.phone && <p className={styles.errorMsg}>{errors.phone}</p>}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Address <span className={styles.optional}>(optional)</span></label>
              <div className={styles.inputWrap}>
                <span className={`${styles.inputIcon} ${styles.iconTop}`}><MapPin size={16} /></span>
                <textarea className={`${styles.input} ${styles.textarea}`} rows={3} value={form.address} onChange={setField('address')} placeholder="Institution address" />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Website <span className={styles.optional}>(optional)</span></label>
              <div className={styles.inputWrap}>
                <span className={styles.inputIcon}><Globe size={16} /></span>
                <input className={`${styles.input} ${styles.inputInstitution}`} value={form.website} onChange={setField('website')} placeholder="https://institution.edu" />
              </div>
            </div>

            <button type="submit" className={`${styles.submitBtn} ${styles.submitBtnInstitution}`} disabled={loading}>
              {loading ? <span className={`${styles.spinner} ${styles.spinnerInstitution}`} /> : 'Register Institution'}
            </button>
          </form>

          {/* Back to Home link */}
          <div className={styles.backToHome}>
            <Link to="/" className={styles.backLink}>
              <ArrowLeft size={16} />
              Back to Home
            </Link>
          </div>

          <div className={styles.links}>
            <p>
              Already registered? <Link to="/institution/login" className={styles.linkInstitution}>Login here</Link>
            </p>
            <p>
              Student account? <Link to="/login" className={styles.linkInstitution}>Go to student login</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
