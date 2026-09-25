/* ==========================================================
   ВИЗИТКА — интерактив
   ========================================================== */
(function () {
  'use strict';

  const $  = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;

  /* ---------- Тост ---------- */
  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 2300);
  }

  /* ---------- 1. Прелоадер ---------- */
  const pre = $('#preloader');
  const preCount = $('#preCount');
  const preBar = $('#preBar');
  let pageStarted = false;

  function startPage() {
    if (pageStarted) return;
    pageStarted = true;
    document.body.classList.remove('is-loading');
    root.classList.add('ready');
    if (pre) {
      pre.classList.add('done');
      setTimeout(() => pre.remove(), 1000);
    }
  }

  if (pre && !REDUCED) {
    let pct = 0;
    const tick = setInterval(() => {
      pct += Math.random() * 14 + 6;
      if (pct >= 100) {
        pct = 100;
        clearInterval(tick);
        setTimeout(startPage, 260);
      }
      if (preCount) preCount.textContent = Math.round(pct);
      if (preBar) preBar.style.width = pct + '%';
    }, 110);
  } else {
    startPage();
  }
  window.addEventListener('load', () => setTimeout(startPage, 1800));

  /* ---------- 2. Тема ---------- */
  const themeBtn = $('#theme');
  const themeTxt = $('#themeTxt');

  const setTheme = (t) => {
    root.setAttribute('data-theme', t);
    if (themeTxt) themeTxt.textContent = t === 'dark' ? 'Ночь' : 'День';
    try { localStorage.setItem('vk-theme', t); } catch (e) { /* noop */ }
  };

  let saved = null;
  try { saved = localStorage.getItem('vk-theme'); } catch (e) { /* noop */ }
  setTheme(saved || 'dark');

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setTheme(next);
      toast(next === 'dark' ? 'Тёмная тема' : 'Светлая тема');
    });
  }

  /* ---------- 3. Кастомный курсор ---------- */
  const cur = $('#cursor');
  const curTxt = cur ? $('.cur-txt', cur) : null;
  const ring = cur ? $('.cur-ring', cur) : null;
  const dotEl = cur ? $('.cur-dot', cur) : null;

  if (cur && FINE) {
    let tx = 0, ty = 0, rx = 0, ry = 0;

    window.addEventListener('pointermove', (e) => {
      tx = e.clientX;
      ty = e.clientY;
      cur.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    }, { passive: true });

    (function follow() {
      rx += (tx - rx) * 0.16;
      ry += (ty - ry) * 0.16;
      const dx = (rx - tx).toFixed(2);
      const dy = (ry - ty).toFixed(2);
      if (ring) ring.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
      if (dotEl) dotEl.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
      requestAnimationFrame(follow);
    })();

    $$('[data-cursor]').forEach((el) => {
      el.addEventListener('pointerenter', () => {
        if (curTxt) curTxt.textContent = el.getAttribute('data-cursor') || '';
        cur.classList.add('is-active');
      });
      el.addEventListener('pointerleave', () => cur.classList.remove('is-active'));
    });
  }

  /* ---------- 4. Canvas: частицы со связями ---------- */
  const cv = $('#stars');

  if (cv && !REDUCED) {
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, dpr = 1;
    let dots = [];
    let mouseX = -999, mouseY = -999;

    const palette = () => {
      const dark = root.getAttribute('data-theme') === 'dark';
      return {
        dot: dark ? 'rgba(244,241,234,0.30)' : 'rgba(13,13,15,0.24)',
        line: dark ? 'rgba(244,241,234,0.07)' : 'rgba(13,13,15,0.08)',
        hi: dark ? 'rgba(232,255,77,0.9)' : 'rgba(124,92,255,0.7)'
      };
    };
    let C = palette();

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(110, Math.floor((w * h) / 17000));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.5 + 0.5
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      C = palette();

      for (let i = 0; i < dots.length; i++) {
        const p = dots[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        const dx = mouseX - p.x;
        const dy = mouseY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = dist < 150 ? C.hi : C.dot;
        ctx.fill();

        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouseX, mouseY);
          ctx.strokeStyle = C.line;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }

        for (let j = i + 1; j < dots.length; j++) {
          const q = dots[j];
          const ex = p.x - q.x, ey = p.y - q.y;
          const d = Math.sqrt(ex * ex + ey * ey);
          if (d < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = C.line;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }

    window.addEventListener('pointermove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }, { passive: true });

    window.addEventListener('resize', build);
    build();
    draw();
  } else if (cv) {
    cv.style.display = 'none';
  }

  /* ---------- 5. Горизонтальный скролл работ ---------- */
  const track = $('#hsTrack');
  const workSec = $('#work');

  if (track && workSec) {
    let maxShift = 0;

    const measure = () => {
      maxShift = Math.max(0, track.scrollWidth - window.innerWidth + 60);
      workSec.style.height = (maxShift + window.innerHeight * 0.9) + 'px';
    };

    const update = () => {
      const rect = workSec.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      track.style.transform = 'translate3d(' + (-p * maxShift) + 'px,0,0)';
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    };

    measure();
    update();
    window.addEventListener('resize', () => { measure(); update(); });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', () => { measure(); update(); });
  }

  /* ---------- 6. 3D-наклон и притяжение ---------- */
  if (FINE && !REDUCED) {
    $$('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'perspective(900px) rotateY(' + (x * 11).toFixed(2) +
          'deg) rotateX(' + (-y * 11).toFixed(2) + 'deg) translateY(-8px)';
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });

    $$('.mag').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = 'translate(' + (x * 0.22).toFixed(1) + 'px,' + (y * 0.3).toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- 7. Шапка и прогресс ---------- */
  const nav = $('#nav');
  const progBar = $('#progBar');

  const onScroll2 = () => {
    const y = window.scrollY;
    if (nav) nav.classList.toggle('solid', y > 60);
    if (progBar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progBar.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    }
  };
  window.addEventListener('scroll', onScroll2, { passive: true });
  onScroll2();

  /* ---------- 8. Мобильное меню ---------- */
  const burger = $('#burger');
  const drawer = $('#drawer');

  if (burger && drawer) {
    const closeDrawer = () => {
      burger.classList.remove('on');
      drawer.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };
    burger.addEventListener('click', () => {
      const open = !drawer.classList.contains('open');
      burger.classList.toggle('on', open);
      drawer.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $$('a', drawer).forEach((a) => a.addEventListener('click', closeDrawer));
  }

  /* ---------- 9. Плавная прокрутка ---------- */
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: top, behavior: 'smooth' });
      history.replaceState(null, '', id);
    });
  });

  /* ---------- 10. Появление блоков ---------- */
  // Вызывается повторно после подстановки VIP-раздела: свежие .reveal
  // должны подхватить ту же анимацию, что и остальной сайт.
  function observeReveals(scope) {
    const list = $$('.reveal', scope);

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          el.style.setProperty('--rdn', el.getAttribute('data-rd') || 0);
          el.classList.add('rd');
          obs.unobserve(el);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
      list.forEach((el) => io.observe(el));
    } else {
      list.forEach((el) => el.classList.add('rd'));
    }
  }

  observeReveals(document);

  /* ---------- 11. Счётчики ---------- */
  const nums = $$('[data-count]');

  const runCount = (el) => {
    const target = parseInt(el.getAttribute('data-count'), 10) || 0;
    const suffix = el.getAttribute('data-suffix') || '';
    if (REDUCED) { el.textContent = target + suffix; return; }
    const dur = 1500;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if ('IntersectionObserver' in window) {
    const numObs = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        runCount(en.target);
        obs.unobserve(en.target);
      });
    }, { threshold: 0.6 });
    nums.forEach((n) => numObs.observe(n));
  } else {
    nums.forEach(runCount);
  }

  /* ---------- 12. Копирование ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  $$('[data-copy]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (el.tagName === 'A') e.preventDefault();
      const val = el.getAttribute('data-copy');
      copyText(val)
        .then(() => toast('Скопировано: ' + val))
        .catch(() => toast('Не удалось скопировать'));
    });
  });

  /* ---------- 13. Слайдер отзывов ---------- */
  const qItems = $$('.q-item');
  const qDots = $('#qDots');
  const qPrev = $('#qPrev');
  const qNext = $('#qNext');
  let qi = 0;
  let qTimer = null;

  if (qItems.length) {
    if (qDots) {
      qItems.forEach((item, i) => {
        const dot = document.createElement('i');
        if (i === 0) dot.className = 'on';
        dot.addEventListener('click', () => goQuote(i, true));
        qDots.appendChild(dot);
      });
    }

    function goQuote(i, manual) {
      qi = (i + qItems.length) % qItems.length;
      qItems.forEach((it, k) => it.classList.toggle('is-on', k === qi));
      if (qDots) $$('i', qDots).forEach((d, k) => d.classList.toggle('on', k === qi));
      if (manual) restartAuto();
    }

    function restartAuto() {
      clearInterval(qTimer);
      if (!REDUCED) qTimer = setInterval(() => goQuote(qi + 1, false), 6500);
    }

    if (qNext) qNext.addEventListener('click', () => goQuote(qi + 1, true));
    if (qPrev) qPrev.addEventListener('click', () => goQuote(qi - 1, true));
    restartAuto();
  }

  /* ---------- 14. Форма ---------- */
  const form = $('#form');

  if (form) {
    const RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const check = (input) => {
      const v = input.value.trim();
      const bad = input.id === 'email' ? !RE.test(v) : v.length === 0;
      const wrap = input.closest('.f-f');
      if (wrap) wrap.classList.toggle('bad', bad);
      input.setAttribute('aria-invalid', bad ? 'true' : 'false');
      return !bad;
    };

    $$('input, textarea', form).forEach((input) => {
      input.addEventListener('blur', () => check(input));
      input.addEventListener('input', () => {
        const w = input.closest('.f-f');
        if (w && w.classList.contains('bad')) check(input);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputs = $$('input, textarea', form);
      const ok = inputs.map(check).every(Boolean);
      if (!ok) {
        const bad = $('.f-f.bad input, .f-f.bad textarea', form);
        if (bad) bad.focus();
        return;
      }
      toast('Заявка отправлена — скоро отвечу!');
      form.reset();
    });
  }

  /* ---------- 15. Год в подвале ---------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- 16. Оплата (ЮKassa) ---------- */
  const payModal  = $('#pay');
  const payForm   = $('#payForm');
  const payTitle  = $('#payTitle');
  const payEmail  = $('#payEmail');
  const payAmount = $('#payAmount');
  const payErr    = $('#payErr');
  const payBtns   = $$('[data-pay]');

  const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const nf = new Intl.NumberFormat('ru-RU');

  let payService = '';
  let payMin = 100;
  let lastFocus = null;

  function payClearErrors() {
    $$('.pay-f', payForm).forEach((w) => w.classList.remove('bad'));
    if (payErr) { payErr.hidden = true; payErr.textContent = ''; }
  }

  function payFail(msg) {
    if (!payErr) return;
    payErr.textContent = msg;
    payErr.hidden = false;
  }

  function payOpen(name, price) {
    if (!payModal) return;
    payService = name;
    payMin = price;
    lastFocus = document.activeElement;

    if (payTitle) payTitle.textContent = name;
    if (payAmount) {
      payAmount.value = String(price);
      payAmount.min = String(price);
    }
    payClearErrors();

    payModal.classList.add('open');
    payModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');

    const focusMe = payEmail || payAmount;
    if (focusMe) setTimeout(() => focusMe.focus(), 280);
  }

  function payClose() {
    if (!payModal) return;
    payModal.classList.remove('open');
    payModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (payBtns.length) {
    payBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        payOpen(btn.getAttribute('data-name'), Number(btn.getAttribute('data-price')) || 0);
      });
    });
  }

  if (payModal) {
    $$('[data-close]', payModal).forEach((el) =>
      el.addEventListener('click', payClose)
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && payModal.classList.contains('open')) payClose();
    });
  }

  if (payForm) {
    payForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      payClearErrors();

      const email = payEmail ? payEmail.value.trim() : '';
      const amount = payAmount ? Number(payAmount.value) : NaN;

      const emailWrap = payEmail && payEmail.closest('.pay-f');
      const amountWrap = payAmount && payAmount.closest('.pay-f');
      const emailBad = !MAIL_RE.test(email);
      const amountBad = !Number.isFinite(amount) || amount < payMin;

      if (emailWrap) emailWrap.classList.toggle('bad', emailBad);
      if (amountWrap) amountWrap.classList.toggle('bad', amountBad);
      if (emailBad || amountBad) {
        if (emailBad && payEmail) payEmail.focus();
        else if (payAmount) payAmount.focus();
        return;
      }

      // Сайт открыт как локальный файл — сервера оплаты нет.
      if (location.protocol === 'file:') {
        payFail('Оплата работает только через сервер: запустите его командой node server.js и откройте http://localhost:3000');
        return;
      }

      payForm.classList.add('loading');

      try {
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service: payService, email, amount }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          payFail(data.error || 'Не удалось создать платёж. Попробуйте позже.');
          payForm.classList.remove('loading');
          return;
        }

        if (!data.confirmation_url) {
          payFail('Платёж создан, но ссылка не получена. Напишите мне напрямую.');
          payForm.classList.remove('loading');
          return;
        }

        window.location.href = data.confirmation_url;
      } catch (err) {
        payFail('Нет связи с сервером. Проверьте, что он запущен.');
        payForm.classList.remove('loading');
      }
    });
  }

  // Возврат с платёжной страницы: ?paid=1 — оплата прошла, ?paid=0 — отмена.
  (function payReturn() {
    const q = new URLSearchParams(location.search);
    const paid = q.get('paid');
    if (paid === '1') toast('Спасибо! Оплата прошла — свяжусь с вами в течение дня.');
    else if (paid === '0') toast('Оплата отменена — ничего не списано.');
    if (paid) history.replaceState(null, '', location.pathname);
  })();



  /* ---------- 17. Кабинет, статус «про» и VIP-раздел ---------- */
  const cab    = $('#cab');
  const cabBtn = $('#cabBtn');
  const cabTxt = $('#cabTxt');
  const cabForm= $('#cabForm');
  const cabErr = $('#cabErr');
  const cabSub = $('#cabSub');
  const cabEmail = $('#cabEmail');
  const cabPass  = $('#cabPass');
  const vipEl  = $('#vip');

  let me = null;
  let cabMode = 'login';

  function cabOpen(mode) {
    if (!cab) return;
    cabMode = mode === 'reg' ? 'reg' : 'login';
    $$('.cab-tab', cab).forEach((t) =>
      t.classList.toggle('on', t.getAttribute('data-tab') === cabMode)
    );
    const nameF = $('#cabName');
    const nameWrap = nameF && nameF.closest('.cab-f');
    if (nameWrap) nameWrap.hidden = cabMode !== 'reg';
    if (cabPass) cabPass.setAttribute('autocomplete', cabMode === 'reg' ? 'new-password' : 'current-password');
    const sub = $('#cabSubmit span');
    if (sub) sub.textContent = cabMode === 'reg' ? 'Создать аккаунт' : 'Войти';
    if (cabErr) { cabErr.hidden = true; cabErr.textContent = ''; }
    $$('.cab-f', cabForm).forEach((w) => w.classList.remove('bad'));

    cab.classList.add('open');
    cab.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setTimeout(() => cabEmail && cabEmail.focus(), 260);
  }

  function cabClose() {
    if (!cab) return;
    cab.classList.remove('open');
    cab.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  function cabFail(msg) {
    if (!cabErr) return;
    cabErr.textContent = msg;
    cabErr.hidden = false;
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }, opts || {}));
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }

  /** Статус пользователя + раздел «про». */
  async function refreshMe() {
    if (location.protocol === 'file:') return;
    try {
      const { data } = await api('/api/me');
      me = data.user || null;
    } catch (_) {
      me = null;
    }
    paintCabBtn();
    await loadVip();
  }

  function paintCabBtn() {
    if (!cabBtn) return;
    cabBtn.classList.toggle('is-pro', Boolean(me && me.pro));
    if (cabTxt) cabTxt.textContent = me ? (me.pro ? 'PRO' : 'Кабинет') : 'Войти';
    // Про-тема живёт на <html>, чтобы красить весь сайт целиком.
    root.setAttribute('data-pro', me && me.pro ? '1' : '0');
  }

  async function loadVip() {
    if (!vipEl || location.protocol === 'file:') return;
    try {
      const res = await fetch('/api/vip', { credentials: 'same-origin' });
      vipEl.innerHTML = await res.text();
    } catch (_) {
      return;
    }
    observeReveals(vipEl);
    wireVip();
  }

  if (cabBtn) {
    cabBtn.addEventListener('click', () => {
      if (me) { const y = $('#vip').offsetTop - 90; window.scrollTo({ top: y, behavior: 'smooth' }); }
      else cabOpen('login');
    });
  }

  if (cab) {
    $$('[data-cab-close]', cab).forEach((el) => el.addEventListener('click', cabClose));
    $$('.cab-tab', cab).forEach((t) =>
      t.addEventListener('click', () => cabOpen(t.getAttribute('data-tab')))
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && cab.classList.contains('open')) cabClose();
    });
  }

  if (cabForm) {
    cabForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (cabErr) { cabErr.hidden = true; }

      const email = cabEmail.value.trim();
      const pass = cabPass.value;
      const nameF = $('#cabName');
      const name = nameF ? nameF.value.trim() : '';

      const emailBad = !MAIL_RE.test(email);
      const passBad = pass.length < 8;
      if (cabEmail.closest('.pay-f, .cab-f')) cabEmail.closest('.cab-f').classList.toggle('bad', emailBad);
      if (cabPass.closest('.cab-f')) cabPass.closest('.cab-f').classList.toggle('bad', passBad);
      if (emailBad || passBad) {
        cabFail('Проверьте почту: пароль от 8 символов.');
        return;
      }

      cabForm.classList.add('loading');
      const endpoint = cabMode === 'reg' ? '/api/auth/register' : '/api/auth/login';
      const payload = cabMode === 'reg' ? { email, password: pass, name } : { email, password: pass };

      try {
        const { ok, data } = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        if (!ok) {
          cabFail(data.error || 'Не получилось. Попробуйте ещё раз.');
          cabForm.classList.remove('loading');
          return;
        }
        me = data.user;
        cabClose();
        cabForm.reset();
        toast(cabMode === 'reg' ? 'Аккаунт создан!' : 'С возвращением!');
        if (cabMode === 'reg') toast('Оплатите любую услугу — и откроется раздел «про».');
        await refreshMe();
        const vip = $('#vip');
        if (vip) window.scrollTo({ top: vip.offsetTop - 90, behavior: 'smooth' });
      } catch (_) {
        cabFail('Нет связи с сервером. Запущен ли он?');
        cabForm.classList.remove('loading');
      }
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-cab]');
    if (t) cabOpen('login');
  });

  refreshMe();


  /* ---------- 18. Секретный терминал в разделе «про» ---------- */
  function wireVip() {
    const out = $('#vipTerm');
    const form = $('#vipTermForm');
    const input = $('#vipTermInput');
    const outBtn = $('#vipLogout');
    if (!out) return;

    const print = (text, kind) => {
      const p = document.createElement('p');
      p.className = 'vip-line' + (kind ? ' ' + kind : '');
      p.textContent = text;          // textContent, а не innerHTML — безопасно
      out.appendChild(p);
      out.scrollTop = out.scrollHeight;
    };

    const COMMANDS = {
      help: () => ['доступные команды:', '  whoami · status · orders · cat secret.txt · ls · exit', ''],
      whoami: () => [me ? `${me.email} · ${me.pro ? 'статус PRO' : 'обычный клиент'}` : 'вы не вошли', ''],
      status: () => [
        me && me.pro
          ? `статус: PRO (с ${new Date(me.proSince).toLocaleDateString('ru-RU')})`
          : 'статус: обычный — раздел закрыт',
        me && me.pro ? 'внимание: этот раздел вы видели потому, что оплатили услугу.' : '',
        '',
      ].filter(Boolean),
      ls: () => ['materials/  early-access/  secret.txt', ''],
      'cat secret.txt': () => [
        'вы нашли пасхалку. напишите мне в Telegram — расскажу,',
        'что дальше: ранний доступ к материалам и скидка 15% на следющий проект.',
        '',
      ],
      exit: () => ['сессия не завершена: используйте «выйти» в карточке профиля.', ''],
    };

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = input.value.trim();
        if (!raw) return;
        print(`> ${raw}`, 'vip-cmd');

        const [cmd, ...rest] = raw.split(/\s+/);
        const fn = COMMANDS[cmd.toLowerCase()];

        if (cmd.toLowerCase() === 'orders') {
          fetch('/api/orders', { credentials: 'same-origin' })
            .then((r) => r.json())
            .then(({ orders }) => {
              if (!orders || !orders.length) print('заказов пока нет', '');
              else orders.forEach((o) =>
                print(`  ${new Date(o.at).toLocaleDateString('ru-RU')} · ${o.service} · ${Number(o.amount).toLocaleString('ru-RU')} ₽ · ${o.status}`, '')
              );
              print('', '');
            })
            .catch(() => print('не удалось загрузить заказы', 'vip-err'));
        } else if (fn) {
          fn(rest).forEach((l) => print(l, ''));
        } else {
          print(`команда не найдена: ${cmd}. наберите help`, 'vip-err');
        }

        input.value = '';
      });
    }

    if (outBtn) {
      outBtn.addEventListener('click', async () => {
        await api('/api/auth/logout', { method: 'POST' });
        me = null;
        paintCabBtn();
        await loadVip();
        toast('Вы вышли из аккаунта');
      });
    }
  }




})();
