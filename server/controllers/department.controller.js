// server/controllers/department.controller.js
const Institution = require('../models/Institution');
const User = require('../models/User');
const { syncInstitutionRoster } = require('../services/institutionRosterService');

// @desc    Create a new department within the institution
// @route   POST /api/institution/departments
// @access  Private (Institution)
const createDepartment = async (req, res, next) => {
  try {
    const { name, code, targetPlacementDate, notes } = req.body;
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!name || !normalizedCode) {
      return res.status(400).json({
        success: false,
        message: 'Department name and code are required',
      });
    }

    const institution = await Institution.findById(req.institution._id);
    if (!institution) {
      return res.status(404).json({ success: false, message: 'Institution not found' });
    }

    // Check for duplicate code within the institution
    const exists = institution.departments.some(
      (dept) => dept.code === normalizedCode
    );
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Department code already exists in this institution',
      });
    }

    institution.departments.push({
      name,
      code: normalizedCode,
      students: [],
      notes: notes || '',
      targetPlacementDate: targetPlacementDate || null,
    });
    await institution.save();

    const newDept = institution.departments[institution.departments.length - 1];

    res.status(201).json({
      success: true,
      data: newDept,
      message: 'Department created successfully',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update an existing department
// @route   PUT /api/institution/departments/:code
// @access  Private (Institution)
const updateDepartment = async (req, res, next) => {
  try {
    const { name, targetPlacementDate, notes } = req.body;
    const code = String(req.params.code || '').trim().toUpperCase();

    const institution = await Institution.findById(req.institution._id);
    if (!institution) {
      return res.status(404).json({ success: false, message: 'Institution not found' });
    }

    const dept = institution.departments.find((d) => d.code === code);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    if (name !== undefined) dept.name = name;
    // targetPlacementDate and notes are not in the original schema, but we can still store them if we add them to the subdocument. For now, we'll keep only the existing fields. If you need extra fields, extend the department sub-schema.
    // Since the prompt requires them, we'll add them dynamically.
    if (targetPlacementDate !== undefined) dept.targetPlacementDate = targetPlacementDate;
    if (notes !== undefined) dept.notes = notes;

    await institution.save();

    res.status(200).json({
      success: true,
      data: dept,
      message: 'Department updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a department
// @route   DELETE /api/institution/departments/:code
// @access  Private (Institution)
const deleteDepartment = async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();

    const institution = await Institution.findById(req.institution._id);
    if (!institution) {
      return res.status(404).json({ success: false, message: 'Institution not found' });
    }

    const deptIndex = institution.departments.findIndex((d) => d.code === code);
    if (deptIndex === -1) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    if (institution.departments[deptIndex].students.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a department with existing students. Move or remove students first.',
      });
    }

    institution.departments.splice(deptIndex, 1);
    await institution.save();

    res.status(200).json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all departments of the institution
// @route   GET /api/institution/departments
// @access  Private (Institution)
const getDepartments = async (req, res, next) => {
  try {
    await syncInstitutionRoster(req.institution._id);
    const institution = await Institution.findById(req.institution._id)
      .populate(
        'departments.students',
        'name email placementReadiness studentSource currentLevel lastActiveAt departmentCode'
      )
      .lean();

    if (!institution) {
      return res.status(404).json({ success: false, message: 'Institution not found' });
    }

    const departments = institution.departments.map((dept) => {
      const students = dept.students || [];
      const avgReadiness =
        students.length > 0
          ? Math.round(
              students.reduce((sum, s) => sum + (s.placementReadiness || 0), 0) / students.length
            )
          : 0;

      return {
        ...dept,
        studentCount: students.length,
        avgPlacementReadiness: avgReadiness,
      };
    });

    res.status(200).json({
      success: true,
      data: departments,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Move a student from one department to another
// @route   PUT /api/institution/departments/move-student
// @access  Private (Institution)
const moveStudentDepartment = async (req, res, next) => {
  try {
    const {
      studentId,
      fromDepartment,
      toDepartment,
    } = req.body;
    const normalizedFromDepartment = String(fromDepartment || '').trim().toUpperCase();
    const normalizedToDepartment = String(toDepartment || '').trim().toUpperCase();
    if (!studentId || !fromDepartment || !toDepartment) {
      return res.status(400).json({
        success: false,
        message: 'studentId, fromDepartment, and toDepartment are required',
      });
    }

    const institution = await Institution.findById(req.institution._id);
    if (!institution) {
      return res.status(404).json({ success: false, message: 'Institution not found' });
    }

    const fromDept = institution.departments.find((d) => d.code === normalizedFromDepartment);
    const toDept = institution.departments.find((d) => d.code === normalizedToDepartment);

    if (!fromDept || !toDept) {
      return res.status(404).json({ success: false, message: 'Invalid department code' });
    }
    if (normalizedFromDepartment === normalizedToDepartment) {
      return res.status(400).json({
        success: false,
        message: 'Select a different destination department',
      });
    }

    // Check student belongs to institution
    const student = await User.findById(studentId);
    if (!student || student.institutionId?.toString() !== req.institution._id.toString()) {
      return res.status(403).json({ success: false, message: 'Student not in this institution' });
    }

    // Remove from old department
    fromDept.students.pull(studentId);
    // Add to new department
    if (!toDept.students.includes(studentId)) {
      toDept.students.push(studentId);
    }

    // Update student's department code
    student.departmentCode = normalizedToDepartment;
    await student.save();
    await institution.save();

    res.status(200).json({
      success: true,
      message: `Student moved from ${normalizedFromDepartment} to ${normalizedToDepartment}`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartments,
  moveStudentDepartment,
};
