// server/controllers/institution.auth.controller.js
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Institution = require('../models/Institution');

// Private helper – do NOT export
const generateInstitutionToken = (institutionId, userId = null) => {
  const payload = { id: institutionId, type: 'institution' };
  if (userId) payload.userId = userId;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @desc    Register a new institution
// @route   POST /api/institution/auth/register
// @access  Public
const registerInstitution = async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword, phone, address, website } = req.body;

    // 1. Validate required fields
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, password, and confirmPassword',
      });
    }

    // 2. Check passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    // 3. Check if email already registered
    const existing = await Institution.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'An institution with this email already exists',
      });
    }

    // 4. Generate unique institutionCode
    let code = '';
    let isUnique = false;
    const namePart = name.replace(/\s/g, '').substring(0, 4).toUpperCase();

    while (!isUnique) {
      const randomNum = Math.floor(1000 + Math.random() * 9000); // 4-digit
      code = `${namePart}${randomNum}`;
      const codeExists = await Institution.findOne({ institutionCode: code });
      if (!codeExists) isUnique = true;
    }

    // 5. Create institution with embedded default department
    const institution = await Institution.create({
      name,
      email,
      password,       // will be hashed by pre‑save hook
      institutionCode: code,
      phone: phone || '',
      address: address || '',
      website: website || '',
      departments: [
        {
          name: 'General',
          code: 'GEN',
          notes: '',
          targetPlacementDate: null,
        },
      ],
    });

    // 6. Generate token
    const token = generateInstitutionToken(institution._id);

    // Remove password from response
    const institutionData = institution.toObject();
    delete institutionData.password;
    delete institutionData.__v;

    res.status(201).json({
      success: true,
      token,
      data: { institution: institutionData },
      message: 'Institution registered successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login institution
// @route   POST /api/institution/auth/login
// @access  Public
const loginInstitution = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Find institution and include password
    let institution = await Institution.findOne({ email }).select('+password');

    if (!institution) {
      const usersColl = mongoose.connection.collection('users');
      const rawUser = await usersColl.findOne({ email, role: 'coordinator' });
      if (rawUser && rawUser.tenantId) {
        institution = await Institution.findById(rawUser.tenantId);
        if (institution && institution.isActive) {
          const isMatch = await require('bcryptjs').compare(password, rawUser.password);
          if (isMatch) {
            const token = generateInstitutionToken(institution._id);
            const institutionData = institution.toObject();
            delete institutionData.password;
            delete institutionData.__v;
            return res.status(200).json({ success: true, token, data: { institution: institutionData }, message: 'Login successful' });
          }
        }
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if active
    if (!institution.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This institution account is deactivated. Contact support.',
      });
    }

    const token = generateInstitutionToken(institution._id);

    const institutionData = institution.toObject();
    delete institutionData.password;
    delete institutionData.__v;

    res.status(200).json({
      success: true,
      token,
      data: { institution: institutionData },
      message: 'Login successful',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get institution profile (protected)
// @route   GET /api/institution/auth/profile
// @access  Private (Institution)
const getInstitutionProfile = async (req, res, next) => {
  try {
    // req.institution already contains full document from middleware
    const institution = req.institution.toObject();

    // Optionally, you can fetch additional data (like student counts) here
    // For now, just return the institution data

    res.status(200).json({
      success: true,
      data: { institution },
      message: 'Profile fetched successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerInstitution,
  loginInstitution,
  getInstitutionProfile,
};
