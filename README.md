# Zerith

BehaviourLearn is an AI-assisted DSA learning platform with adaptive diagnostics, coding practice, and malpractice monitoring.

## Local Development Boot Order

The local stack is designed to run against local services first.

1. Start local MongoDB on `mongodb://localhost:27017`.
2. Seed the backend database:

   ```powershell
   cd server
   npm run seed:fresh
   ```

3. Validate the diagnostic question bank:

   ```powershell
   cd server
   npm run db:check
   ```

4. Start the ML service:

   ```powershell
   cd ml-service
   python app.py
   ```

5. Start the Node API:

   ```powershell
   cd server
   npm run dev
   ```

6. Start the Vite client:

   ```powershell
   cd client
   npm run dev
   ```

## Local-First Environment Defaults

- The frontend prefers `http://localhost:5000` whenever it is running on `localhost`, even if `VITE_API_URL` points to a remote deployment.
- The backend prefers `MONGO_URI_LOCAL` and `ML_SERVICE_URL_LOCAL` in development when `PREFER_LOCAL_DEV_SERVICES=true`.
- Example environment files live in:
  - `client/.env.example`
  - `server/.env.example`
  - `ml-service/.env.example`

## Proctor Model Training

The ONNX proctor model pipeline lives in `ml-training/`.

- Use `PROCTOR_KAGGLE_DATASETS` for multiple Kaggle sources.
- `PROCTOR_KAGGLE_DATASET` still works as a one-dataset fallback.
- `ml-training/class_map.proctor.json` is the repo-tracked mapping used by `prepare_dataset.py`.
- The runtime fallback remains heuristic camera monitoring when `ml-service/trained_models/proctor_monitor.onnx` is absent.
