/* ==========================================================
   АУТЕНТИФИКАЦИЯ — регистрация, вход, сессии, статус «про»
   Без внешних зависимостей. Пароли хранятся хешами scrypt,
   в открытом виде — никогда.
   ========================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 дней
const MAX_USERS = 5000;

/* ---------- секрет для подписи сессий ---------- */

function sessionSecret() {
  try {
    const saved = fs.readFileSync(SECRET_FILE);
    if (saved.length >= 32) return saved;
  } catch (_) { /* создадим ниже */ }
  const secret = crypto.randomBytes(48);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  } catch (e) {
    console.warn('!! не удалось сохранить секрет сессий:', e.message);
  }
  return secret;
}

const SECRET = sessionSecret();

/* ---------- хранилище пользователей ---------- */

let users = [];

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    users = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    users = [];
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Пишем во временный файл и переименовываем — файл не потеряется
    // при падении сервера посередине записи.
    const tmp = `${USERS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, USERS_FILE);
  } catch (e) {
    console.error('!! не удалось сохранить пользователей:', e.message);
  }
}

load();

const norm = (email) => String(email || '').trim().toLowerCase();
const findUser = (email) => users.find((u) => u.email === norm(email)) || null;
const findById = (id) => users.find((u) => u.id === id) || null;

/* ---------- пароли ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
    const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
    const real = Buffer.from(keyHex, 'hex');
    return key.length === real.length && crypto.timingSafeEqual(key, real);
  } catch (_) {
    return false;
  }
}

/** Простой подсчёт неудачных попыток, чтобы не долбили перебором. */
const attempts = new Map();
const MAX_TRIES = 8;
const LOCK_MS = 10 * 60 * 1000;

function tooManyTries(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.at > LOCK_MS) { attempts.delete(key); return false; }
  return rec.n >= MAX_TRIES;
}

function noteFail(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.at > LOCK_MS) attempts.set(key, { n: 1, at: Date.now() });
  else { rec.n += 1; rec.at = Date.now(); }
}

function clearFails(key) {
  attempts.delete(key);
}


/* ---------- сессии ---------- */

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function cookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req) {
  const payload = readToken(cookies(req).sid);
  if (!payload) return null;
  return findById(payload.id) || null;
}

function issueCookie(res, user) {
  const token = sign({ id: user.id, exp: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
  return token;
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

/* ---------- публичный вид ---------- */

function publicUser(u) {
  if (!u) return null;
  return {
    email: u.email,
    name: u.name || '',
    pro: Boolean(u.pro),
    proSince: u.proSince || null,
    createdAt: u.createdAt,
  };
}

/* ---------- операции ---------- */

function register(email, password, name) {
  const mail = norm(email);

  if (findUser(mail)) {
    throw Object.assign(new Error('Такая почта уже зарегистрирована'), { status: 409 });
  }
  if (users.length >= MAX_USERS) {
    throw Object.assign(new Error('Регистрация временно закрыта'), { status: 503 });
  }

  const user = {
    id: crypto.randomUUID(),
    email: mail,
    name: String(name || '').slice(0, 60).trim(),
    pass: hashPassword(password),
    pro: false,
    proSince: null,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  save();
  return user;
}

function login(email, password) {
  const mail = norm(email);

  if (tooManyTries(mail)) {
    throw Object.assign(new Error('Слишком много попыток. Попробуйте через 10 минут.'), { status: 429 });
  }

  const user = findUser(mail);

  // Хеш считаем даже когда пользователя нет — иначе по времени ответа
  // можно было бы вычислить, какие почты зарегистрированы.
  const ok = user
    ? verifyPassword(password, user.pass)
    : verifyPassword(password, hashPassword('x'));

  if (!user || !ok) {
    noteFail(mail);
    throw Object.assign(new Error('Неверная почта или пароль'), { status: 401 });
  }

  clearFails(mail);
  return user;
}

/** Статус «про» выдаётся по почте, которой проведена оплата. */
function grantPro(email) {
  const user = findUser(email);
  if (!user) return null;
  if (!user.pro) {
    user.pro = true;
    user.proSince = new Date().toISOString();
    save();
    log(`★ статус «про» выдан: ${user.email}`);
  }
  return user;
}

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

module.exports = {
  register, login, grantPro, findUser, findById,
  sessionCookie, issueCookie, clearCookie,
  publicUser,
  isEmail: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(norm(s)),
};

