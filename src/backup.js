const fs = require("fs/promises");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const BACKUP_TABLES = [
  "users",
  "students",
  "student_lessons",
  "attendance_records",
  "payments",
  "audit_logs",
  "app_settings"
];

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function collectTable(client, table) {
  const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY 1`);
  return rows;
}

async function runBackup(client, actorUserId = null) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const exportedAt = new Date();
  const payload = {
    exportedAt: exportedAt.toISOString(),
    app: "emba-professional-web",
    tables: {}
  };
  const rowCounts = {};

  for (const table of BACKUP_TABLES) {
    const rows = await collectTable(client, table);
    payload.tables[table] = rows;
    rowCounts[table] = rows.length;
  }

  const filename = `emba-backup-${timestampForFilename(exportedAt)}.json`;
  const filePath = path.join(BACKUP_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  const stat = await fs.stat(filePath);

  const { rows } = await client.query(
    `INSERT INTO backups (filename, file_size, row_counts, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [filename, stat.size, rowCounts, actorUserId]
  );

  return rows[0];
}

function scheduleBackups(pool, hours = 24) {
  const intervalMs = Math.max(Number(hours) || 24, 1) * 60 * 60 * 1000;
  const run = async () => {
    const client = await pool.connect();
    try {
      await runBackup(client);
      console.log("Otomatik yedekleme tamamlandi.");
    } catch (error) {
      console.error("Otomatik yedekleme hatasi:", error.message);
    } finally {
      client.release();
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  BACKUP_DIR,
  runBackup,
  scheduleBackups
};
