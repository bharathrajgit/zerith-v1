const mongoose = require('mongoose');

const { MONGO_URI } = require('./config/env');
const Module = require('./models/Module');
const Topic = require('./models/Topic');
const MCQ = require('./models/MCQ');
const { TOPIC_MODULE_ORDERS } = require('./services/adaptiveDiagnosticService');

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB - validating diagnostic database state...');

  const requiredOrders = Object.values(TOPIC_MODULE_ORDERS);
  const modules = await Module.find({
    order: { $in: requiredOrders },
    isActive: true,
  })
    .select('_id order title')
    .sort({ order: 1 })
    .lean();

  const moduleIdByOrder = new Map(
    modules.map((moduleDoc) => [moduleDoc.order, String(moduleDoc._id)])
  );

  const moduleIds = modules.map((moduleDoc) => moduleDoc._id);
  const topics = await Topic.find({
    moduleId: { $in: moduleIds },
  })
    .select('_id moduleId title order')
    .sort({ order: 1 })
    .lean();

  const activeMcqs = await MCQ.find({
    moduleId: { $in: moduleIds },
    isActive: true,
  })
    .select('_id moduleId topicId difficulty')
    .lean();

  const failures = [];

  console.log('\n=== DIAGNOSTIC MODULE CHECK ===');
  Object.entries(TOPIC_MODULE_ORDERS).forEach(([topicKey, moduleOrder]) => {
    const moduleDoc = modules.find((item) => item.order === moduleOrder);
    const moduleId = moduleIdByOrder.get(moduleOrder);
    const moduleTopics = topics.filter((topic) => String(topic.moduleId) === String(moduleId || ''));
    const moduleMcqs = activeMcqs.filter((mcq) => String(mcq.moduleId) === String(moduleId || ''));

    const status = {
      topicKey,
      moduleOrder,
      moduleFound: !!moduleDoc,
      topicCount: moduleTopics.length,
      activeMcqCount: moduleMcqs.length,
    };

    console.log(
      `${topicKey} -> module ${moduleOrder}: `
      + `${status.moduleFound ? 'module OK' : 'module MISSING'}, `
      + `${status.topicCount} topics, `
      + `${status.activeMcqCount} active MCQs`
    );

    if (!moduleDoc) {
      failures.push(`Missing diagnostic module for ${topicKey} (module ${moduleOrder}).`);
      return;
    }

    if (moduleTopics.length === 0) {
      failures.push(`No topics found for diagnostic topic ${topicKey} (module ${moduleOrder}).`);
    }

    if (moduleMcqs.length === 0) {
      failures.push(`No active MCQs found for diagnostic topic ${topicKey} (module ${moduleOrder}).`);
    }
  });

  console.log('\n=== OVERALL COUNTS ===');
  console.log(`Active diagnostic modules: ${modules.length}/${requiredOrders.length}`);
  console.log(`Topics across diagnostic modules: ${topics.length}`);
  console.log(`Active MCQs across diagnostic modules: ${activeMcqs.length}`);

  if (failures.length > 0) {
    console.error('\nDiagnostic database validation failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log('\nDiagnostic database validation passed.');
}

main()
  .catch((error) => {
    console.error('Diagnostic database validation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => null);
  });
