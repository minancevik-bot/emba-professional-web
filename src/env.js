const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateEnvFiles(filePath) {
  if (filePath) return [path.resolve(filePath)];
  return unique([
    path.join(projectRoot, ".env"),
    path.join(process.cwd(), ".env")
  ]);
}

function loadEnv(filePath, options = {}) {
  const loadedFiles = [];
  const override = options.override === true;

  for (const candidate of candidateEnvFiles(filePath)) {
    if (!fs.existsSync(candidate)) continue;
    const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const withoutExport = trimmed.replace(/^export\s+/, "");
      const index = withoutExport.indexOf("=");
      if (index === -1) continue;
      const key = withoutExport.slice(0, index).trim();
      let value = withoutExport.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (override || !process.env[key]) process.env[key] = value;
    }
    loadedFiles.push(candidate);
  }

  return loadedFiles;
}

function maskDatabaseUrl(value) {
  if (!value) return "(DATABASE_URL tanimli degil)";
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch (_error) {
    return String(value).replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/i, "$1***@");
  }
}

module.exports = {
  loadEnv,
  maskDatabaseUrl,
  projectRoot
};
