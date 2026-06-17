const { loadEnv } = require("../src/env");
loadEnv();

const { query, closePool } = require("../src/db");
const { hashPassword } = require("../src/auth");

async function main() {
  const username = process.argv[2] || process.env.ADMIN_USERNAME || "admin";
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  const fullName = process.argv[4] || "EMBA Admin";

  if (!password || password.length < 8) {
    throw new Error("Admin sifresi en az 8 karakter olmalidir. Ornek: npm run create-admin -- admin CokGucluSifre123");
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (username, full_name, role, password_hash, active)
     VALUES ($1, $2, 'admin', $3, TRUE)
     ON CONFLICT (username)
     DO UPDATE SET full_name = EXCLUDED.full_name, role = 'admin', password_hash = EXCLUDED.password_hash, active = TRUE
     RETURNING id, username`,
    [username, fullName, passwordHash]
  );

  process.stdout.write(`Admin hazir: ${rows[0].username} (#${rows[0].id})\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
