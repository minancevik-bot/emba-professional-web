require("../src/env").loadEnv();

const { query, closePool, getConnectionInfo } = require("../src/db");

async function roleConstraintSupports(role) {
  const { rows } = await query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid = 'users'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'`
  );
  if (!rows.length) return true;
  return rows.some((row) => String(row.definition || "").includes(`'${role}'`));
}

async function main() {
  const connection = getConnectionInfo();
  console.log(`PostgreSQL hedefi: ${connection.databaseUrl}`);

  const { rows } = await query(
    "SELECT id, username, full_name, role, club_id, active FROM users WHERE username = $1 LIMIT 1",
    ["admin"]
  );
  const admin = rows[0];
  if (!admin) {
    throw new Error("admin kullanicisi bulunamadi.");
  }

  console.log(`admin bulundu: id=${admin.id}, current_role=${admin.role}, club_id=${admin.club_id || "-"}`);
  if (admin.role === "super_admin") {
    console.log("admin zaten super_admin. Sifreye dokunulmadi.");
    return;
  }

  const supported = await roleConstraintSupports("super_admin");
  if (!supported) {
    console.log("users_role_check constraint'i super_admin rolunu kabul etmiyor.");
    console.log("Migration bu asamada yasak oldugu icin veritabaninda rol degisikligi yapilmadi.");
    console.log("Uygulama, username=admin ve role=admin olan hesabi kod seviyesinde super_admin olarak calistirir.");
    return;
  }

  const updated = await query(
    `UPDATE users
     SET role = 'super_admin'
     WHERE username = $1
     RETURNING id, username, full_name, role, club_id, active`,
    ["admin"]
  );
  console.log(`admin role=${updated.rows[0].role} yapildi. Sifreye dokunulmadi.`);
}

main()
  .catch((error) => {
    console.error("admin super_admin yapilamadi:");
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
