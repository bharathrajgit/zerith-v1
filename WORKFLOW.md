# Zerith Workflow

## Services and local startup

| Service | Folder | Port | Start |
| --- | --- | --- | --- |
| MongoDB | – | 27017 | local install or `docker run -p 27017:27017 mongo` |
| ML service (Flask) | `ml-service` | 8000 | `python app.py` |
| API (Express) | `server` | 5000 | `npm run seed:fresh` (first time), `npm run db:check`, `npm run dev` |
| Client (React/Vite) | `client` | 5173 | `npm run dev` (proxies `/api` to 5000) |

Code judge: `server/services/codeJudge.js` compiles and runs Java locally, so `javac` and `java` must be on the API host's PATH.

## Student flow

1. `/register` or `/login` → `POST /api/auth/register|login` → JWT saved as `dsa_token`.
2. On load, the session is restored with `GET /api/auth/me`. `ProtectedRoute` sends users who haven't done the diagnostic to `/diagnostic`.
3. Diagnostic (`/diagnostic`):
   - Monitoring starts: `GET /api/monitoring/readiness` → camera permission → `POST /api/monitoring/sessions/start`.
   - Questions: `POST /api/diagnostic/start|question|answer`, then the coding phase via `/api/diagnostic/coding/*`, then `POST /api/diagnostic/complete`.
   - The ML service classifies the student's level and readiness, and a roadmap is generated.
4. Learning: `/modules` and `/topic/:id` (modules, topics, videos) → `/assessment/:topicId/:round` (MCQs, monitored) → `/coding/:problemId` (Java run/submit, monitored).
5. Tracking: `/roadmap`, `/progress`, `/profile` (streaks, readiness).

## Monitoring flow (diagnostic, assessment, coding)

`usePracticeMonitoring` runs this flow:

1. Webcam preview.
2. In the browser, `localCameraMonitoring.js` (native FaceDetector or face-api.js) checks for:
   - a missing face
   - multiple faces
   
   Phone detection runs on the server.
3. Browser events are recorded: tab switches, copy attempts, focus loss.
4. Frames go to `POST /api/monitoring/sessions/:id/analyze-frame`. The API forwards them to ML `/ml/malpractices/analyze-frame`. That endpoint uses `MalpracticesPipeline` (`ml-service/malpractices/malpractices_pipeline.py`): OpenCV Haar cascades for faces (frontal + profile) and a rough head pose, plus Ultralytics YOLO for phones. YOLO weights come from `MALPRACTICES_YOLO_MODEL`, else `trained_models/malpractices_yolo.pt`, else `yolov8n.pt` (COCO `cell phone`, downloaded on first use). If YOLO can't load, `/health` reports `supportsPhoneDetection: false`. If the pipeline can't load at all, the endpoint returns no findings with `fallback: true` and the browser's local findings are reported instead.
5. Violations are reported with `POST /api/malpractice/report-violation`, which creates a `MalpracticeLog` with evidence. When the warning limit is reached, the student is locked (`GET /api/malpractice/check-lock`).
6. The session ends with `POST /api/monitoring/sessions/:id/finish`.

## Institution flow

1. `/institution/register|login` → `/api/institution/auth/*`. Registering generates an institution code that students enter when they sign up.
2. Students: `/api/institution/students` (add one, bulk add, list, remove, reset password).
3. Departments: `/api/institution/departments` (CRUD, `move-student`).
4. Analytics: `/api/institution/analytics/*`:
   - overview, departments, at-risk, placement prediction, dropout risk
   - student report
   - malpractice logs, evidence, and status review
5. Locks: `/api/institution/malpractice/*` (logs, stats, locked students, unlock).
