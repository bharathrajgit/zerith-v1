const User = require('../models/User');
const Institution = require('../models/Institution');
const { generateStudentPassword, generateBulkCredentials } = require('../services/passwordGenerator');
const { normalizeReadinessLevel } = require('../services/userReadinessService');

const MAX_USERNAME_LENGTH = 30;

const buildUsernameBase = ({ name = '', email = '' }) => {
  const emailLocalPart = String(email).split('@')[0];
  const source = String(name || emailLocalPart || 'student');
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, MAX_USERNAME_LENGTH)
    .trim();

  return normalized.length >= 3 ? normalized : 'student';
};

const buildUsernameCandidate = (base, attempt) => {
  if (attempt === 0) return base;

  const suffix = String(attempt);
  const trimmedBase = base.slice(0, Math.max(3, MAX_USERNAME_LENGTH - suffix.length));
  return `${trimmedBase}${suffix}`;
};

const generateUniqueUsername = async (student, reservedUsernames = new Set()) => {
  const base = buildUsernameBase(student);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = buildUsernameCandidate(base, attempt);
    if (reservedUsernames.has(candidate)) continue;

    const existingUser = await User.exists({ username: candidate });
    if (!existingUser) {
      reservedUsernames.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Could not generate a unique username for ${student.email}`);
};

// @desc    Add a single student
// @route   POST /api/institution/students/add
// @access  Private (Institution)
const addSingleStudent = async (req, res, next) => {
  try {
    const { name, email, departmentCode } = req.body;
    const normalizedDepartmentCode = String(departmentCode || '').trim().toUpperCase();
    if (!name || !email || !normalizedDepartmentCode) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and departmentCode are required',
      });
    }

    // Email must be unique
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    // Find institution and the specific department (embedded)
    const institution = await Institution.findById(req.institution._id);
    const department = institution.departments.find(d => d.code === normalizedDepartmentCode);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found in your institution',
      });
    }

    const plainPassword = generateStudentPassword();
    const username = await generateUniqueUsername({ name, email });

    // Create student (password will be hashed by pre‑save hook)
    const user = await User.create({
      name,
      username,
      email,
      password: plainPassword,
      role: 'student',
      institutionId: institution._id,
      departmentCode: normalizedDepartmentCode,
      studentSource: 'institution_created',
      isFirstLogin: true,
      mustResetPassword: true,
      diagnosticCompleted: false,
    });

    // Add student to department's embedded students array
    department.students.push(user._id);
    await institution.save();

    res.status(201).json({
      success: true,
      data: {
        student: {
          _id: user._id,
          name: user.name,
          email: user.email,
          departmentCode: normalizedDepartmentCode,
        },
        temporaryPassword: plainPassword, // shown only once
      },
      message: 'Student created successfully. Save the temporary password – it will not be shown again.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Bulk add students (max 100)
// @route   POST /api/institution/students/bulk
// @access  Private (Institution)
const addBulkStudents = async (req, res, next) => {
  try {
    const { students } = req.body;
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'students array is required and must not be empty',
      });
    }
    if (students.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 100 students per batch',
      });
    }

    // 1. Validate every student has required fields
    for (const s of students) {
      if (!s.name || !s.email || !s.departmentCode) {
        return res.status(400).json({
          success: false,
          message: 'Each student must have name, email, and departmentCode',
        });
      }
    }

    // 2. Check duplicate emails inside the provided list
    const normalizedStudents = students.map((student) => ({
      ...student,
      departmentCode: String(student.departmentCode || '').trim().toUpperCase(),
    }));
    const emails = normalizedStudents.map(s => s.email);
    if (new Set(emails).size !== emails.length) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate emails found in the list',
      });
    }

    // 3. Check against existing users
    const existingUsers = await User.find({ email: { $in: emails } }).select('email');
    if (existingUsers.length > 0) {
      const existingEmails = existingUsers.map(u => u.email).join(', ');
      return res.status(400).json({
        success: false,
        message: `Some emails already exist: ${existingEmails}`,
      });
    }

    // 4. Verify all department codes exist in the institution
    const institution = await Institution.findById(req.institution._id);
    const departmentMap = {};
    institution.departments.forEach(d => { departmentMap[d.code] = d; });
    for (const s of normalizedStudents) {
      if (!departmentMap[s.departmentCode]) {
        return res.status(404).json({
          success: false,
          message: `Department ${s.departmentCode} not found`,
        });
      }
    }

    // 5. Generate credentials
    const credentials = generateBulkCredentials(normalizedStudents);
    const reservedUsernames = new Set();

    // 6. Create users one by one (with transaction we could rollback, but for simplicity we accept partial failure)
    const createdUsers = [];
    const failedEmails = [];
    for (const cred of credentials) {
      try {
        const username = await generateUniqueUsername(cred, reservedUsernames);
        const user = await User.create({
          name: cred.name,
          username,
          email: cred.email,
          password: cred.plainPassword,
          role: 'student',
          institutionId: institution._id,
          departmentCode: cred.departmentCode,
          studentSource: 'institution_created',
          isFirstLogin: true,
          mustResetPassword: true,
          diagnosticCompleted: false,
        });
        createdUsers.push({ user, plainPassword: cred.plainPassword });
        // Push to department's students array
        departmentMap[cred.departmentCode].students.push(user._id);
      } catch (err) {
        failedEmails.push(cred.email);
      }
    }

    // Save the institution document with updated department student lists
    await institution.save();

    res.status(201).json({
      success: true,
      data: {
        created: createdUsers.length,
        failed: failedEmails.length,
        students: createdUsers.map(({ user, plainPassword }) => ({
          _id: user._id,
          name: user.name,
          email: user.email,
          departmentCode: user.departmentCode,
          temporaryPassword: plainPassword,
        })),
        failedEmails,
      },
      message: 'Bulk student creation completed',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all students of the institution (paginated, filterable, searchable)
// @route   GET /api/institution/students
// @access  Private (Institution)
const getAllStudents = async (req, res, next) => {
  try {
    const { departmentCode, level, page = 1, limit = 20, search } = req.query;
    const filter = { institutionId: req.institution._id };
    if (departmentCode) filter.departmentCode = String(departmentCode).trim().toUpperCase();
    if (level) filter.currentLevel = normalizeReadinessLevel(level);
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ name: regex }, { email: regex }];
    }
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [students, total] = await Promise.all([
      User.find(filter)
        .select('name email currentLevel placementReadiness currentStreak lastActiveAt mustResetPassword diagnosticCompleted departmentCode studentSource')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        students,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Remove a student from institution (soft detach)
// @route   DELETE /api/institution/students/:studentId
// @access  Private (Institution)
const removeStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    if (student.institutionId?.toString() !== req.institution._id.toString()) {
      return res.status(403).json({ success: false, message: 'Student does not belong to your institution' });
    }

    // Remove from department
    const institution = await Institution.findById(req.institution._id);
    const dept = institution.departments.find(d => d.code === student.departmentCode);
    if (dept) {
      dept.students.pull(studentId);
      await institution.save();
    }

    // Detach student from institution
    student.institutionId = null;
    student.departmentCode = '';
    await student.save();

    res.status(200).json({ success: true, message: 'Student removed from institution' });
  } catch (err) {
    next(err);
  }
};

// @desc    Admin resets a student's password
// @route   PUT /api/institution/students/:studentId/reset-password
// @access  Private (Institution)
const resetStudentPassword = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    if (student.institutionId?.toString() !== req.institution._id.toString()) {
      return res.status(403).json({ success: false, message: 'Student does not belong to your institution' });
    }

    const plainPassword = generateStudentPassword();
    student.password = plainPassword; // will be hashed on save
    student.mustResetPassword = true;
    await student.save();

    res.status(200).json({
      success: true,
      data: { newTempPassword: plainPassword },
      message: 'Student password reset successfully',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addSingleStudent,
  addBulkStudents,
  getAllStudents,
  removeStudent,
  resetStudentPassword,
};
