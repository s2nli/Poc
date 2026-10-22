/* PW source: talks to the learnxpw backend through the same-origin /api proxy (see vercel.json + api/[...path].js).
   Response shapes are read defensively; open pw-debug.html to see the raw responses if something looks empty. */
(function () {
  "use strict";
  const API = "/api";
  const enc = encodeURIComponent;

  async function get(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: "include", cache: "no-store" }, opts || {}));
    if (!r.ok) throw new Error(path + " -> HTTP " + r.status);
    return r.json();
  }

  // find the first array in a response, looking at the given keys, then at .data (nested)
  function arr(x, keys) {
    if (Array.isArray(x)) return x;
    if (!x || typeof x !== "object") return [];
    for (const k of keys || []) if (Array.isArray(x[k])) return x[k];
    if (Array.isArray(x.data)) return x.data;
    if (x.data && typeof x.data === "object") return arr(x.data, keys);
    return [];
  }
  const root = (r) => (r && r.data && !Array.isArray(r.data) ? (r.data.data && !Array.isArray(r.data.data) ? r.data.data : r.data) : r) || {};
  const str = (v) => (v == null ? "" : typeof v === "object" ? "" : String(v));
  const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };
  const img = (v) => (!v ? "" : typeof v === "string" ? v : v.baseUrl && v.key ? v.baseUrl + v.key : str(v.url));
  const strip = (s) => str(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  function fmtDur(d) {
    if (d == null || d === "") return "";
    let s;
    if (typeof d === "number" || /^\d+(\.\d+)?$/.test(String(d))) s = Math.round(+d);
    else {
      const p = String(d).split(":").map(Number);
      if (p.some(isNaN)) return String(d);
      s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
    }
    if (!s) return "";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + "h " + m + "m" : m + "m";
  }
  function fmtDate(v) {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  /* ---------- batch list (home) ---------- */
  function normBatch(e) {
    return {
      _id: str(e.batchId || e._id || e.id),
      name: str(e.batchName || e.name),
      byName: str(e.byName),
      language: str(e.language),
      previewImage: img(e.batchImage || e.previewImage),
      type: str(e.template || e.type),
      category: "pw",
      slug: str(e.slug),
      startDate: str(e.startDate),
      lectureCount: num(e.lectureCount),
      noteCount: num(e.noteCount),
      subBatches: []
    };
  }
  async function loadBatches() {
    const first = await get(API + "/AllBatches?page=1");
    let list = arr(first, ["batches"]);
    const total = Math.min(num(first.totalPages || (first.data && first.data.totalPages)) || 1, 40);
    const rest = [];
    for (let p = 2; p <= total; p++) rest.push(get(API + "/AllBatches?page=" + p).then((r) => arr(r, ["batches"])).catch(() => []));
    (await Promise.all(rest)).forEach((a) => { list = list.concat(a); });
    const seen = new Set(), out = [];
    list.map(normBatch).forEach((b) => { if (b._id && !seen.has(b._id)) { seen.add(b._id); out.push(b); } });
    return { success: true, batches: out };
  }

  /* ---------- batch -> subjects ---------- */
  function findSubjects(r) {
    const c = [r && r.subjects, r && r.data && r.data.subjects, r && r.data && r.data.data && r.data.data.subjects,
      r && r.batch && r.batch.subjects, r && r.data && r.data.batch && r.data.batch.subjects];
    for (const a of c) if (Array.isArray(a) && a.length) return a;
    if (r && Array.isArray(r.data) && r.data[0] && r.data[0].slug) return r.data;
    return [];
  }
  function normSubject(s) {
    const sid = s.subjectId && typeof s.subjectId === "object" ? s.subjectId._id : s.subjectId;
    return {
      slug: str(s.slug),
      name: str(typeof s.subject === "object" && s.subject ? s.subject.name : s.subject) || str(s.name || s.title) || "Subject",
      batchSubjectId: str(s._id),
      subjectId: str(sid),
      count: num(s.lectureCount || s.videos || s.videoCount)
    };
  }
  async function getBatch(id) {
    let best = null, lastErr = null;
    for (const t of ["details", "subjects", "batch"]) {
      try {
        const r = await get(API + "/BatchInfo?BatchId=" + enc(id) + "&Type=" + t);
        const subs = findSubjects(r);
        if (subs.length) {
          const o = root(r);
          return {
            subjects: subs.map(normSubject),
            name: str(o.name || o.batchName), by: str(o.byName), language: str(o.language),
            about: strip(o.description || o.about || o.shortDescription), img: img(o.previewImage || o.batchImage)
          };
        }
        best = best || r;
      } catch (e) { lastErr = e; }
    }
    const err = lastErr || new Error("No subjects found in the BatchInfo response");
    err.raw = best;
    throw err;
  }

  /* ---------- subject -> chapters (topics) ---------- */
  function normTopic(t) {
    return {
      slug: str(t.slug), id: str(t._id || t.id),
      name: str(t.name || t.topic || t.title) || "Chapter",
      videos: num(t.videos != null ? t.videos : t.lectureVideos != null ? t.lectureVideos : t.videoCount != null ? t.videoCount : t.lectures),
      notes: num(t.notes != null ? t.notes : t.noteCount),
      exercises: num(t.exercises)
    };
  }
  async function pagedList(urlFor, keys, maxPages) {
    const out = [], seen = new Set();
    for (let p = 1; p <= (maxPages || 15); p++) {
      const r = await get(urlFor(p));
      const a = arr(r, keys);
      let added = 0;
      a.forEach((x) => { const k = str(x && (x._id || x.id || x.slug)) || JSON.stringify(x).slice(0, 80); if (!seen.has(k)) { seen.add(k); out.push(x); added++; } });
      if (!a.length || !added) break;
    }
    return out;
  }
  async function getChapters(batchId, subject) {
    if (subject._topics) return subject._topics;
    const cands = [subject.slug, subject.subjectId, subject.batchSubjectId].filter(Boolean);
    let lastErr = null;
    for (const sid of cands) {
      try {
        const list = await pagedList((p) => API + "/SubjectInfo?BatchId=" + enc(batchId) + "&SubjectId=" + enc(sid) + "&page=" + p, ["topics"]);
        if (list.length) { subject.sid = sid; subject._topics = list.map(normTopic); return subject._topics; }
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    subject.sid = cands[0] || "";
    subject._topics = [];
    return subject._topics;
  }

  /* ---------- chapter -> lectures / notes ---------- */
  function normVideo(it) {
    const vd = it.videoDetails || {};
    return {
      id: str(it._id || it.id),
      title: str(it.topic || it.title || it.name || vd.name) || "Lecture",
      type: str(it.urlType || it.type) || "penpencilvdo",
      url: str(it.url || vd.videoUrl),
      date: str(it.date || it.createdAt || vd.createdAt),
      dur: fmtDur(vd.duration || it.duration),
      free: it.isFree === true
    };
  }
  function normNotes(it) {
    const out = [], hws = Array.isArray(it.homeworkIds) && it.homeworkIds.length ? it.homeworkIds : [it];
    hws.forEach((hw) => {
      const atts = Array.isArray(hw.attachmentIds) ? hw.attachmentIds : [];
      if (atts.length) atts.forEach((a) => out.push({ id: str(hw._id || it._id), attId: str(a._id), title: str(hw.topic || a.name || it.topic) || "Notes", url: a.baseUrl && a.key ? a.baseUrl + a.key : "" }));
      else out.push({ id: str(hw._id || it._id), attId: "", title: str(hw.topic || it.topic || it.title || it.name) || "Notes", url: str(it.url) });
    });
    return out;
  }
  async function getItems(batchId, subject, topic, kind) {
    const k = kind === "notes" ? "notes" : "videos";
    topic._items = topic._items || {};
    if (topic._items[k]) return topic._items[k];
    await getChapters(batchId, subject);
    const types = k === "notes" ? ["notes", "pdf", "pdfs"] : ["videos", "video", "lectures"];
    const tids = [topic.slug, topic.id].filter(Boolean);
    let lastErr = null, result = [];
    outer: for (const tid of tids) {
      for (const ct of types) {
        try {
          const list = await pagedList((p) => API + "/TopicInfo?BatchId=" + enc(batchId) + "&SubjectId=" + enc(subject.sid || subject.slug) + "&TopicId=" + enc(tid) + "&ContentType=" + enc(ct) + "&page=" + p, ["items", "videos", "notes"]);
          if (list.length) { result = k === "notes" ? [].concat(...list.map(normNotes)) : list.map(normVideo); break outer; }
        } catch (e) { lastErr = e; }
      }
    }
    if (!result.length && lastErr) throw lastErr;
    topic._items[k] = result;
    return result;
  }

  /* ---------- notes (pdf) ---------- */
  function firstUrl(x) {
    if (typeof x === "string") return /^https?:\/\//i.test(x) ? x : "";
    if (!x || typeof x !== "object") return "";
    for (const k of ["url", "pdfUrl", "link", "fileUrl"]) { const u = firstUrl(x[k]); if (u) return u; }
    for (const v of Object.values(x)) { const u = firstUrl(v); if (u) return u; }
    return "";
  }
  async function resolveNote(batchId, subject, note) {
    if (note.url) return note.url;
    const q = new URLSearchParams({ BatchId: batchId, SubjectId: subject.sid || subject.slug, PdfId: note.id });
    if (note.attId) q.set("AttachmentId", note.attId);
    const u = firstUrl(await get(API + "/GetPdf?" + q.toString()));
    if (!u) throw new Error("PDF link not found");
    return u;
  }

  /* ---------- learnxpw player link ---------- */
  function watchUrl(batchId, subjectSlug, topicSlug, v) {
    const q = new URLSearchParams({
      batchId: batchId, SubjectId: subjectSlug, ChildId: v.id, Type: v.type || "penpencilvdo",
      VideoUrl: (v.type || "penpencilvdo") === "penpencilvdo" ? "" : v.url || "",
      isLocked: v.free ? "false" : "true", topicId: topicSlug
    });
    return "/watch?" + q.toString();
  }

  window.PWSource = { get, loadBatches, getBatch, getChapters, getItems, resolveNote, watchUrl, fmtDur, fmtDate, API };
})();
