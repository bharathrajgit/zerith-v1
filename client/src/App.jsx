import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/common/ProtectedRoute";

// ─── Suspense fallback ────────────────────────────────────────────────────────
const PageLoader = () => (
  <div style={{
    minHeight: "100vh",
    background: "#0a0a0f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  }}>
    <div style={{
      width: 40,
      height: 40,
      borderRadius: "50%",
      border: "3px solid #1e1e35",
      borderTopColor: "#6366f1",
      animation: "spin 0.8s linear infinite",
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ─── Public pages (lazy) ─────────────────────────────────────────────────────
const LandingPage            = lazy(() => import("./pages/LandingPage.jsx"));
const StudentLogin           = lazy(() => import("./pages/auth/StudentLogin"));
const StudentRegister        = lazy(() => import("./pages/auth/StudentRegister"));
const ResetPasswordPage      = lazy(() => import("./pages/auth/ResetPassword"));
const InstitutionLogin       = lazy(() => import("./pages/auth/InstitutionLogin"));
const InstitutionRegister    = lazy(() => import("./pages/auth/InstitutionRegister"));
const NotFoundPage           = lazy(() => import("./pages/NotFoundPage"));

// ─── Student pages (lazy) ────────────────────────────────────────────────────
const DiagnosticPage         = lazy(() => import("./pages/student/DiagnosticPage"));
const StudentDashboard       = lazy(() => import("./pages/student/StudentDashboard"));
const ModuleListPage         = lazy(() => import("./pages/student/ModuleListPage"));
const CoursePage             = lazy(() => import("./pages/student/CoursePage"));
const ModuleDetailPage       = lazy(() => import("./pages/student/ModuleDetailPage"));
const TopicLearningPage      = lazy(() => import("./pages/student/TopicLearningPage"));
const AssessmentPage         = lazy(() => import("./pages/student/AssessmentPage"));
const CodingPage             = lazy(() => import("./pages/student/CodingPage"));
const CodingHubPage          = lazy(() => import("./pages/student/CodingHubPage"));
const RoadmapPage            = lazy(() => import("./pages/student/RoadmapPage"));
const RoadmapDayPage         = lazy(() => import("./pages/student/RoadmapDayPage"));
const ProgressPage           = lazy(() => import("./pages/student/ProgressPage"));
const ProfilePage            = lazy(() => import("./pages/student/ProfilePage"));

// ─── Institution pages (lazy) ────────────────────────────────────────────────
const InstitutionDashboard   = lazy(() => import("./pages/institution/InstitutionDashboard"));
const StudentsPage           = lazy(() => import("./pages/institution/StudentsPage"));
const DepartmentsPage        = lazy(() => import("./pages/institution/DepartmentsPage"));
const AnalyticsPage          = lazy(() => import("./pages/institution/AnalyticsPage"));
const MalpracticePage        = lazy(() => import("./pages/institution/MalpracticePage"));
const ReportsPage            = lazy(() => import("./pages/institution/ReportsPage"));

// ─── App ─────────────────────────────────────────────────────────────────────
const App = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>

      {/* ── Public ─────────────────────────────────────────────────────── */}
      <Route path="/"                     element={<LandingPage />} />
      <Route path="/login"                element={<StudentLogin />} />
      <Route path="/register"             element={<StudentRegister />} />
      <Route path="/reset-password"       element={
        <ProtectedRoute requiredType="student"><ResetPasswordPage /></ProtectedRoute>
      } />
      <Route path="/institution/login"    element={<InstitutionLogin />} />
      <Route path="/institution/register" element={<InstitutionRegister />} />

      {/* ── Student ────────────────────────────────────────────────────── */}
      <Route path="/diagnostic" element={
        <ProtectedRoute requiredType="student"><DiagnosticPage /></ProtectedRoute>
      }/>
      <Route path="/dashboard" element={
        <ProtectedRoute requiredType="student"><StudentDashboard /></ProtectedRoute>
      }/>
      <Route path="/dashboard/coach" element={
        <ProtectedRoute requiredType="student"><StudentDashboard /></ProtectedRoute>
      }/>
      <Route path="/modules" element={
        <ProtectedRoute requiredType="student"><ModuleListPage /></ProtectedRoute>
      }/>
      <Route path="/courses" element={
        <ProtectedRoute requiredType="student"><CoursePage /></ProtectedRoute>
      }/>
      <Route path="/modules/:moduleId" element={
        <ProtectedRoute requiredType="student"><ModuleDetailPage /></ProtectedRoute>
      }/>
      <Route path="/topic/:topicId" element={
        <ProtectedRoute requiredType="student">
          <TopicLearningPage />
        </ProtectedRoute>
      }/>
      <Route path="/assessment/:topicId/:round" element={
        <ProtectedRoute requiredType="student">
          <AssessmentPage />
        </ProtectedRoute>
      }/>
      <Route path="/coding" element={
        <ProtectedRoute requiredType="student"><CodingHubPage /></ProtectedRoute>
      }/>
      <Route path="/coding/:problemId" element={
        <ProtectedRoute requiredType="student"><CodingPage /></ProtectedRoute>
      }/>
      <Route path="/roadmap" element={
        <ProtectedRoute requiredType="student"><RoadmapPage /></ProtectedRoute>
      }/>
      <Route path="/roadmap/day/:dayNumber" element={
        <ProtectedRoute requiredType="student"><RoadmapDayPage /></ProtectedRoute>
      }/>
      <Route path="/progress" element={
        <ProtectedRoute requiredType="student"><ProgressPage /></ProtectedRoute>
      }/>
      <Route path="/profile" element={
        <ProtectedRoute requiredType="student"><ProfilePage /></ProtectedRoute>
      }/>

      {/* ── Institution ────────────────────────────────────────────────── */}
      <Route path="/institution/dashboard" element={
        <ProtectedRoute requiredType="institution"><InstitutionDashboard /></ProtectedRoute>
      }/>
      <Route path="/institution/students" element={
        <ProtectedRoute requiredType="institution"><StudentsPage /></ProtectedRoute>
      }/>
      <Route path="/institution/departments" element={
        <ProtectedRoute requiredType="institution"><DepartmentsPage /></ProtectedRoute>
      }/>
      <Route path="/institution/analytics" element={
        <ProtectedRoute requiredType="institution"><AnalyticsPage /></ProtectedRoute>
      }/>
      <Route path="/institution/malpractice" element={
        <ProtectedRoute requiredType="institution"><MalpracticePage /></ProtectedRoute>
      }/>
      <Route path="/institution/reports" element={
        <ProtectedRoute requiredType="institution"><ReportsPage /></ProtectedRoute>
      }/>

      {/* ── 404 ────────────────────────────────────────────────────────── */}
      <Route path="*" element={<NotFoundPage />} />

    </Routes>
  </Suspense>
);

export default App;
