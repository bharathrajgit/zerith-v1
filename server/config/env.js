const path = require('path');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (dotenvResult.error) {
  // It's okay if .env is not present in production; use environment variables from the host.
  if (process.env.NODE_ENV === 'development') {
    console.warn('⚠️ server/.env not found; falling back to process.env values.');
  }
}

const getEnv = (key, fallback = undefined, required = false) => {
  const value = process.env[key];
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    return String(value).trim();
  }
  if (required && process.env.NODE_ENV === 'development') {
    console.warn(`⚠️ Missing required environment variable: ${key}. Using fallback: ${fallback}`);
  }
  return fallback;
};

const stripTrailingSlash = (value) =>
  typeof value === 'string' ? value.replace(/\/+$|\?$/, '') : value;

const isExplicitTrue = (value) => String(value || '').trim().toLowerCase() === 'true';

const NODE_ENV = getEnv('NODE_ENV', 'development');
const preferLocalDevServices = (
  NODE_ENV === 'development'
  && isExplicitTrue(getEnv('PREFER_LOCAL_DEV_SERVICES', ''))
);

const localMongoUri = getEnv('MONGO_URI_LOCAL', 'mongodb://localhost:27017/dsa-platform');
const configuredMongoUri = getEnv('MONGO_URI', 'mongodb://localhost:27017/dsa-platform');
const localMlServiceUrl = stripTrailingSlash(getEnv('ML_SERVICE_URL_LOCAL', 'http://localhost:8000'));
const configuredMlServiceUrl = stripTrailingSlash(getEnv('ML_SERVICE_URL', 'http://localhost:8000'));

module.exports = {
  PORT: Number(getEnv('PORT', 5000)),
  NODE_ENV,
  PREFER_LOCAL_DEV_SERVICES: preferLocalDevServices,
  MONGO_URI: preferLocalDevServices ? localMongoUri : configuredMongoUri,
  ML_SERVICE_URL: preferLocalDevServices ? localMlServiceUrl : configuredMlServiceUrl,
};
