const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);
const COOKIE_NAME = "emba_session";
const SESSION_DAYS = 7;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET || "local-development-secret-change-me";
  if (process.env.NODE_ENV === "production" && secret === "local-development-secret-change-me") {
    throw new Error("Production icin SESSION_SECRET ortam degiskeni ayarlanmalidir.");
  }
  return secret;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const n = 16384;
  const r = 8;
  const p = 1;
  const key = await scryptAsync(String(password), salt, 64, { N: n, r, p });
  return `scrypt$${n}$${r}$${p}$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith("scrypt$")) return false;
  const [, nValue, rValue, pValue, salt, hashHex] = storedHash.split("$");
  const n = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (!n || !r || !p || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(String(password), salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function makeSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signToken(token) {
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(token)
    .digest("base64url");
  return `${token}.${signature}`;
}

function openSignedToken(value) {
  if (!value || !value.includes(".")) return null;
  const dot = value.lastIndexOf(".");
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = signToken(token).slice(dot + 1);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return null;
  return crypto.timingSafeEqual(left, right) ? token : null;
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [decodeURIComponent(part), ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(response, token, persistent = false) {
  const signed = signToken(token);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = persistent ? `; Max-Age=${SESSION_DAYS * 24 * 60 * 60}` : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(signed)}${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function getSessionToken(request) {
  const cookies = parseCookies(request);
  return openSignedToken(cookies[COOKIE_NAME]);
}

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  makeSessionToken,
  tokenHash,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  sessionExpiresAt
};
