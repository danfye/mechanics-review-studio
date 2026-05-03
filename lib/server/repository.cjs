const fsp = require("node:fs/promises");
const path = require("node:path");

function createDbTemplate() {
  return {
    version: 1,
    courses: [],
    documents: [],
    mistakes: [],
    sessions: [],
    questionProgress: [],
    settings: {
      provider: "local",
      apiBaseUrl: "",
      apiKey: "",
      model: "",
    },
  };
}

function createRepository({ dataDir, uploadDir, dbPath }) {
  async function ensureDataDirs() {
    await fsp.mkdir(uploadDir, { recursive: true });
    try {
      await fsp.access(dbPath);
    } catch {
      await fsp.writeFile(dbPath, JSON.stringify(createDbTemplate(), null, 2));
    }
  }

  async function readDb() {
    await ensureDataDirs();
    try {
      const raw = await fsp.readFile(dbPath, "utf8");
      return { ...createDbTemplate(), ...JSON.parse(raw) };
    } catch {
      return createDbTemplate();
    }
  }

  async function writeDb(db) {
    await ensureDataDirs();
    await fsp.writeFile(dbPath, JSON.stringify({ ...createDbTemplate(), ...db }, null, 2));
  }

  function storedUploadPath(storedName) {
    const filePath = path.normalize(path.join(uploadDir, storedName || ""));
    const relativePath = path.relative(uploadDir, filePath);
    if (!storedName || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("文件路径无效。");
    }
    return filePath;
  }

  async function deleteStoredDocumentFile(doc) {
    if (!doc?.storedName) return;
    try {
      await fsp.unlink(storedUploadPath(doc.storedName));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return {
    dataDir,
    uploadDir,
    dbPath,
    ensureDataDirs,
    readDb,
    writeDb,
    storedUploadPath,
    deleteStoredDocumentFile,
  };
}

module.exports = {
  createDbTemplate,
  createRepository,
};
