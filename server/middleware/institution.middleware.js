const jwt = require('jsonwebtoken');
const Institution = require('../models/Institution');

const debugLog = (...args) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};

const protectInstitution = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      debugLog('🔴 [protectInstitution] No token provided for', req.method, req.path);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    debugLog('✅ [protectInstitution] Token decoded:', decoded.id, 'type:', decoded.type);

    if (decoded.type !== 'institution') {
      debugLog('🔴 [protectInstitution] Invalid token type:', decoded.type, 'for', req.path);
      return res.status(401).json({
        success: false,
        message: 'Invalid token type',
      });
    }

    const institution = await Institution.findById(decoded.id);
    if (!institution) {
      debugLog('🔴 [protectInstitution] Institution not found for ID:', decoded.id);
      return res.status(401).json({
        success: false,
        message: 'Institution not found',
      });
    }

    debugLog('✅ [protectInstitution] Institution found:', institution._id, 'isActive:', institution.isActive);
    
    if (!institution.isActive) {
      debugLog('🔴 [protectInstitution] Institution is not active:', institution._id);
      return res.status(401).json({
        success: false,
        message: 'Institution account deactivated',
      });
    }

    req.institution = institution;
    next();
  } catch (error) {
    console.error('🔴 [protectInstitution] Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token verification failed',
      error: error.message,
    });
  }
};

module.exports = { protectInstitution };