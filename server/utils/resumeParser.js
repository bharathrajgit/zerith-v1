const { PDFParse } = require('pdf-parse');

async function parseResume(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new TypeError('Resume must be provided as a non-empty PDF buffer');
  }

  const parser = new PDFParse({ data: fileBuffer });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

module.exports = { parseResume };
