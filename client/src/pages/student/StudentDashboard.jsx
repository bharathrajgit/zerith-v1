// client/src/pages/student/DashboardPage.jsx
// ─── REDESIGNED: Mission Control Dark Theme ───────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentLayout from '../../components/layout/StudentLayout';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { getChatResponse } from '../../services/geminiService';
import {
  Flame, TrendingUp, BookOpen, Brain, Code2, PlayCircle,
  Send, X, Bot, ChevronRight, Check, Calendar,
  Clock, Award, Activity, Target, Zap, Lock,
  Sparkles, BarChart2, ChevronUp, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — Mission Control Dark
   Palette: Deep navy bg · Sky-cyan primary · Amber achievement · Emerald success
             Rose warning · Slate muted
═══════════════════════════════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700&display=swap');

  /* ── Reset & base ─────────────────────────────────────────── */
  .mc { all: initial; display: block; }
  .mc *, .mc *::before, .mc *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page Shell ───────────────────────────────────────────── */
  .mc-page {
    padding: 2rem 2.5rem 4rem;
    min-height: 100vh;
    background: #080c14;
    font-family: 'Manrope', sans-serif;
    color: #e2e8f0;
    position: relative;
    overflow-x: hidden;
  }
  .mc-page::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse 60% 40% at 15% 10%, rgba(14,165,233,0.06) 0%, transparent 60%),
      radial-gradient(ellipse 50% 35% at 85% 80%, rgba(16,185,129,0.05) 0%, transparent 60%);
    pointer-events: none;
    z-index: 0;
  }
  .mc-page > * { position: relative; z-index: 1; }

  /* ── Typography ────────────────────────────────────────────── */
  .mc-display { font-family: 'Outfit', sans-serif; font-weight: 800; letter-spacing: -0.03em; }
  .mc-head    { font-family: 'Outfit', sans-serif; font-weight: 700; letter-spacing: -0.02em; }
  .mc-label   { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; }

  /* ── Header ───────────────────────────────────────────────── */
  .mc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 2rem;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .mc-greeting {
    font-size: clamp(1.6rem, 3vw, 2.4rem);
    color: #f1f5f9;
    line-height: 1.1;
    margin-bottom: 0.3rem;
  }
  .mc-greeting span { color: #0ea5e9; }
  .mc-subhead { font-size: 0.9rem; color: #475569; }
  .mc-date-pill {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.8rem; color: #64748b;
    background: #0f1623;
    border: 1px solid #1e2d42;
    border-radius: 100px;
    padding: 0.45rem 1rem;
    white-space: nowrap;
  }

  /* ── Stats Grid ───────────────────────────────────────────── */
  .mc-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .mc-stat {
    background: #0d1420;
    border: 1px solid #1a2540;
    border-radius: 20px;
    padding: 1.4rem 1.2rem;
    transition: border-color 0.25s, transform 0.25s;
    cursor: default;
  }
  .mc-stat:hover { border-color: rgba(14,165,233,0.25); transform: translateY(-3px); }
  .mc-stat-top {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1rem;
  }
  .mc-stat-icon {
    width: 40px; height: 40px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .mc-stat-badge {
    font-size: 0.68rem; font-weight: 700;
    padding: 0.2rem 0.6rem; border-radius: 100px;
  }
  .mc-stat-value {
    font-family: 'Outfit', sans-serif; font-size: 2.2rem; font-weight: 800;
    letter-spacing: -0.04em; line-height: 1; margin-bottom: 0.2rem;
  }
  .mc-stat-name { font-size: 0.78rem; color: #64748b; font-weight: 600; margin-bottom: 0.6rem; }
  .mc-stat-note { font-size: 0.72rem; color: #334155; }
  .mc-bar {
    height: 5px; background: #1a2540; border-radius: 100px; overflow: hidden;
  }
  .mc-bar-fill {
    height: 100%; border-radius: 100px; transition: width 1s cubic-bezier(.4,0,.2,1);
  }

  /* Ring stat */
  .mc-ring-wrap { position: relative; width: 72px; height: 72px; margin: 0 auto 0.75rem; }
  .mc-ring-svg { width: 72px; height: 72px; transform: rotate(-90deg); }
  .mc-ring-text {
    position: absolute; inset: 0; display: flex;
    align-items: center; justify-content: center;
    font-family: 'Outfit', sans-serif; font-size: 1.1rem; font-weight: 800; color: #f1f5f9;
  }
  .mc-stat-center { text-align: center; }

  /* ── HERO: Today's Tasks ──────────────────────────────────── */
  .mc-hero {
    background: #0d1420;
    border: 1px solid #1a2540;
    border-radius: 24px;
    padding: 2rem;
    margin-bottom: 1.5rem;
    position: relative;
    overflow: hidden;
  }
  .mc-hero::before {
    content: '';
    position: absolute;
    top: -40px; right: -40px;
    width: 220px; height: 220px;
    background: radial-gradient(circle, rgba(14,165,233,0.08) 0%, transparent 70%);
    border-radius: 50%;
    pointer-events: none;
  }
  .mc-hero-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;
  }
  .mc-hero-title {
    display: flex; align-items: center; gap: 0.6rem;
    font-size: 1.25rem; color: #f1f5f9;
  }
  .mc-hero-progress {
    display: flex; align-items: center; gap: 0.6rem;
    font-size: 0.8rem; color: #475569;
  }
  .mc-hero-progress-track {
    width: 140px; height: 6px;
    background: #1a2540; border-radius: 100px; overflow: hidden;
  }
  .mc-hero-progress-fill {
    height: 100%; border-radius: 100px;
    background: linear-gradient(90deg, #0ea5e9, #38bdf8);
    transition: width 0.8s ease;
  }
  .mc-hero-progress-pct { font-weight: 700; color: #0ea5e9; }

  /* Task items */
  .mc-task {
    display: flex; align-items: center; gap: 1rem;
    padding: 1rem 1.1rem;
    background: #080c14;
    border-radius: 16px;
    margin-bottom: 0.6rem;
    border: 1px solid transparent;
    transition: border-color 0.2s, background 0.2s;
  }
  .mc-task:hover { background: #0a0f1a; border-color: #1a2540; }
  .mc-task.done { opacity: 0.55; }
  .mc-task-num {
    width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid #1e2d42;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; font-weight: 700; color: #334155; flex-shrink: 0;
  }
  .mc-task-num.done-num {
    background: rgba(16,185,129,0.15); border-color: #10b981; color: #10b981;
  }
  .mc-task-icon-wrap {
    width: 42px; height: 42px; border-radius: 13px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .mc-task-body { flex: 1; min-width: 0; }
  .mc-task-name {
    font-weight: 600; color: #cbd5e1; font-size: 0.92rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mc-task-meta { font-size: 0.72rem; color: #334155; margin-top: 0.2rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .mc-btn-start {
    background: #0ea5e9; border: none; color: #fff;
    padding: 0.45rem 1rem; border-radius: 10px;
    font-size: 0.82rem; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; gap: 0.3rem;
    transition: background 0.2s, transform 0.2s;
    white-space: nowrap; flex-shrink: 0;
  }
  .mc-btn-start:hover { background: #0284c7; transform: scale(1.04); }
  .mc-task-done-badge {
    display: flex; align-items: center; gap: 0.3rem;
    color: #10b981; font-size: 0.82rem; font-weight: 700;
    flex-shrink: 0;
  }
  .mc-task-locked { color: #334155; font-size: 0.82rem; font-weight: 600; flex-shrink: 0; display: flex; align-items: center; gap: 0.3rem; }

  /* ── Two-column grid ─────────────────────────────────────── */
  .mc-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  /* ── Card (reusable) ─────────────────────────────────────── */
  .mc-card {
    background: #0d1420;
    border: 1px solid #1a2540;
    border-radius: 24px;
    padding: 1.6rem;
    transition: border-color 0.25s;
  }
  .mc-card:hover { border-color: rgba(14,165,233,0.18); }
  .mc-card-title {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 1rem; color: #f1f5f9; margin-bottom: 1.2rem;
  }
  .mc-card-title-icon {
    width: 32px; height: 32px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
  }

  /* ── Focus Areas ─────────────────────────────────────────── */
  .mc-focus-item {
    display: flex; align-items: center; gap: 0.9rem;
    padding: 0.85rem 1rem;
    background: #080c14; border-radius: 14px;
    margin-bottom: 0.6rem;
    border-left: 3px solid transparent;
    transition: border-color 0.2s;
  }
  .mc-focus-item:hover { border-left-color: #f59e0b; }
  .mc-focus-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .mc-focus-body { flex: 1; min-width: 0; }
  .mc-focus-name { font-weight: 600; color: #cbd5e1; font-size: 0.88rem; }
  .mc-focus-rec { font-size: 0.72rem; color: #475569; margin-top: 0.18rem; }
  .mc-focus-btn {
    background: transparent; border: 1px solid #1e2d42;
    color: #64748b; padding: 0.32rem 0.8rem;
    border-radius: 100px; font-size: 0.75rem; font-weight: 700;
    cursor: pointer; transition: all 0.2s; flex-shrink: 0;
  }
  .mc-focus-btn:hover { border-color: #f59e0b; color: #f59e0b; }

  /* ── Weekly Activity ─────────────────────────────────────── */
  .mc-activity-full { margin-bottom: 1.5rem; }
  .mc-activity-top {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 1rem; margin-bottom: 1.2rem;
  }
  .mc-act-stat {
    background: #080c14; border-radius: 16px;
    padding: 1rem 1.1rem; border: 1px solid #1a2540;
    display: flex; align-items: center; gap: 0.8rem;
    transition: border-color 0.2s;
  }
  .mc-act-stat:hover { border-color: rgba(14,165,233,0.2); }
  .mc-act-icon {
    width: 38px; height: 38px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .mc-act-val { font-family: 'Outfit', sans-serif; font-size: 1.5rem; font-weight: 800; line-height: 1; }
  .mc-act-lbl { font-size: 0.72rem; color: #475569; font-weight: 600; margin-top: 0.15rem; }
  .mc-chart-wrap { height: 220px; }
  .mc-heatmap {
    display: flex; gap: 0.6rem; align-items: center;
    margin-top: 1rem; flex-wrap: wrap;
  }
  .mc-heat-day {
    display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
  }
  .mc-heat-bar {
    width: 28px; border-radius: 6px 6px 0 0;
    transition: all 0.3s; cursor: default;
    min-height: 4px;
  }
  .mc-heat-bar:hover { filter: brightness(1.3); }
  .mc-heat-label { font-size: 0.65rem; color: #334155; font-weight: 700; }

  /* ── Module Progress ─────────────────────────────────────── */
  .mc-modules-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 1rem;
  }
  .mc-mod-card {
    background: #080c14; border-radius: 20px;
    padding: 1.2rem 1rem; border: 1px solid #1a2540;
    cursor: pointer; transition: border-color 0.25s, transform 0.25s;
    display: flex; flex-direction: column; align-items: center; text-align: center;
  }
  .mc-mod-card:hover { border-color: rgba(14,165,233,0.3); transform: translateY(-4px); }
  .mc-mod-ring { position: relative; width: 74px; height: 74px; margin: 0 auto 0.8rem; }
  .mc-mod-ring-svg { width: 74px; height: 74px; transform: rotate(-90deg); }
  .mc-mod-ring-val {
    position: absolute; inset: 0; display: flex;
    align-items: center; justify-content: center;
    font-family: 'Outfit', sans-serif; font-size: 1rem; font-weight: 800;
  }
  .mc-mod-emoji { font-size: 1.1rem; margin-bottom: 0.3rem; display: block; }
  .mc-mod-name { font-size: 0.82rem; font-weight: 700; color: #cbd5e1; margin-bottom: 0.25rem; }
  .mc-mod-topics { font-size: 0.7rem; color: #334155; }

  /* ── AI Chat ─────────────────────────────────────────────── */
  .mc-fab {
    position: fixed; bottom: 2rem; right: 2rem;
    width: 56px; height: 56px; border-radius: 50%;
    background: #0ea5e9; border: none; color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; z-index: 200;
    box-shadow: 0 0 0 0 rgba(14,165,233,0.5);
    animation: mc-pulse 2.5s infinite;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .mc-fab:hover { transform: scale(1.1); }
  @keyframes mc-pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(14,165,233,0.5); }
    50%      { box-shadow: 0 0 0 14px rgba(14,165,233,0); }
  }
  .mc-chat {
    position: fixed; bottom: 5rem; right: 2rem;
    width: 380px; max-height: 560px;
    background: #0d1420; border: 1px solid #1e2d42;
    border-radius: 22px; display: flex; flex-direction: column;
    overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.7);
    z-index: 201; animation: mc-rise 0.25s ease;
  }
  @keyframes mc-rise { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .mc-chat-hd {
    background: #0ea5e9; padding: 1rem 1.2rem;
    display: flex; justify-content: space-between; align-items: center;
  }
  .mc-chat-hd-title { font-family: 'Outfit', sans-serif; font-weight: 700; color: #fff; font-size: 1rem; }
  .mc-chat-hd-sub { color: rgba(255,255,255,0.7); font-size: 0.72rem; margin-top: 0.15rem; }
  .mc-chat-close { background: none; border: none; color: #fff; cursor: pointer; }
  .mc-chat-msgs {
    flex: 1; overflow-y: auto; padding: 1rem;
    display: flex; flex-direction: column; gap: 0.6rem;
  }
  .mc-chat-sys {
    background: rgba(14,165,233,0.08); border: 1px solid rgba(14,165,233,0.15);
    padding: 0.7rem 0.9rem; border-radius: 12px;
    font-size: 0.84rem; color: #94a3b8;
  }
  .mc-bubble {
    max-width: 85%; padding: 0.7rem 0.9rem;
    border-radius: 16px; font-size: 0.87rem; line-height: 1.5;
  }
  .mc-bubble-user { align-self: flex-end; background: #0ea5e9; color: #fff; border-bottom-right-radius: 4px; }
  .mc-bubble-ai { align-self: flex-start; background: #141e2e; color: #cbd5e1; border-bottom-left-radius: 4px; }
  .mc-typing { display: flex; gap: 0.3rem; padding: 0.5rem 0.9rem; }
  .mc-dot { width: 7px; height: 7px; border-radius: 50%; background: #0ea5e9; animation: mc-bop 1.3s infinite ease-in-out both; }
  .mc-dot:nth-child(1){ animation-delay: -0.3s; }
  .mc-dot:nth-child(2){ animation-delay: -0.15s; }
  @keyframes mc-bop { 0%,80%,100%{ transform: scale(0); } 40%{ transform: scale(1); } }
  .mc-chat-foot { display: flex; border-top: 1px solid #1a2540; padding: 0.7rem; gap: 0.5rem; }
  .mc-chat-inp {
    flex: 1; background: #080c14; border: 1px solid #1a2540;
    border-radius: 100px; padding: 0.6rem 1rem; color: #e2e8f0;
    font-size: 0.87rem; outline: none; font-family: 'Manrope', sans-serif;
    transition: border-color 0.2s;
  }
  .mc-chat-inp:focus { border-color: #0ea5e9; }
  .mc-chat-send {
    width: 40px; height: 40px; border-radius: 50%;
    background: #0ea5e9; border: none; color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background 0.2s; flex-shrink: 0;
  }
  .mc-chat-send:hover { background: #0284c7; }
  .mc-chat-send:disabled { background: #1a2540; cursor: not-allowed; }

  /* ── Skeleton ────────────────────────────────────────────── */
  .mc-skeleton {
    background: linear-gradient(90deg, #0d1420 25%, #141e2e 50%, #0d1420 75%);
    background-size: 200% 100%;
    animation: mc-shimmer 1.6s infinite;
    border-radius: 16px;
  }
  @keyframes mc-shimmer { 0%{ background-position: -200% 0; } 100%{ background-position: 200% 0; } }
  .mc-empty { text-align: center; padding: 2rem; color: #334155; font-size: 0.88rem; }

  /* ── Section divider label ───────────────────────────────── */
  .mc-section-lbl {
    display: flex; align-items: center; gap: 0.6rem;
    margin-bottom: 0.9rem;
  }
  .mc-section-lbl span { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #334155; }
  .mc-section-lbl::after { content: ''; flex: 1; height: 1px; background: #1a2540; }

  /* ── Responsive ──────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .mc-stats { grid-template-columns: repeat(2, 1fr); }
    .mc-activity-top { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    .mc-page { padding: 1rem 1rem 4rem; }
    .mc-stats { grid-template-columns: 1fr 1fr; }
    .mc-two-col { grid-template-columns: 1fr; }
    .mc-modules-grid { grid-template-columns: repeat(2, 1fr); }
    .mc-activity-top { grid-template-columns: repeat(2, 1fr); }
    .mc-chat { width: 92vw; right: 4vw; }
    .mc-fab { bottom: 1.2rem; right: 1.2rem; }
  }
  @media (max-width: 420px) {
    .mc-stats { grid-template-columns: 1fr; }
  }
`;

/* ═══════════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════════ */
const MODULE_EMOJI = {
  Arrays:'📊', Strings:'🔤', Searching:'🔍', Sorting:'↕️', Recursion:'🔄',
  'Linked Lists':'🔗', 'Stack and Queue':'📚', Trees:'🌳',
  'Heaps and Hashing':'⛏️', Graphs:'🕸️', 'Dynamic Programming':'💡',
};

const getGreeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
};

const buildWeakAreaPayload = (p) => ({
  round1_acc: (p?.round1Score || 0) / 100,
  round2_acc: (p?.round1Score || 0) / 100,
  round3_acc: (p?.codingScore || 0) > 0 ? (p.codingScore || 0) / 100 : (p?.round1Score || 0) / 100,
  attempt_count: p?.totalAttempts || 0,
  hint_rate: p?.totalAttempts ? (p.hintsUsed || 0) / p.totalAttempts : 0,
});

/* ── Tiny helpers ── */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function RingChart({ pct, size = 72, stroke = 8, color = '#0ea5e9', bg = '#1a2540', label }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (circ * clamp(pct, 0, 100)) / 100;
  return (
    <div className="mc-mod-ring" style={{ width: size, height: size }}>
      <svg className="mc-mod-ring-svg" style={{ width: size, height: size }} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div className="mc-mod-ring-val" style={{ color }}>{label ?? `${Math.round(pct)}%`}</div>
    </div>
  );
}

function StatRing({ done, total }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const r = 30; const circ = 2 * Math.PI * r;
  const offset = circ - (circ * pct) / 100;
  return (
    <div className="mc-ring-wrap">
      <svg className="mc-ring-svg" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1a2540" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="#0ea5e9" strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="mc-ring-text">{done}/{total}</div>
    </div>
  );
}

const SkelBox = ({ h = 120, r = 20 }) => (
  <div className="mc-skeleton" style={{ height: h, borderRadius: r }} />
);

/* ── Motivational copy for readiness ── */
const readinessLabel = (s) =>
  s >= 80 ? { text: 'Placement Ready 🚀', color: '#10b981' }
  : s >= 60 ? { text: 'Interview Practicing', color: '#0ea5e9' }
  : s >= 40 ? { text: 'Building Foundation', color: '#f59e0b' }
  : { text: 'Just Getting Started', color: '#f43f5e' };

const readinessBadgeLabel = (s) =>
  s >= 80 ? 'Placement Ready'
  : s >= 60 ? 'Interview Practicing'
  : s >= 40 ? 'Foundation Building'
  : 'Beginner';

const streakMsg = (n) =>
  n === 0 ? 'Start today!' : n < 3 ? 'Keep going!' : n < 7 ? 'On a roll 🔥' : 'Unstoppable! 🏆';

/* ── Task type icon & color ── */
const taskMeta = (type) => {
  if (type === 'video') return { icon: <PlayCircle size={18} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  if (type?.includes('mcq') || type?.includes('quiz')) return { icon: <Brain size={18} />, color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' };
  if (type?.includes('coding')) return { icon: <Code2 size={18} />, color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
  return { icon: <BookOpen size={18} />, color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' };
};

/* ── Custom chart tooltip ── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0d1420', border: '1px solid #1e2d42', borderRadius: 12,
      padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: '#94a3b8',
    }}>
      <p style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name === 'tasks' ? `${p.value} tasks` : `${p.value} min`}
        </p>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════════ */
export default function StudentDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [roadmap, setRoadmap] = useState(null);
  const [progress, setProgress] = useState(null);
  const [streak, setStreak] = useState(null);
  const [weakAreas, setWeakAreas] = useState(null);
  const [loadingMain, setLoadingMain] = useState(true);
  const [loadingWeak, setLoadingWeak] = useState(false);
  const [activityData, setActivityData] = useState([]);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const chatEndRef = useRef(null);

  // Inject CSS once
  useEffect(() => {
    const id = 'mc-dash-styles';
    if (!document.getElementById(id)) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = CSS;
      document.head.appendChild(el);
    }
    return () => document.getElementById(id)?.remove();
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Main data fetch
  useEffect(() => {
    const load = async () => {
      try {
        const [r, p, s] = await Promise.allSettled([
          api.get('/roadmap'), api.get('/progress'), api.get('/streak'),
        ]);
        if (r.status === 'fulfilled' && r.value.data.success) {
          const { roadmap: rd, currentWeek, currentDay, todayTasks = [], recapModules = [] } = r.value.data.data;
          setRoadmap({ ...(rd || {}), currentWeek, currentDay, todayTasks, recapModules });
        }
        if (p.status === 'fulfilled' && p.value.data.success) setProgress(p.value.data.data);
        if (s.status === 'fulfilled' && s.value.data.success) setStreak(s.value.data.data);
      } catch { toast.error('Unable to load dashboard data'); }
      finally { setLoadingMain(false); }
    };
    load();
  }, [user?.currentLevel]);

  // Weak areas
  useEffect(() => {
    if (!progress?.moduleProgress) return;
    const topics = [];
    progress.moduleProgress.forEach(mod =>
      mod.topics.forEach(t => {
        if (t.progress) topics.push({ topic_name: t.topic.title, ...buildWeakAreaPayload(t.progress) });
      })
    );
    if (!topics.length) return;
    setLoadingWeak(true);
    api.post('/ml/detect-weak-areas', { topics })
      .then(({ data }) => { if (data.success) setWeakAreas(data.data); })
      .catch(() => {})
      .finally(() => setLoadingWeak(false));
  }, [progress]);

  // Activity log → chart data
  useEffect(() => {
    if (!Array.isArray(streak?.activityLog)) return;
    const map = new Map();
    streak.activityLog.forEach(e => {
      const k = new Date(e.date).toISOString().split('T')[0];
      const cur = map.get(k) || { tasks: 0, minutes: 0 };
      map.set(k, { tasks: cur.tasks + (e.tasksCompleted || 0), minutes: cur.minutes + (e.minutesSpent || 0) });
    });
    setActivityData(Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const k = d.toISOString().split('T')[0];
      const e = map.get(k) || { tasks: 0, minutes: 0 };
      return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), ...e };
    }));
  }, [streak]);

  // Derived
  const todayTasks     = roadmap?.todayTasks || [];
  const completedToday = todayTasks.filter(t => t.isCompleted).length;
  const todayPct       = todayTasks.length ? Math.round((completedToday / todayTasks.length) * 100) : 0;

  const currentWeekObj = roadmap?.weeks?.find(w => w.weekNumber === roadmap.currentWeek);
  const currentDayObj  = currentWeekObj?.days?.find(d => d.dayNumber === roadmap.currentDay);
  const dayUnlocked    = currentDayObj?.unlockedAt != null;

  const modulesMastered  = progress?.overview?.completedTopics
    ?? progress?.moduleProgress?.reduce((a, m) => a + m.completedTopics, 0) ?? 0;
  const totalTopicsAll   = progress?.overview?.totalTopics
    ?? progress?.moduleProgress?.reduce((a, m) => a + (m.totalTopics || 0), 0) ?? 0;
  const topicPct         = totalTopicsAll > 0 ? Math.round((modulesMastered / totalTopicsAll) * 100) : 0;

  const totalWeeklyTasks   = activityData.reduce((s, d) => s + d.tasks, 0);
  const totalWeeklyMinutes = activityData.reduce((s, d) => s + d.minutes, 0);
  const activeDays         = activityData.filter(d => d.tasks > 0 || d.minutes > 0).length;
  const avgMinutes         = Math.round(totalWeeklyMinutes / 7);
  const maxTasks           = Math.max(...activityData.map(d => d.tasks), 1);

  const readinessScore = progress?.placementReadiness ?? user?.placementReadiness ?? 0;
  const rl             = readinessLabel(readinessScore);
  const readinessBadge = readinessBadgeLabel(readinessScore);
  const displayName    = user?.name || user?.username || user?.email?.split('@')[0] || 'Student';
  const streakCount    = streak?.currentStreak || 0;

  const openTask = async (task) => {
    if (!task?.referenceId || !task?.isUnlocked) return;
    if (['video', 'video-analysis', 'revision'].includes(task.type)) { navigate(`/topic/${task.referenceId}`); return; }
    if (task.type?.includes('mcq')) { navigate(`/assessment/${task.referenceId}/Basic`); return; }
    if (task.type === 'coding') {
      try {
        const res = await api.get(`/coding/by-topic/${task.referenceId}`);
        const id = res.data?.data?.problem?._id;
        if (id) navigate(`/coding/${id}`);
      } catch { toast.error('Coding problem not available right now.'); }
    }
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const msgs = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(msgs); setChatInput(''); setChatLoading(true);
    const ctx = { topic: roadmap?.currentWeek ? currentWeekObj?.topic : 'General', currentLevel: user?.currentLevel || 'Beginner' };
    try {
      const reply = await getChatResponse(msg, ctx);
      setChatMessages([...msgs, { role: 'assistant', content: reply || "I'm having trouble connecting." }]);
    } catch {
      setChatMessages([...msgs, { role: 'assistant', content: "I'm having trouble connecting." }]);
    } finally { setChatLoading(false); }
  };

  /* ── Module ring color by mastery ── */
  const modColor = (pct) =>
    pct >= 80 ? '#10b981' : pct >= 60 ? '#0ea5e9' : pct >= 40 ? '#f59e0b' : pct > 0 ? '#f43f5e' : '#334155';

  /* ── Loading skeleton ── */
  if (loadingMain) return (
    <StudentLayout>
      <div className="mc-page">
        <div className="mc-stats" style={{ marginBottom: '1.5rem' }}>
          {[0,1,2,3].map(i => <SkelBox key={i} h={140} />)}
        </div>
        <SkelBox h={260} r={24} />
        <div style={{ marginTop: '1.5rem' }}><SkelBox h={200} r={24} /></div>
        <div className="mc-two-col" style={{ marginTop: '1.5rem' }}>
          <SkelBox h={220} r={24} /><SkelBox h={220} r={24} />
        </div>
      </div>
    </StudentLayout>
  );

  return (
    <StudentLayout>
      <div className="mc-page">

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <header className="mc-header">
          <div>
            <h1 className="mc-display mc-greeting">
              {getGreeting()}, <span>{displayName}</span> 👋
            </h1>
            {roadmap && (
              <p className="mc-subhead">
                Day {roadmap.currentDay} of {roadmap.totalDays} &nbsp;·&nbsp; {roadmap.planType || '90-day'} Plan
              </p>
            )}
          </div>
          <div className="mc-date-pill">
            <Calendar size={14} />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </header>

        {/* ── STATS ROW ──────────────────────────────────────────────── */}
        <div className="mc-stats">

          {/* Streak */}
          <div className="mc-stat">
            <div className="mc-stat-top">
              <div className="mc-stat-icon" style={{ background: 'rgba(245,158,11,0.12)' }}>
                <Flame size={20} color="#f59e0b" />
              </div>
              <span className="mc-stat-badge" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                {streakMsg(streakCount)}
              </span>
            </div>
            <div className="mc-stat-value" style={{ color: '#f59e0b' }}>{streakCount}</div>
            <div className="mc-stat-name">Day Streak</div>
            <div className="mc-stat-note">Best ever: {streak?.longestStreak || 0} days</div>
          </div>

          {/* Readiness */}
          <div className="mc-stat">
            <div className="mc-stat-top">
              <div className="mc-stat-icon" style={{ background: `${rl.color}18` }}>
                <TrendingUp size={20} color={rl.color} />
              </div>
              <span className="mc-stat-badge" style={{ background: `${rl.color}15`, color: rl.color }}>
                {readinessBadge}
              </span>
            </div>
            <div className="mc-stat-value" style={{ color: rl.color }}>{readinessScore}<span style={{ fontSize: '1rem', fontWeight: 600, color: '#334155' }}>%</span></div>
            <div className="mc-stat-name">Placement Readiness</div>
            <div className="mc-bar" style={{ marginTop: '0.6rem' }}>
              <div className="mc-bar-fill" style={{ width: `${readinessScore}%`, background: rl.color }} />
            </div>
            <div className="mc-stat-note" style={{ marginTop: '0.4rem', color: rl.color }}>{rl.text}</div>
          </div>

          {/* Topics */}
          <div className="mc-stat">
            <div className="mc-stat-top">
              <div className="mc-stat-icon" style={{ background: 'rgba(16,185,129,0.12)' }}>
                <BookOpen size={20} color="#10b981" />
              </div>
              <span className="mc-stat-badge" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                {topicPct}% done
              </span>
            </div>
            <div className="mc-stat-value" style={{ color: '#10b981' }}>
              {modulesMastered}<span style={{ fontSize: '1rem', fontWeight: 600, color: '#334155' }}>/{totalTopicsAll}</span>
            </div>
            <div className="mc-stat-name">Topics Mastered</div>
            <div className="mc-bar" style={{ marginTop: '0.6rem' }}>
              <div className="mc-bar-fill" style={{ width: `${topicPct}%`, background: '#10b981' }} />
            </div>
            <div className="mc-stat-note" style={{ marginTop: '0.4rem' }}>{totalTopicsAll - modulesMastered} remaining</div>
          </div>

          {/* Today ring */}
          <div className="mc-stat mc-stat-center">
            <StatRing done={completedToday} total={todayTasks.length} />
            <div className="mc-stat-name">Today's Tasks</div>
            <div className="mc-bar">
              <div className="mc-bar-fill" style={{ width: `${todayPct}%`, background: '#0ea5e9' }} />
            </div>
            <div className="mc-stat-note" style={{ marginTop: '0.4rem' }}>
              {completedToday === todayTasks.length && todayTasks.length > 0
                ? '✅ All done!' : `${todayTasks.length - completedToday} left today`}
            </div>
          </div>
        </div>

        {/* ── TODAY'S TASKS HERO ─────────────────────────────────────── */}
        {roadmap && (
          <>
            <div className="mc-section-lbl"><span>Today's Mission</span></div>
            <section className="mc-hero">
              <div className="mc-hero-header">
                <div className="mc-hero-title mc-head">
                  <Zap size={20} color="#0ea5e9" />
                  Day {roadmap.currentDay} — Your Tasks
                </div>
                <div className="mc-hero-progress">
                  <div className="mc-hero-progress-track">
                    <div className="mc-hero-progress-fill" style={{ width: `${todayPct}%` }} />
                  </div>
                  <span className="mc-hero-progress-pct">{todayPct}%</span>
                </div>
              </div>

              {todayTasks.length === 0 ? (
                <div className="mc-empty">🎉 Rest day — you've earned it. Recharge for tomorrow!</div>
              ) : (
                todayTasks.map((task, idx) => {
                  const { icon, color, bg } = taskMeta(task.type);
                  return (
                    <div key={idx} className={`mc-task${task.isCompleted ? ' done' : ''}`}>
                      <div className="mc-task-num" style={task.isCompleted ? { background: 'rgba(16,185,129,0.12)', borderColor: '#10b981', color: '#10b981' } : {}}>
                        {task.isCompleted ? <Check size={12} /> : idx + 1}
                      </div>
                      <div className="mc-task-icon-wrap" style={{ background: bg }}>
                        <span style={{ color }}>{icon}</span>
                      </div>
                      <div className="mc-task-body">
                        <p className="mc-task-name">{task.title}</p>
                        <p className="mc-task-meta">{task.type.replace(/-/g, ' ')}</p>
                      </div>
                      {task.isCompleted ? (
                        <span className="mc-task-done-badge"><Check size={15} /> Done</span>
                      ) : dayUnlocked && task.isUnlocked ? (
                        <button onClick={() => openTask(task)} className="mc-btn-start">
                          Start <ChevronRight size={14} />
                        </button>
                      ) : (
                        <span className="mc-task-locked"><Lock size={13} /> Locked</span>
                      )}
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}

        {/* ── WEEKLY ACTIVITY (full width) ───────────────────────────── */}
        <div className="mc-section-lbl"><span>Weekly Activity</span></div>
        <section className="mc-card mc-activity-full">
          <div className="mc-activity-top">
            <div className="mc-act-stat">
              <div className="mc-act-icon" style={{ background: 'rgba(14,165,233,0.12)' }}>
                <Activity size={18} color="#0ea5e9" />
              </div>
              <div>
                <div className="mc-act-val" style={{ color: '#0ea5e9' }}>{totalWeeklyTasks}</div>
                <div className="mc-act-lbl">Tasks This Week</div>
              </div>
            </div>
            <div className="mc-act-stat">
              <div className="mc-act-icon" style={{ background: 'rgba(16,185,129,0.12)' }}>
                <Target size={18} color="#10b981" />
              </div>
              <div>
                <div className="mc-act-val" style={{ color: '#10b981' }}>
                  {activeDays}<span style={{ fontSize: '0.9rem', color: '#334155' }}>/7</span>
                </div>
                <div className="mc-act-lbl">Active Days</div>
              </div>
            </div>
            <div className="mc-act-stat">
              <div className="mc-act-icon" style={{ background: 'rgba(245,158,11,0.12)' }}>
                <Clock size={18} color="#f59e0b" />
              </div>
              <div>
                <div className="mc-act-val" style={{ color: '#f59e0b' }}>{avgMinutes}<span style={{ fontSize: '0.9rem', color: '#334155' }}>m</span></div>
                <div className="mc-act-lbl">Avg Min / Day</div>
              </div>
            </div>
            <div className="mc-act-stat">
              <div className="mc-act-icon" style={{ background: 'rgba(167,139,250,0.12)' }}>
                <Award size={18} color="#a78bfa" />
              </div>
              <div>
                <div className="mc-act-val" style={{ color: '#a78bfa' }}>{streak?.longestStreak || 0}</div>
                <div className="mc-act-lbl">Best Streak</div>
              </div>
            </div>
          </div>

          {/* Area chart */}
          <div className="mc-chart-wrap">
            {activityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 11, fontFamily: 'Manrope' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="tasks" name="tasks" stroke="#0ea5e9" strokeWidth={2.5}
                    fill="url(#cyanGrad)" dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#0ea5e9', strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="minutes" name="minutes" stroke="#f59e0b" strokeWidth={1.5}
                    fill="url(#amberGrad)" strokeDasharray="4 3"
                    dot={false} activeDot={{ r: 5, fill: '#f59e0b', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="mc-empty">No activity data yet — complete some tasks to see your chart!</div>
            )}
          </div>

          {/* Day heatmap bars */}
          <div className="mc-heatmap">
            {activityData.map((d, i) => {
              const h = Math.round(clamp((d.tasks / maxTasks) * 56, 4, 60));
              const isToday = i === 6;
              return (
                <div key={i} className="mc-heat-day" title={`${d.day}: ${d.tasks} tasks, ${d.minutes} min`}>
                  <div className="mc-heat-bar" style={{
                    height: h,
                    background: d.tasks > 0
                      ? isToday ? '#0ea5e9' : `rgba(14,165,233,${0.3 + 0.7 * (d.tasks / maxTasks)})`
                      : '#1a2540',
                    outline: isToday ? '2px solid #0ea5e9' : 'none',
                    outlineOffset: 2,
                  }} />
                  <span className="mc-heat-label">{d.day[0]}</span>
                </div>
              );
            })}
            <span style={{ fontSize: '0.7rem', color: '#334155', marginLeft: '0.5rem' }}>
              — tasks/day
            </span>
          </div>
        </section>

        {/* ── TWO-COL: FOCUS AREAS + MODULE PROGRESS TEASER ─────────── */}
        <div className="mc-two-col">

          {/* Focus / Weak Areas */}
          <section className="mc-card">
            <div className="mc-card-title mc-head">
              <div className="mc-card-title-icon" style={{ background: 'rgba(244,63,94,0.12)' }}>
                <AlertTriangle size={16} color="#f43f5e" />
              </div>
              Focus Areas
            </div>
            {loadingWeak ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <SkelBox h={72} r={14} /><SkelBox h={72} r={14} /><SkelBox h={72} r={14} />
              </div>
            ) : weakAreas?.weak_topics?.length > 0 ? (
              weakAreas.weak_topics.slice(0, 4).map(wt => {
                const dotColor = wt.severity === 'high' ? '#f43f5e' : wt.severity === 'medium' ? '#f59e0b' : '#0ea5e9';
                return (
                  <div key={wt.topic_name} className="mc-focus-item">
                    <div className="mc-focus-dot" style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
                    <div className="mc-focus-body">
                      <p className="mc-focus-name">{wt.topic_name}</p>
                      <p className="mc-focus-rec">{(wt.recommendation || 'Practice this topic').slice(0, 72)}</p>
                    </div>
                    <button className="mc-focus-btn" onClick={() => {
                      const mod = progress?.moduleProgress?.find(m =>
                        m.topics?.some(t => t.topic.title === wt.topic_name));
                      if (mod) navigate(`/modules/${mod.module._id}`);
                    }}>Practice</button>
                  </div>
                );
              })
            ) : (
              <div className="mc-empty">🎯 No weak areas detected — great work!</div>
            )}
          </section>

          {/* Quick module summary (top 4 by mastery) */}
          <section className="mc-card">
            <div className="mc-card-title mc-head">
              <div className="mc-card-title-icon" style={{ background: 'rgba(14,165,233,0.12)' }}>
                <BarChart2 size={16} color="#0ea5e9" />
              </div>
              Module Snapshot
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(progress?.moduleProgress || []).slice(0, 5).map(mod => {
                const pct = mod.percentage || 0;
                const c = modColor(pct);
                return (
                  <div key={mod.module._id}
                    onClick={() => navigate(`/modules/${mod.module._id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.8rem',
                      padding: '0.65rem 0.9rem', background: '#080c14',
                      borderRadius: 13, cursor: 'pointer', border: '1px solid transparent',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#1a2540'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                  >
                    <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{MODULE_EMOJI[mod.module.title] || '📘'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.83rem', fontWeight: 600, color: '#cbd5e1', margin: 0,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mod.module.title}
                      </p>
                      <div style={{ marginTop: '0.3rem', height: 4, background: '#1a2540', borderRadius: 100, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 100, transition: 'width 0.8s ease' }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: '0.9rem', color: c, flexShrink: 0 }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ── MODULE PROGRESS (full grid) ────────────────────────────── */}
        <div className="mc-section-lbl"><span>All Modules</span></div>
        <section className="mc-card" style={{ marginBottom: '1.5rem' }}>
          <div className="mc-modules-grid">
            {(progress?.moduleProgress || []).map(mod => {
              const pct = mod.percentage || 0;
              const c = modColor(pct);
              return (
                <div key={mod.module._id} className="mc-mod-card" onClick={() => navigate(`/modules/${mod.module._id}`)}>
                  <RingChart pct={pct} color={c} size={74} stroke={7} />
                  <span className="mc-mod-emoji">{MODULE_EMOJI[mod.module.title] || '📘'}</span>
                  <p className="mc-mod-name">{mod.module.title}</p>
                  <p className="mc-mod-topics">{mod.completedTopics}/{mod.totalTopics} topics</p>
                </div>
              );
            })}
            {!progress?.moduleProgress?.length && (
              <div className="mc-empty" style={{ gridColumn: '1/-1' }}>
                No module data yet — start your first lesson!
              </div>
            )}
          </div>
        </section>

        {/* ── FLOATING AI CHAT ───────────────────────────────────────── */}
        <button className="mc-fab" onClick={() => setChatOpen(o => !o)} aria-label="Open AI assistant">
          {chatOpen ? <X size={24} /> : <Bot size={24} />}
        </button>

        {chatOpen && (
          <div className="mc-chat">
            <div className="mc-chat-hd">
              <div>
                <p className="mc-chat-hd-title">DSA Assistant</p>
                <p className="mc-chat-hd-sub">Ask me anything about Java DSA</p>
              </div>
              <button className="mc-chat-close" onClick={() => setChatOpen(false)}><X size={18} /></button>
            </div>
            <div className="mc-chat-msgs">
              <div className="mc-chat-sys">
                Hi {displayName}! Ask me about Java, algorithms, or your current topic.
              </div>
              {chatMessages.map((m, i) => (
                <div key={i} className={`mc-bubble ${m.role === 'user' ? 'mc-bubble-user' : 'mc-bubble-ai'}`}>
                  {m.content}
                </div>
              ))}
              {chatLoading && (
                <div className="mc-typing">
                  <span className="mc-dot" /><span className="mc-dot" /><span className="mc-dot" />
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="mc-chat-foot">
              <input className="mc-chat-inp" placeholder="Ask about Java DSA..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()} />
              <button className="mc-chat-send" onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}>
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

      </div>
    </StudentLayout>
  );
}
