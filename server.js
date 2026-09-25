#!/usr/bin/env node
/* ==========================================================
   ВИЗИТКА — сервер статики + приём оплаты ЮKassa
   Без внешних зависимостей: только модули Node.

   Запуск:
     YOOKASSA_SHOP_ID=xxx YOOKASSA_SECRET_KEY=yyy node server.js
   Подробности — в README.md
   ========================================================== */
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const auth = require('./auth.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ORDERS_FILE = path.join(ROOT, 'data', 'orders.ndjson');

// Режим оплаты:
//   'mock' — поддельный провайдер, полностью офлайн, ключи не нужны (по умолчанию)
//   'live' — настоящая ЮKassa
const PAY_MODE = process.env.PAY_MODE || (SHOP_ID && SECRET_KEY ? 'live' : 'mock');

// Платежи, созданные в mock-режиме и ещё не подтверждённые.
const pending = new Map();

const API_BASE = 'https://api.yookassa.ru/v3';
const CURRENCY = 'RUB';
const MIN_AMOUNT = 100;          // минимальная сумма платежа, ₽
const MAX_AMOUNT = 5000000;      // максимальная сумма платежа, ₽
const MAX_BODY = 8 * 1024;       // 8 КБ — достаточно для нашей формы

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ---------- вспомогательное ---------- */

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Значение для YooKassa: "45000.00" */
function money(rubles) {
  return rubles.toFixed(2);
}

/** Запрос к API ЮKassa */
function yk(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }

    const req = https.request(`${API_BASE}${endpoint}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) { /* не JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const message = (parsed && parsed.description) || `HTTP ${res.statusCode}`;
        const err = Object.assign(new Error(message), {
          status: 502, ykStatus: res.statusCode, yk: parsed,
        });
        return reject(err);
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}


/** Сохраняем заказ построчно — не теряем историю при перезапуске. */
function saveOrder(record) {
  try {
    fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
    fs.appendFileSync(ORDERS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    log('!! не удалось сохранить заказ:', e.message);
  }
}

/** Прайс нужен серверу, чтобы не доверять сумме из браузера. */
function readCatalog() {
  try {
    const file = path.join(ROOT, 'data', 'services.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

const isEmail = (s) =>
  typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/* ---------- API: создание платежа ---------- */

async function handleCreatePayment(req, res) {
  if (PAY_MODE === 'live' && (!SHOP_ID || !SECRET_KEY)) {
    return sendJSON(res, 503, {
      error: 'Оплата пока не настроена',
      hint: 'Задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY, затем перезапустите сервер',
    });
  }

  let data;
  try {
    data = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    return sendJSON(res, 400, { error: 'Некорректный запрос' });
  }

  const service = String(data.service || '').slice(0, 120).trim();
  const email = String(data.email || '').slice(0, 120).trim();
  const amountRaw = Number(data.amount);

  if (!isEmail(email)) {
    return sendJSON(res, 400, { error: 'Укажите корректную почту для чека' });
  }
  if (!Number.isFinite(amountRaw) || amountRaw < MIN_AMOUNT || amountRaw > MAX_AMOUNT) {
    return sendJSON(res, 400, {
      error: `Сумма должна быть от ${MIN_AMOUNT} до ${MAX_AMOUNT} ₽`,
    });
  }

  // Сумму нельзя принимать из браузера — сверяем с серверным прайсом.
  const catalog = readCatalog();
  if (catalog.length) {
    const match = catalog.find((s) => s.name === service);
    if (!match) return sendJSON(res, 400, { error: 'Неизвестная услуга' });
    if (amountRaw < match.price) {
      return sendJSON(res, 400, {
        error: `Минимальная сумма по услуге «${match.name}» — ${match.price} ₽`,
      });
    }
  }

  const orderId = crypto.randomUUID();
  const returnUrl = `${PUBLIC_URL}/?paid=1&order=${encodeURIComponent(orderId)}`;

  let payment;
  if (PAY_MODE === 'mock') {
    // Поддельный провайдер: структура ответа повторяет ЮKassa,
    // поэтому фронтенд работает одинаково в обоих режимах.
    const mockId = `mock_${crypto.randomUUID()}`;
    payment = {
      id: mockId,
      status: 'pending',
      amount: { value: money(amountRaw), currency: CURRENCY },
      confirmation: { type: 'redirect', confirmation_url: `${PUBLIC_URL}/mock-pay/${mockId}` },
    };
    pending.set(mockId, {
      id: mockId,
      status: 'pending',
      amount: payment.amount,
      confirmation: payment.confirmation,
      metadata: { order_id: orderId, service: service || '—', email },
      return_url: returnUrl,
    });
  } else {
    try {
      payment = await yk('POST', '/payments', {
        amount: { value: money(amountRaw), currency: CURRENCY },
        capture: true,
        confirmation: { type: 'redirect', return_url: returnUrl },
        description: service ? `Оплата услуги: ${service}` : 'Оплата услуги',
        metadata: {
          order_id: orderId,
          service: service || '—',
          email,
          source: 'visitka',
        },
      });
    } catch (e) {
      log('!! ошибка создания платежа:', e.message, e.ykStatus || '');
      return sendJSON(res, 502, {
        error: 'Платёжный сервис временно недоступен. Попробуйте чуть позже.',
        detail: process.env.NODE_ENV === 'development' ? e.message : undefined,
      });
    }
  }

  saveOrder({
    event: 'created',
    at: new Date().toISOString(),
    order_id: orderId,
    payment_id: payment.id,
    service: service || '—',
    email,
    amount: money(amountRaw),
    currency: CURRENCY,
    status: payment.status,
  });

  log(`создан платёж ${payment.id} на ${money(amountRaw)} ${CURRENCY} (${service || '—'})`);

  const url = payment && payment.confirmation && payment.confirmation.confirmation_url;
  if (!url) return sendJSON(res, 502, { error: 'Платёж создан, но ссылка не получена' });

  return sendJSON(res, 200, {
    confirmation_url: url,
    order_id: orderId,
    payment_id: payment.id,
  });
}


/* ---------- API: вебхук ---------- */

/** Подтверждаем оплату и пишем её в журнал. */
async function confirmPayment(paymentId) {
  let real;

  if (PAY_MODE === 'mock') {
    real = pending.get(paymentId);
  } else {
    // ЮKassa не подписывает вебхуки, поэтому всегда переспрашиваем API:
    // так мы удостоверяемся, что платёж действительно прошёл.
    real = await yk('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  if (!real || real.status !== 'succeeded') return null;

  saveOrder({
    event: 'paid',
    at: new Date().toISOString(),
    order_id: (real.metadata && real.metadata.order_id) || null,
    payment_id: real.id,
    service: (real.metadata && real.metadata.service) || '—',
    email: (real.metadata && real.metadata.email) || '—',
    amount: real.amount && real.amount.value,
    currency: real.amount && real.amount.currency,
    status: real.status,
  });

  log(`✅ оплата получена: ${real.id} на ${real.amount && real.amount.value} ${real.amount && real.amount.currency}`);

  // Оплатили с той же почты, что и зарегистрировались — значит, открываем «про».
  const mail = real.metadata && real.metadata.email;
  if (mail) auth.grantPro(mail);

  return real;
}

/* ---------- API: вебхук ---------- */

async function handleWebhook(req, res) {
  let event;
  try {
    event = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    return sendJSON(res, 400, { error: 'Некорректный вебхук' });
  }

  const type = event && event.event;
  const payment = event && event.object;

  if (type === 'payment.succeeded' && payment && payment.id) {
    try {
      await confirmPayment(payment.id);
    } catch (e) {
      log('!! не удалось подтвердить платёж:', e.message);
    }
  }

  // ЮKassa ждёт быстрый ответ 200 — отвечаем сразу, детали пишем в файл.
  return sendJSON(res, 200, { ok: true });
}


/* ---------- Мок-провайдер: фейковая платёжная страница ---------- */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

function mockPayPage(pay) {
  const sum = `${Number(pay.amount.value).toLocaleString('ru-RU')} ₽`;
  const service = pay.metadata.service;
  const pid = esc(pay.id);

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тестовая оплата — ${esc(sum)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:#0b0b0d;color:#f4f1ea;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}
  .w{width:100%;max-width:420px}
  .tag{display:inline-block;padding:6px 12px;border-radius:999px;
    background:rgba(232,255,77,.12);border:1px solid rgba(232,255,77,.35);
    color:#e8ff4d;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
  h1{margin:18px 0 4px;font-size:34px;letter-spacing:-.03em;line-height:1.05}
  .sub{color:#8e8c85;font-size:14px;margin:0 0 26px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:13px 0;
    border-bottom:1px solid rgba(244,241,234,.12);font-size:14px}
  .row span:first-child{color:#8e8c85}
  .row span:last-child{text-align:right;word-break:break-all}
  .f{display:block;margin-top:22px}
  .f b{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:#5c5a55;margin-bottom:8px;font-weight:400}
  input{width:100%;padding:15px 17px;border:1px solid rgba(244,241,234,.16);
    border-radius:12px;background:#141418;color:#f4f1ea;font-size:16px;font-family:inherit}
  input:focus{outline:none;border-color:#e8ff4d}
  .btns{display:grid;gap:10px;margin-top:26px}
  button{padding:16px;border-radius:999px;border:0;font-family:inherit;
    font-size:15px;font-weight:700;cursor:pointer}
  .ok{background:#e8ff4d;color:#0a0a0b}
  .no{background:none;color:#8e8c85;border:1px solid rgba(244,241,234,.16);font-weight:400}
  .hint{margin:20px 0 0;padding:13px 15px;border-radius:10px;
    background:rgba(244,241,234,.05);color:#8e8c85;font-size:12.5px;line-height:1.5}
  code{font-family:ui-monospace,Menlo,monospace;color:#e8ff4d;font-size:12px}
</style></head>
<body><div class="w">
  <span class="tag">Тестовый режим · без реальных денег</span>
  <h1>${esc(sum)}</h1>
  <p class="sub">Это подделка платёжной страницы для локальной разработки.</p>

  <div class="row"><span>Получатель</span><span>Александр Волков</span></div>
  <div class="row"><span>Услуга</span><span>${esc(service)}</span></div>
  <div class="row"><span>Платёж</span><span>${esc(pay.id)}</span></div>

  <label class="f"><b>Номер карты</b>
    <input value="5555 5555 5555 4444" readonly></label>
  <label class="f"><b>Срок / CVC</b>
    <input value="12/34 · 123" readonly></label>

  <div class="btns">
    <button class="ok" onclick="go('ok')">Оплатить ${esc(sum)}</button>
    <button class="no" onclick="go('fail')">Отклонить платёж</button>
  </div>

  <p class="hint">
    Дальше сработает ровно то, что делала бы ЮKassa: редирект обратно на сайт
    и вебхук на <code>/api/webhook</code>. Проверить можно в
    <code>data/orders.ndjson</code>.
  </p>
</div>
<script>
  async function go(result) {
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    const id = ${JSON.stringify(pay.id)};
    const r = await fetch('/api/mock/' + encodeURIComponent(id) + '/' + result,
      { method: 'POST' });
    const d = await r.json();
    location.href = d.return_url || '/';
  }
</script>
</body></html>`;
}

function handleMockPage(req, res, paymentId) {
  if (PAY_MODE !== 'mock') return sendJSON(res, 404, { error: 'Мок выключен' });
  const pay = pending.get(paymentId);
  if (!pay) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>404 — платёж не найден</h1><p>Возможно, он уже завершён или сервер перезапущен.</p>');
  }
  const html = mockPayPage(pay);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function handleMockResult(req, res, paymentId, result) {
  if (PAY_MODE !== 'mock') return sendJSON(res, 404, { error: 'Мок выключен' });

  const pay = pending.get(paymentId);
  if (!pay) return sendJSON(res, 404, { error: 'Платёж не найден' });

  const orderId = pay.metadata.order_id;
  const back = new URL(pay.return_url);

  if (result !== 'ok') {
    pay.status = 'canceled';
    saveOrder({
      event: 'canceled',
      at: new Date().toISOString(),
      order_id: orderId,
      payment_id: paymentId,
      service: pay.metadata.service,
      email: pay.metadata.email,
      amount: pay.amount.value,
      currency: pay.amount.currency,
      status: 'canceled',
    });
    back.searchParams.set('paid', '0');
    return sendJSON(res, 200, { return_url: back.toString() });
  }

  pay.status = 'succeeded';

  // Тот же самый путь, что и для настоящего вебхука, — код не расходится.
  await confirmPayment(paymentId);

  back.searchParams.set('paid', '1');
  return sendJSON(res, 200, { return_url: back.toString() });
}


/* ---------- статика ---------- */

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return sendJSON(res, 400, { error: 'Некорректный путь' });
  }

  if (pathname === '/') pathname = '/index.html';

  // Защита от выхода за пределы папки проекта.
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) return sendJSON(res, 403, { error: 'Доступ запрещён' });

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — не найдено');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- VIP-секция: рендерится на сервере ---------- */

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch (_) { return '—'; }
};

const STATUS_RU = {
  pending: 'ожидает оплаты',
  succeeded: 'оплачен',
  canceled: 'отменён',
};

function vipLocked() {
  return `
    <div class="vip-lock reveal" data-r>
      <div class="vip-lock-in">
        <span class="sec-num">05 · закрыто</span>
        <h2 class="vip-lock-t">Раздел <em>для своих</em></h2>
        <p class="vip-lock-d">
          Здесь то, что видят только клиенты: разборы проектов, исходники,
          доступ к материалам и ранние скидки на новые услуги.
        </p>
        <div class="vip-lock-b">
          <button class="mag" type="button" data-open-cab>
            <span>Войти</span>
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M17 7H8M17 7v9"/></svg>
          </button>
          <a class="line-btn" href="#services">Оплатить услугу</a>
        </div>
        <p class="vip-lock-n">Статус «про» открывается автоматически после оплаты.</p>
      </div>
    </div>`;
}

function vipOpen(user) {
  const orders = userOrdersFor(user.email);
  const paid = orders.filter((o) => o.event === 'paid');
  const total = paid.reduce((s, o) => s + Number(o.amount || 0), 0);

  const rows = orders.length
    ? orders.map((o) => `
        <tr>
          <td>${esc(fmtDate(o.at))}</td>
          <td class="vip-td-s">${esc(o.service)}</td>
          <td class="vip-td-a">${esc(Number(o.amount).toLocaleString('ru-RU'))} ₽</td>
          <td><span class="vip-badge vip-badge-${esc(o.status)}">${esc(STATUS_RU[o.status] || o.status)}</span></td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="vip-empty">Заказов пока нет</td></tr>';

  return `
    <div class="vip-head reveal" data-r>
      <span class="sec-num">05 · для своих</span>
      <h2 class="vip-t">Добро пожаловать, <em>${esc(user.name || user.email.split('@')[0])}</em></h2>
      <p class="vip-sub">Раздел открыт, потому что вы оплатили услугу. Пользуйтесь.</p>
    </div>

    <div class="vip-grid">
      <div class="vip-card vip-card-prof reveal" data-r>
        <div class="vip-av" aria-hidden="true">${esc((user.name || user.email)[0].toUpperCase())}</div>
        <div class="vip-prof">
          <b>${esc(user.name || 'Клиент')}</b>
          <span>${esc(user.email)}</span>
          <div class="vip-tags">
            <span class="vip-badge vip-badge-pro">PRO</span>
            <span class="vip-since">с ${esc(fmtDate(user.proSince))}</span>
          </div>
        </div>
        <button class="vip-out" type="button" id="vipLogout">выйти</button>
      </div>

      <div class="vip-card vip-card-stat reveal" data-r data-rd="1">
        <b class="vip-num">${esc(paid.length)}</b>
        <span>оплат</span>
      </div>
      <div class="vip-card vip-card-stat reveal" data-r data-rd="2">
        <b class="vip-num">${esc(total.toLocaleString('ru-RU'))} ₽</b>
        <span>всего</span>
      </div>
    </div>

    <div class="vip-term reveal" data-r>
      <div class="vip-term-bar">
        <i></i><i></i><i></i>
        <span>secret_terminal — вы вошли как ${esc(user.email)}</span>
      </div>
      <div class="vip-term-body" id="vipTerm">
        <p class="vip-line">&gt; добро пожаловать, ${esc(user.name || 'друг')}. введите <b>help</b></p>
      </div>
      <form class="vip-term-in" id="vipTermForm" autocomplete="off">
        <span>&gt;</span>
        <input type="text" id="vipTermInput" aria-label="Команда" spellcheck="false" autocomplete="off">
      </form>
    </div>

    <div class="vip-orders reveal" data-r>
      <h3 class="vip-h3">История заказов</h3>
      <table class="vip-table">
        <thead><tr><th>дата</th><th>услуга</th><th>сумма</th><th>статус</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function userOrdersFor(email) {
  let rows = [];
  try {
    rows = fs.readFileSync(ORDERS_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }

  return rows
    .filter((r) => String(r.email || '').toLowerCase() === email)
    .map((r) => ({ at: r.at, service: r.service, amount: r.amount, status: r.status, event: r.event }));
}

function handleVip(req, res) {
  const user = auth.sessionCookie(req);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(user && user.pro ? vipOpen(user) : vipLocked());
}


/* ---------- API: кабинет ---------- */

const PASS_MIN = 8;

function validPass(p) {
  return typeof p === 'string' && p.length >= PASS_MIN && p.length <= 200;
}

async function authRegister(req, res) {
  let d;
  try {
    d = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    return sendJSON(res, 400, { error: 'Некорректный запрос' });
  }

  if (!auth.isEmail(d.email)) return sendJSON(res, 400, { error: 'Укажите корректную почту' });
  if (!validPass(d.password)) {
    return sendJSON(res, 400, { error: `Пароль должен быть не короче ${PASS_MIN} символов` });
  }

  try {
    const user = auth.register(d.email, d.password, d.name);
    auth.issueCookie(res, user);
    return sendJSON(res, 200, { user: auth.publicUser(user) });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message || 'Не удалось зарегистрироваться' });
  }
}

async function authLogin(req, res) {
  let d;
  try {
    d = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    return sendJSON(res, 400, { error: 'Некорректный запрос' });
  }

  try {
    const user = auth.login(d.email, d.password);
    auth.issueCookie(res, user);
    return sendJSON(res, 200, { user: auth.publicUser(user) });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message || 'Не удалось войти' });
  }
}

/** Заказы конкретного пользователя — по его почте, никому больше. */
function userOrders(req) {
  const user = auth.sessionCookie(req);
  if (!user) return [];

  let rows = [];
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
    rows = raw.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }

  return rows
    .filter((r) => String(r.email || '').toLowerCase() === user.email)
    .map((r) => ({
      at: r.at,
      service: r.service,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      event: r.event,
    }));
}

/* ---------- маршрутизация ---------- */

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  // Мок-провайдер: фейковая платёжная страница и её результат.
  let m;
  if ((m = pathname.match(/^\/mock-pay\/([\w-]+)$/)) && req.method === 'GET') {
    return handleMockPage(req, res, m[1]);
  }
  if ((m = pathname.match(/^\/api\/mock\/([\w-]+)\/(ok|fail)$/)) && req.method === 'POST') {
    return handleMockResult(req, res, m[1], m[2]).catch((e) => {
      log('!! ошибка мок-оплаты:', e.message);
      return sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' });
    });
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    return authRegister(req, res);
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    return authLogin(req, res);
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    auth.clearCookie(res);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/me' && req.method === 'GET') {
    return sendJSON(res, 200, { user: auth.publicUser(auth.sessionCookie(req)) });
  }
  if (pathname === '/api/orders' && req.method === 'GET') {
    return sendJSON(res, 200, { orders: userOrders(req) });
  }
  if (pathname === '/api/vip' && req.method === 'GET') {
    return handleVip(req, res);
  }

  if (pathname === '/api/pay' && req.method === 'POST') {
    return handleCreatePayment(req, res).catch(() =>
      sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' })
    );
  }
  if (pathname === '/api/webhook' && req.method === 'POST') {
    return handleWebhook(req, res).catch(() => sendJSON(res, 200, { ok: true }));
  }
  if (pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      mode: PAY_MODE,
      paymentConfigured: PAY_MODE === 'live' ? Boolean(SHOP_ID && SECRET_KEY) : true,
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { error: 'Метод не поддерживается' });
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  log(`сайт:   ${PUBLIC_URL}`);
  if (PAY_MODE === 'mock') {
    log('оплата: МОК-режим — реальных денег нет, ключи не нужны');
  } else if (SHOP_ID && SECRET_KEY) {
    log('оплата: ЮKassa подключена ✓');
  } else {
    log('оплата: ВНИМАНИЕ — PAY_MODE=live, но ключи не заданы');
  }
  log(`вебхук: ${PUBLIC_URL}/api/webhook`);
});

