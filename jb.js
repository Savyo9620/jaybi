/* جيبي — أدوات مشتركة لكل الصفحات */
(function () {
  const C = window.JB_CONFIG || {};
  const JB = {};
  window.JB = JB;

  JB.base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "");
  JB.param = (k) => new URLSearchParams(location.search).get(k) || "";

  JB.store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  JB.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  JB.safeColor = (c, d) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : d);
  JB.safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "");
  JB.fmt = (n) => Number(n || 0).toLocaleString("en-US");

  JB.ERR = {
    NET: "تعذّر الاتصال — تحقق من الإنترنت",
    NOT_FOUND: "هذه البطاقة غير موجودة",
    INACTIVE: "هذه البطاقة أو البرنامج موقوف",
    EXPIRED: "انتهت مدة هذا العرض",
    BAD_PIN: "الرقم السري غير صحيح",
    LOCKED: "محاولات خاطئة كثيرة — انتظر 15 دقيقة",
    EMPTY: "الرصيد لا يكفي",
    FULL: "البطاقة ممتلئة — استبدل المكافأة أولاً",
    NOT_ENOUGH: "الرصيد لا يكفي لهذه المكافأة",
    BAD_AMOUNT: "قيمة غير صالحة",
    TOO_SMALL: "المبلغ أقل من أن يعطي نقطة",
    BAD_NAME: "اكتب اسمك (حرفان على الأقل)",
    BUSY: "ضغط كبير الآن، حاول بعد قليل",
    NOTHING: "لا توجد عملية للتراجع عنها",
    TOO_OLD: "لا يمكن التراجع عن عملية مضى عليها أكثر من 24 ساعة",
    NOT_ADMIN: "هذا الحساب ليس مديراً",
    BAD_PIN_FORMAT: "الرقم السري من 4 إلى 10 أرقام",
    AUTH: "انتهت الجلسة — سجّل الدخول من جديد"
  };
  JB.err = (e) => JB.ERR[e] || "حدث خطأ غير متوقع";

  /* ---------- الاتصال بـ Supabase ---------- */
  JB.rpc = async function (fn, body, opts = {}) {
    const headers = { "Content-Type": "application/json", apikey: C.SUPABASE_KEY };
    let token = null;
    if (opts.auth) token = await JB.auth.token();
    if (token) headers.Authorization = "Bearer " + token;
    else if ((C.SUPABASE_KEY || "").startsWith("eyJ")) headers.Authorization = "Bearer " + C.SUPABASE_KEY;
    try {
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body || {}) });
      if (r.status === 401 || r.status === 403) return { ok: false, error: opts.auth ? "AUTH" : "NET" };
      if (!r.ok) return { ok: false, error: "NET" };
      return await r.json();
    } catch (e) { return { ok: false, error: "NET" }; }
  };

  /* ---------- دخول المدير ---------- */
  JB.auth = {
    KEY: "jb_admin_session",
    session() { return JB.store.get(this.KEY); },
    async login(email, password) {
      try {
        const r = await fetch(`${C.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: C.SUPABASE_KEY },
          body: JSON.stringify({ email, password })
        });
        const j = await r.json();
        if (!r.ok || !j.access_token) return { ok: false, error: j.error_description || j.msg || "بيانات الدخول غير صحيحة" };
        this.save(j);
        return { ok: true };
      } catch (e) { return { ok: false, error: JB.ERR.NET }; }
    },
    save(j) {
      JB.store.set(this.KEY, { access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), email: j.user && j.user.email });
    },
    async token() {
      const s = this.session();
      if (!s) return null;
      if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
      try {
        const r = await fetch(`${C.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: C.SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        const j = await r.json();
        if (!r.ok || !j.access_token) { this.logout(); return null; }
        this.save(j);
        return j.access_token;
      } catch (e) { return s.access_token; }
    },
    logout() { JB.store.del(this.KEY); }
  };

  JB.uploadLogo = async function (file) {
    const token = await JB.auth.token();
    if (!token) return { ok: false, error: JB.ERR.AUTH };
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    try {
      const r = await fetch(`${C.SUPABASE_URL}/storage/v1/object/jb-logos/${path}`, {
        method: "POST", headers: { apikey: C.SUPABASE_KEY, Authorization: "Bearer " + token, "Content-Type": file.type || "image/png", "x-upsert": "true" },
        body: file
      });
      if (!r.ok) return { ok: false, error: "تعذّر رفع الشعار" };
      return { ok: true, url: `${C.SUPABASE_URL}/storage/v1/object/public/jb-logos/${path}` };
    } catch (e) { return { ok: false, error: JB.ERR.NET }; }
  };

  /* ---------- واجهة ---------- */
  JB.toast = function (text, kind = "") {
    let t = document.getElementById("jb-toast");
    if (!t) { t = document.createElement("div"); t.id = "jb-toast"; document.body.appendChild(t); }
    t.textContent = text; t.className = "show " + kind;
    clearTimeout(t._h); t._h = setTimeout(() => (t.className = ""), 2800);
  };
  JB.vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  JB.CATEGORY = { restaurant: "مطعم", cafe: "كافيه", salon: "صالون", store: "متجر", other: "محل" };
  JB.KIND = { stamps: "بطاقة أختام", prepaid: "رصيد مسبق الدفع", points: "بطاقة نقاط" };

  const ICON = {
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
  };
  JB.ICON = ICON;

  JB.stampMax = (cfg) => Math.max(1, ...((cfg && cfg.rewards) || []).map((r) => +r.at || 0), 0) || 10;

  /* بطاقة الزبون بشكل المحفظة — تُستخدم في صفحة البطاقة ومعاينة لوحة الإدارة */
  JB.cardVisual = function (info, card, opts = {}) {
    const b = info.business, p = info.program, cfg = p.config || {};
    const bg = JB.safeColor(b.color_bg, "#5b1220"), fg = JB.safeColor(b.color_fg, "#ffffff"), ac = JB.safeColor(b.color_accent, "#e8c26a");
    const logo = JB.safeUrl(b.logo_url);
    const bal = card ? card.balance : 0;
    let middle = "";

    if (p.kind === "stamps") {
      const max = JB.stampMax(cfg);
      const marks = {}; (cfg.rewards || []).forEach((r) => (marks[+r.at] = r.label));
      let dots = "";
      for (let i = 1; i <= max; i++) {
        const on = i <= bal, gift = marks[i];
        dots += `<div class="jb-dot ${on ? "on" : ""} ${gift ? "gift" : ""}">${on ? ICON.check : gift ? ICON.gift : ""}</div>`;
      }
      const cols = max <= 6 ? max : max <= 10 ? Math.ceil(max / 2) : max <= 12 ? 6 : max <= 16 ? 8 : 10;
      middle = `<div class="jb-dots" style="grid-template-columns:repeat(${cols},1fr);gap:${cols > 6 ? 6 : 9}px">${dots}</div>
        <div class="jb-row"><span>الأختام</span><b>${bal} من ${max}</b></div>`;
    } else if (p.kind === "prepaid") {
      const unit = JB.esc(cfg.unit || "رصيد");
      middle = `<div class="jb-big"><b>${JB.fmt(bal)}</b><span>${unit} متبقية</span></div>`;
    } else {
      const next = (cfg.rewards || []).map((r) => +r.cost).filter((c) => c > bal).sort((a, b) => a - b)[0];
      const pct = next ? Math.min(100, Math.round((bal / next) * 100)) : 100;
      middle = `<div class="jb-big"><b>${JB.fmt(bal)}</b><span>نقطة</span></div>
        ${(cfg.rewards || []).length ? `<div class="jb-bar"><i style="width:${pct}%"></i></div>
        <div class="jb-row"><span>${next ? "المكافأة التالية عند" : "كل المكافآت متاحة"}</span><b>${next ? JB.fmt(next) : "🎉"}</b></div>` : ""}`;
    }

    const qr = card && !opts.noQr ? `<div class="jb-qr">${window.jbQR(JB.base + "card.html?k=" + card.token, { fg: "#111" })}</div>` : "";
    return `
    <div class="jb-card" style="--bg:${bg};--fg:${fg};--ac:${ac}">
      <div class="jb-card-top">
        ${logo ? `<img class="jb-logo" src="${JB.esc(logo)}" alt="">` : `<div class="jb-logo jb-logo-txt">${JB.esc((b.name || "؟").trim().charAt(0))}</div>`}
        <div class="jb-titles"><div class="jb-bname">${JB.esc(b.name)}</div><div class="jb-ptitle">${JB.esc(p.title)}</div></div>
      </div>
      <div class="jb-card-mid">${middle}</div>
      ${card ? `<div class="jb-card-foot"><div><small>الاسم</small><b>${JB.esc(card.name)}</b></div><div><small>رقم البطاقة</small><b>${String(card.number).padStart(4, "0")}</b></div></div>` : ""}
      ${qr}
    </div>`;
  };

  JB.rewardsList = function (info, balance) {
    const p = info.program, cfg = p.config || {};
    const list = cfg.rewards || [];
    if (!list.length || p.kind === "prepaid") return "";
    const key = p.kind === "stamps" ? "at" : "cost";
    const unit = p.kind === "stamps" ? "ختم" : "نقطة";
    return `<div class="jb-rewards"><h3>المكافآت</h3>${list.map((r, i) => {
      const ok = balance >= +r[key];
      return `<div class="jb-reward ${ok ? "ok" : ""}"><span class="ic">${ICON.gift}</span><span class="lb">${JB.esc(r.label)}</span><span class="ct">${JB.fmt(r[key])} ${unit}</span>${ok ? '<span class="tag">متاحة</span>' : ""}</div>`;
    }).join("")}</div>`;
  };

  /* بطاقاتي على هذا الجهاز */
  JB.myCards = {
    all() { return JB.store.get("jb_my_cards", []); },
    add(token, label) {
      const l = this.all().filter((x) => x.t !== token);
      l.unshift({ t: token, l: label, at: Date.now() });
      JB.store.set("jb_my_cards", l.slice(0, 50));
    }
  };
})();
