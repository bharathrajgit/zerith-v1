const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const env = require('../config/env');

const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const LEGACY_TENANT_ID = '6a20fd8f08de5119fed29415';

async function main() {
  await mongoose.connect(env.MONGO_URI);
  const usersColl = mongoose.connection.collection('users');
  const instColl = mongoose.connection.collection('institutions');

  const rawUser = await usersColl.findOne({ email: 'anuradhamcadir@rathinam.in' });
  if (!rawUser) { console.log('User not found'); await mongoose.disconnect(); return; }
  if (rawUser.role !== 'coordinator') { console.log('Role not coordinator:', rawUser.role); await mongoose.disconnect(); return; }

  const tenantId = rawUser.tenantId ? rawUser.tenantId : new mongoose.Types.ObjectId(LEGACY_TENANT_ID);
  if (!tenantId) { console.log('No tenantId'); await mongoose.disconnect(); return; }

  const inst = await instColl.findOne({ _id: tenantId });
  if (!inst) { console.log('Institution not found'); await mongoose.disconnect(); return; }
  if (!inst.isActive) { console.log('Institution not active'); await mongoose.disconnect(); return; }

  const backupPath = path.join(BACKUP_DIR, 'anuradhamcadir-before-migration-' + Date.now() + '.json');
  fs.writeFileSync(backupPath, JSON.stringify(rawUser, null, 2));
  console.log('Backup:', backupPath);

  const username = 'anuradhamcadir';
  const existing = await usersColl.findOne({ username: username, _id: { $ne: rawUser._id } });
  const finalUsername = existing ? username + '_' + Date.now() : username;

  await usersColl.updateOne(
    { _id: rawUser._id },
    { $set: {
      role: 'institution_admin',
      institutionId: tenantId,
      departmentCode: 'MCA',
      username: finalUsername,
      isFirstLogin: false,
      mustResetPassword: false,
      updatedAt: new Date()
    }}
  );

  console.log('Migrated:', rawUser.email, '| role: institution_admin | institutionId:', tenantId.toString(), '| username:', finalUsername);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
