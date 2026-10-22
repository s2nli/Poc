(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const batchId = new URLSearchParams(location.search).get("id") || "";
  const PW = window.PWSource;
  const ICON = {
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
  };
  const DONE_KEY = "cx-done";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const readDone = () => { const m = lsGet(DONE_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; };
  const lkey = (id) => batchId + "-" + id;

  let batch = { name: "", by: "", about: "", img: "", lang: "" };
  let subjects = [];
  let state = { tab: "classes", s: null, t: null, c: "lectures" };
  let tok = 0, filterText = "", curItems = [];

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }
  function skeleton() { $("#page").innerHTML = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>'; }
  function fail(msg, err) {
    if (err) console.error(err);
    $("#page").innerHTML = '<div class="empty">' + esc(msg) + '<div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="pill-btn solid" id="retry" type="button">Retry</button>' +
      '<a class="pill-btn" href="pw-debug.html?id=' + encodeURIComponent(batchId) + '">Debug</a></div></div>';
    const r = $("#retry"); if (r) r.addEventListener("click", () => { subjects.length ? render() : init(); });
  }

  /* ---------- state / history ---------- */
  const TABS = [["tests", "📝 Tests"], ["classes", "🎁 All Classes"], ["live", "🔴 Live Classes"], ["ann", "📣 Announcement"]];
  const CTABS = [["lectures", "Lectures"], ["dpps", "DPPs"], ["notes", "Notes"], ["dpppdf", "DPP PDFs"], ["dppvid", "DPP Videos"]];
  function readHash() {
    const g = (k) => { const m = location.hash.match(new RegExp("[#&]" + k + "=([a-z0-9]+)", "i")); return m ? m[1] : null; };
    const tab = TABS.some((x) => x[0] === g("tab")) ? g("tab") : "classes";
    const c = CTABS.some((x) => x[0] === g("c")) ? g("c") : "lectures";
    return { tab, s: g("s") !== null ? +g("s") : null, t: g("t") !== null ? +g("t") : null, c };
  }
  const hashOf = (st) => "#tab=" + st.tab + (st.s !== null ? "&s=" + st.s : "") + (st.t !== null ? "&t=" + st.t : "") + (st.t !== null ? "&c=" + st.c : "");
  function go(tab, s, t, c) {
    state = { tab, s: s === undefined ? null : s, t: t === undefined ? null : t, c: c || state.c || "lectures" };
    filterText = "";
    history.pushState(state, "", hashOf(state));
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", (e) => {
    state = e.state && e.state.tab ? Object.assign({ c: "lectures", s: null, t: null }, e.state) : readHash();
    filterText = ""; render();
  });
  $("#backBtn").addEventListener("click", () => {
    if (state.s !== null || state.tab !== "classes") { history.back(); return; }
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
    else location.href = "index.html#courses";
  });

  /* ---------- init ---------- */
  function metaFromHome() {
    try {
      const list = JSON.parse(sessionStorage.getItem("cx-batches-cache-v2") || "[]");
      const b = list.find((x) => x._id === batchId);
      if (b) batch = { name: b.name || "", by: b.byName || "", about: "", img: b.previewImage || "", lang: b.language || "" };
    } catch (e) {}
  }
  function trackRecent() {
    try {
      const k = "codex-studys-recent";
      const arr = JSON.parse(localStorage.getItem(k) || "[]").filter((x) => x._id !== batchId);
      arr.unshift({ _id: batchId, name: batch.name, byName: batch.by, language: batch.lang, previewImage: batch.img });
      localStorage.setItem(k, JSON.stringify(arr.slice(0, 8)));
    } catch (e) {}
  }
  async function init() {
    if (!/^[a-z0-9-]+$/i.test(batchId)) { fail("Batch not found."); return; }
    metaFromHome();
    $("#topTitle").textContent = batch.name || "Batch";
    state = readHash();
    history.replaceState(state, "");
    skeleton();
    try {
      const d = await PW.getBatch(batchId);
      subjects = d.subjects;
      batch.name = batch.name || d.name; batch.by = batch.by || d.by; batch.lang = batch.lang || d.language;
      batch.about = d.about; batch.img = batch.img || d.img;
    } catch (e) { fail("This batch could not be loaded. Please try again.", e); return; }
    document.title = (batch.name || "Batch") + " — CODEX STUDYS";
    trackRecent();
    render();
  }

  /* ---------- views ---------- */
  const subj = () => subjects[state.s];
  const plural = (n, a, b) => (n || 0) + " " + (n === 1 ? a : b);

  const lc = (it) => (it.title || "").toLowerCase();
  const cname = () => (CTABS.find((x) => x[0] === state.c) || [0, ""])[1];

  async function render() {
    const my = ++tok;
    const page = $("#page");
    if (state.s !== null && state.tab !== "classes") { state.s = null; state.t = null; }
    if (state.tab !== "classes" || state.s === null || !subjects[state.s]) {
      state.s = null; state.t = null;
      $("#topTitle").textContent = batch.name || "Batch";
      page.innerHTML = heroHtml() + tabsHtml();
      bindTabs();
      const body = document.createElement("div"); page.appendChild(body);
      if (state.tab === "classes") { body.innerHTML = subjectsHtml(); body.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => go("classes", +b.dataset.s))); return; }
      body.innerHTML = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div></div>';
      try {
        if (state.tab === "tests") { const l = await PW.getTests(batchId); if (my === tok) { body.innerHTML = genericHtml(l, "No tests found."); bindGeneric(body, l, (it) => { location.href = PW.testUrl(batchId, it.id); }); } }
        else if (state.tab === "live") { const l = await PW.getLive(batchId); if (my === tok) { body.innerHTML = liveHtml(l); bindGeneric(body, l, (it) => openVideo(it)); } }
        else { const l = await PW.getAnnouncements(batchId); if (my === tok) body.innerHTML = annHtml(l); }
      } catch (e) { if (my === tok) { console.error(e); body.innerHTML = '<div class="empty">Could not load this section.<div style="margin-top:12px"><button class="pill-btn solid" id="retry" type="button">Retry</button></div></div>'; const r = $("#retry"); if (r) r.addEventListener("click", render); } }
      return;
    }
    const s = subj();
    skeleton();
    let topics;
    try { topics = await PW.getChapters(batchId, s); } catch (e) { if (my === tok) fail("Chapters could not be loaded.", e); return; }
    if (my !== tok) return;
    if (state.t === null || !topics[state.t]) { state.t = null; $("#topTitle").textContent = s.name; page.innerHTML = chaptersHtml(s, topics); page.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => go("classes", state.s, +b.dataset.t, "lectures"))); return; }
    const t = topics[state.t];
    $("#topTitle").textContent = t.name;
    page.innerHTML = '<p class="crumb">' + esc(batch.name) + " › " + esc(s.name) + " › " + esc(t.name) + "</p>" + ctabsHtml() + '<div id="cbody"><div class="list"><div class="skeleton"></div><div class="skeleton"></div></div></div>';
    page.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.c !== state.c) { state.c = b.dataset.c; history.replaceState(state, "", hashOf(state)); filterText = ""; render(); } }));
    const body = $("#cbody");
    try {
      if (state.c === "dpps") {
        const l = await PW.getDpps(batchId, s, t);
        if (my !== tok) return;
        body.innerHTML = genericHtml(l, "No DPPs found.");
        bindGeneric(body, l, () => { location.href = pwChapterUrl(s, t); });
      } else {
        const items = await PW.getItems(batchId, s, t, state.c);
        if (my !== tok) return;
        body.innerHTML = (items.length > 10 ? '<input class="search" id="itemSearch" type="search" placeholder="Search…" autocomplete="off" value="' + esc(filterText) + '">' : "") + '<div class="list" id="itemList"></div>';
        bindItems(s, t, items);
      }
    } catch (e) { if (my === tok) { console.error(e); body.innerHTML = '<div class="empty">Content could not be loaded.<div style="margin-top:12px"><button class="pill-btn solid" id="retry" type="button">Retry</button></div></div>'; const r = $("#retry"); if (r) r.addEventListener("click", render); } }
  }

  function heroHtml() {
    const img = batch.img || "assets/codex-telegram.png";
    return '<div class="hero"><img class="hero-img" src="' + esc(img) + '" alt="' + esc(batch.name) + '" referrerpolicy="no-referrer" onerror="this.src=\'assets/codex-telegram.png\'">' +
      '<div class="hero-body"><h2 class="hero-title">' + esc(batch.name) + '</h2><p class="hero-sub">' + esc(batch.by) + '</p>' +
      '<div class="badges"><span class="badge accent">PW</span>' + (batch.lang ? '<span class="badge">' + esc(batch.lang) + "</span>" : "") + "</div></div></div>";
  }
  function tabsHtml() {
    return '<div class="tabs" style="overflow-x:auto;flex-wrap:nowrap">' + TABS.map((t) => '<button class="tab' + (state.tab === t[0] ? " active" : "") + '" data-tab="' + t[0] + '" type="button" style="white-space:nowrap">' + t[1] + "</button>").join("") +
      '<button class="tab" id="shareBtn" type="button" style="white-space:nowrap">🔗 Share Batch</button></div>';
  }
  function bindTabs() {
    document.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== state.tab) go(b.dataset.tab); }));
    const sh = $("#shareBtn");
    if (sh) sh.addEventListener("click", async () => {
      const url = location.origin + "/batch.html?id=" + encodeURIComponent(batchId);
      try { if (navigator.share) await navigator.share({ title: batch.name, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch (e) {}
    });
  }
  function ctabsHtml() {
    return '<div class="tabs" style="overflow-x:auto;flex-wrap:nowrap">' + CTABS.map((t) => '<button class="tab' + (state.c === t[0] ? " active" : "") + '" data-c="' + t[0] + '" type="button" style="white-space:nowrap">' + t[1] + "</button>").join("") + "</div>";
  }

  function subjectsHtml() {
    if (!subjects.length) return '<div class="list"><div class="empty">Nothing here yet.</div></div>';
    return '<div class="list">' + subjects.map((s, i) => '<button class="row chapter" type="button" data-s="' + i + '"><span class="row-main"><span class="row-name">' + esc(s.name) + "</span>" +
      '<span class="row-sub">' + (s.count ? plural(s.count, "Lecture", "Lectures") : "Chapters") + "</span></span>" + ICON.chev + "</button>").join("") + "</div>";
  }
  function pwChapterUrl(s, t) {
    return "/study/batches/" + encodeURIComponent(batchId) + "/subjects/" + encodeURIComponent(s.slug) + "/subject-topics/" + encodeURIComponent(t.slug) + "?batchSubjectId=" + encodeURIComponent(s.batchSubjectId) + "&subjectId=" + encodeURIComponent(s.subjectId) + "&chapterId=" + encodeURIComponent(t.id);
  }
  function chaptersHtml(s, topics) {
    let h = '<p class="crumb">' + esc(batch.name) + " › " + esc(s.name) + "</p>";
    return h + '<div class="list">' + (topics.length ? topics.map((t, i) => {
      const sub = [plural(t.videos, "Video", "Videos"), plural(t.exercises, "Exercise", "Exercises"), plural(t.notes, "Note", "Notes")].join(" | ");
      return '<button class="row chapter" type="button" data-t="' + i + '"><span class="row-main"><span class="row-name">' + esc(t.name) + "</span>" + '<span class="row-sub">' + esc(sub) + "</span></span>" + ICON.chev + "</button>";
    }).join("") : '<div class="empty">No chapters found.</div>') + "</div>";
  }

  function genericHtml(list, emptyMsg) {
    if (!list.length) return '<div class="list"><div class="empty">' + esc(emptyMsg) + "</div></div>";
    return '<div class="list">' + list.map((it, i) => '<button class="row chapter" type="button" data-g="' + i + '"><span class="row-main"><span class="row-name">' + esc(it.title) + "</span>" + (it.sub ? '<span class="row-sub">' + esc(it.sub) + "</span>" : "") + "</span>" + ICON.chev + "</button>").join("") + "</div>";
  }
  function bindGeneric(root, list, fn) { root.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => fn(list[+b.dataset.g]))); }
  function liveHtml(list) {
    if (!list.length) return '<div class="list"><div class="empty">No live or scheduled classes today.</div></div>';
    return '<div class="list">' + list.map((it, i) => '<button class="row chapter" type="button" data-g="' + i + '"><span class="row-main"><span class="row-name">' + (it.live ? "🔴 " : "") + esc(it.title) + "</span>" +
      '<span class="row-sub">' + esc([PW.fmtDate(it.date), it.dur].filter(Boolean).join(" • ")) + "</span></span>" + ICON.chev + "</button>").join("") + "</div>";
  }
  function annHtml(list) {
    if (!list.length) return '<div class="list"><div class="empty">No announcements.</div></div>';
    return '<div class="list">' + list.map((a) => '<div class="about-card" style="margin-bottom:12px"><h3>' + esc(a.title || "Announcement") + "</h3>" + (a.body && a.body !== a.title ? "<p>" + esc(a.body) + "</p>" : "") + (a.date ? '<p style="opacity:.6;font-size:12px">' + esc(a.date) + "</p>" : "") + "</div>").join("") + "</div>";
  }
  function openVideo(it) {
    if (!it.id) { toast("Class not available"); return; }
    location.href = PW.watchUrl(batchId, it.subjectSlug || "", it.topicSlug || "", it);
  }

  function itemRow(it, idx, n, notes) {
    if (notes) return '<div class="row item" data-n="' + n + '" role="button" tabindex="0"><span class="ico pdf" style="width:42px;height:42px;border-radius:13px">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(it.title) + '</span></span><span class="act"><button class="pill-btn solid" data-act="view" type="button">View</button><button class="pill-btn" data-act="dl" type="button">Download</button></span></div>';
    const done = !!readDone()[lkey(it.id)];
    const sub = [PW.fmtDate(it.date), it.dur].filter(Boolean).join(" • ");
    return '<div class="row item' + (done ? " done" : "") + '" data-n="' + n + '" data-id="' + esc(it.id) + '" data-num="' + (idx + 1) + '" role="button" tabindex="0"><span class="num">' + (done ? "✓" : idx + 1) + '</span><span class="row-main"><span class="row-name">' + esc(it.title) + "</span>" + (sub ? '<span class="row-sub">' + esc(sub) + "</span>" : "") + '</span><span class="play">' + ICON.play + '</span><button class="lv-chk" type="button" data-chk="' + esc(it.id) + '" aria-pressed="' + (done ? "true" : "false") + '" aria-label="Mark as complete">' + ICON.tick + "</button></div>";
  }
  function setDone(id, on, row) {
    const m = readDone(), k = lkey(id);
    if (on) m[k] = 1; else delete m[k];
    try { localStorage.setItem(DONE_KEY, JSON.stringify(m)); } catch (e) {}
    if (row) { row.classList.toggle("done", !!on); const n = row.querySelector(".num"); if (n) n.textContent = on ? "✓" : row.dataset.num; const c = row.querySelector("[data-chk]"); if (c) c.setAttribute("aria-pressed", on ? "true" : "false"); }
  }

  function bindItems(s, t, items) {
    const notes = state.c === "notes" || state.c === "dpppdf";
    const list = $("#itemList");
    const draw = () => {
      const q = filterText.trim().toLowerCase();
      const rows = [];
      items.forEach((it, idx) => { if (!q || lc(it).includes(q)) rows.push([it, idx]); });
      curItems = rows.map((r) => r[0]);
      list.innerHTML = rows.length ? rows.map(([it, idx], n) => itemRow(it, idx, n, notes)).join("") : '<div class="empty">' + (items.length ? "No results found." : "Nothing here yet.") + "</div>";
      const open = async (el, act) => {
        const it = curItems[+el.dataset.n];
        if (!it) return;
        if (notes) {
          try {
            const url = await PW.resolveNote(batchId, s, it);
            if (act === "dl") { const a = document.createElement("a"); a.href = url; a.download = ""; a.target = "_blank"; a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click(); a.remove(); toast("Download started"); }
            else window.open(url, "_blank", "noopener,noreferrer");
          } catch (e) { console.error(e); toast("Could not open this note"); }
          return;
        }
        location.href = PW.watchUrl(batchId, s.slug, t.slug, it);
      };
      list.querySelectorAll("[data-n]").forEach((el) => {
        el.addEventListener("click", (e) => {
          const c = e.target.closest("[data-chk]");
          if (c) { e.stopPropagation(); setDone(c.dataset.chk, !readDone()[lkey(c.dataset.chk)], el); return; }
          const a = e.target.closest("[data-act]");
          open(el, a ? a.dataset.act : null);
        });
        el.addEventListener("keydown", (e) => { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(el, null); } });
      });
    };
    const search = $("#itemSearch");
    if (search) search.addEventListener("input", () => { filterText = search.value; draw(); });
    draw();
  }

  init();
})();
