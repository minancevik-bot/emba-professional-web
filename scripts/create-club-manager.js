require("../src/env").loadEnv();

const { query, closePool, getConnectionInfo } = require("../src/db");
const { hashPassword } = require("../src/auth");

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function readManagerPassword() {
  const rawPassword = process.env.MANAGER_PASSWORD;
  if (typeof rawPassword !== "string") return "";
  const trimmedPassword = rawPassword.trim();
  if (rawPassword !== trimmedPassword) {
    throw new Error(
      'MANAGER_PASSWORD degerinin basinda veya sonunda bosluk var. Dogru format: set "MANAGER_PASSWORD=YeniGecici123" && npm.cmd run create-club-manager -- --club emba --username emba_manager2 --full-name "EMBA Kulup Yoneticisi"'
    );
  }
  return trimmedPassword;
}

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

async function findClub(identifier) {
  if (!identifier) return null;
  const numericId = Number(identifier);
  if (Number.isInteger(numericId) && numericId > 0) {
    const byId = await query("SELECT id, name, slug FROM clubs WHERE id = $1", [numericId]);
    if (byId.rows[0]) return byId.rows[0];
  }
  const bySlug = await query("SELECT id, name, slug FROM clubs WHERE slug = $1", [String(identifier).trim()]);
  return bySlug.rows[0] || null;
}

async function main() {
  const connection = getConnectionInfo();
  console.log(`PostgreSQL hedefi: ${connection.databaseUrl}`);

  const clubIdentifier = readArg("club") || readArg("club-id") || readArg("clubSlug");
  const username = readArg("username");
  const fullName = readArg("full-name") || readArg("fullName") || username;
  const password = readManagerPassword();

  if (!clubIdentifier || !username) {
    throw new Error(
      "Kullanim: node scripts/create-club-manager.js --club emba --username kullanici --full-name \"Ad Soyad\""
    );
  }

  const club = await findClub(clubIdentifier);
  if (!club) {
    throw new Error(`Kulup bulunamadi: ${clubIdentifier}`);
  }

  const managerSupported = await roleConstraintSupports("manager");
  if (!managerSupported) {
    throw new Error("users_role_check manager rolunu kabul etmiyor. Once 004_expand_user_roles migration dosyasini calistirin.");
  }

  const existing = await query("SELECT id, username, role, club_id FROM users WHERE username = $1", [username]);
  if (existing.rows[0]) {
    if (existing.rows[0].role === "manager" && Number(existing.rows[0].club_id) === Number(club.id)) {
      console.log(`Kullanici zaten manager: ${existing.rows[0].username}, club=${club.name}`);
      return;
    }
    const updated = await query(
      `UPDATE users
       SET role = 'manager', club_id = $1
       WHERE username = $2
       RETURNING id, username, role, club_id`,
      [club.id, username]
    );
    console.log(`Mevcut kullanici manager yapildi: ${updated.rows[0].username}, role=${updated.rows[0].role}, club=${club.name}`);
    return;
  }

  if (!password || String(password).length < 8) {
    throw new Error("Yeni manager icin MANAGER_PASSWORD ortam degiskeni en az 8 karakter olmalidir.");
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (username, full_name, role, password_hash, club_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, full_name, role, club_id, active`,
    [username, fullName, "manager", passwordHash, club.id]
  );

  console.log(`Kulup yoneticisi olusturuldu: username=${rows[0].username}, role=${rows[0].role}, club=${club.name}`);
}

main()
  .catch((error) => {
    console.error("Kulup yoneticisi olusturulamadi:");
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
