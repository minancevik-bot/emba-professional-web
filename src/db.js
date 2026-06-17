const { loadEnv, maskDatabaseUrl } = require("./env");
loadEnv();

const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/emba_professional";
const isRemoteDatabase = !/localhost|127\.0\.0\.1/i.test(connectionString);
const sslEnabled = process.env.DATABASE_SSL === "true" || (process.env.NODE_ENV === "production" && isRemoteDatabase);
const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const queryTimeoutMs = positiveNumber(process.env.DATABASE_QUERY_TIMEOUT_MS, 20000);
const statementTimeoutMs = positiveNumber(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 15000);
const connectionTimeoutMs = positiveNumber(process.env.DATABASE_CONNECT_TIMEOUT_MS, 15000);

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: connectionTimeoutMs,
  query_timeout: queryTimeoutMs,
  statement_timeout: statementTimeoutMs,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

function getConnectionInfo() {
  return {
    databaseUrl: maskDatabaseUrl(connectionString),
    sslEnabled,
    hasDatabaseUrlEnv: Boolean(process.env.DATABASE_URL),
    queryTimeoutMs,
    statementTimeoutMs,
    connectionTimeoutMs
  };
}

module.exports = {
  pool,
  query,
  transaction,
  closePool,
  getConnectionInfo
};
