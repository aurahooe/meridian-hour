const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const clockEl = $("clock");
const headline = $("headline");
const editorial = $("editorial");
const featureCard = $("featureCard");
const featureMeta = $("featureMeta");
const featureTitle = $("featureTitle");
const featureBody = $("featureBody");
const roomGrid = $("roomGrid");
const noteForm = $("noteForm");
const deskHint = $("deskHint");
const mine = $("mine");
const authToggle = $("authToggle");
const authDialog = $("authDialog");
const authForm = $("authForm");
const authModeBtn = $("authMode");
const handleRow = $("handleRow");
const authErr = $("authErr");
const authTitle = $("authTitle");
let mode = "signin";
let session = null;
function hourStart(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x;
}
function fmtHour(d) {
  return d.toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric" });
}
function tick() {
  const now = new Date();
  const left = 60 - now.getMinutes();
  clockEl.textContent = `${fmtHour(hourStart(now))}  ·  ${left} min left in the hour`;
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cardHTML(note, profile) {
  const who = profile?.display_name || profile?.handle || "anon";
  const handle = profile?.handle ? `@${profile.handle}` : "";
  const title = note.title?.trim() || "Untitled";
  const when = new Date(note.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<article class="card"><p class="meta">${esc(who)} ${esc(handle)} · ${esc(when)}</p><h3>${esc(title)}</h3><p>${esc(note.body)}</p></article>`;
}
async function loadRoom() {
  const { data: notes, error } = await sb.from("notes").select("id,title,body,created_at,user_id,is_public").eq("is_public", true).order("created_at", { ascending: false }).limit(48);
  if (error) { roomGrid.innerHTML = `<p class="hint">${esc(error.message)}</p>`; return []; }
  const ids = [...new Set((notes || []).map((n) => n.user_id))];
  let profiles = {};
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("id,handle,display_name").in("id", ids);
    (ps || []).forEach((p) => { profiles[p.id] = p; });
  }
  roomGrid.innerHTML = (notes || []).map((n) => cardHTML(n, profiles[n.user_id])).join("") || `<p class="hint">The room is empty. Be first.</p>`;
  return notes || [];
}
function pickFeature(notes, hour) {
  if (!notes.length) return null;
  const seed = hour.getTime();
  const idx = notes.reduce((a, n, i) => a + n.id.charCodeAt(0) * (i + 1), seed) % notes.length;
  return notes[Math.abs(idx) % notes.length];
}
async function loadHour(notes) {
  const slot = hourStart();
  const { data: hours } = await sb.from("hours").select("*").order("created_at", { ascending: false }).limit(8);
  const exact = (hours || []).find((h) => h.slot && Math.abs(new Date(h.slot) - slot) < 60 * 1000);
  const row = exact || hours?.[0];
  if (row?.headline) headline.textContent = row.headline;
  if (row?.editorial) editorial.textContent = row.editorial;
  let featured = null;
  if (row?.featured_note_id) {
    featured = notes.find((n) => n.id === row.featured_note_id);
    if (!featured) {
      const { data } = await sb.from("notes").select("*").eq("id", row.featured_note_id).maybeSingle();
      featured = data;
    }
  }
  if (!featured) featured = pickFeature(notes, slot);
  if (featured) {
    featureCard.hidden = false;
    featureTitle.textContent = featured.title?.trim() || "Untitled";
    featureBody.textContent = featured.body;
    featureMeta.textContent = "Featured this hour";
    if (!row?.headline) headline.textContent = featured.title?.trim() || "A note from the room";
    if (!row?.editorial) editorial.textContent = "No editor sat down this hour, so the room chose a public note by the clock.";
  }
}
async function loadMine() {
  if (!session) { noteForm.hidden = true; deskHint.hidden = false; mine.innerHTML = ""; return; }
  noteForm.hidden = false; deskHint.hidden = true;
  const { data } = await sb.from("notes").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false });
  mine.innerHTML = (data || []).map((n) => `<article class="card"><p class="meta">${n.is_public ? "public" : "private"} · ${new Date(n.created_at).toLocaleString()}</p><h3>${esc(n.title || "Untitled")}</h3><p>${esc(n.body)}</p><div class="row"><button type="button" class="ghost" data-toggle="${n.id}" data-public="${n.is_public}">${n.is_public ? "Make private" : "Make public"}</button><button type="button" class="ghost" data-del="${n.id}">Delete</button></div></article>`).join("");
}
async function ensureProfile(user, handle) {
  const { data } = await sb.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (data) return;
  const h = (handle || user.email.split("@")[0]).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "reader";
  await sb.from("profiles").insert({ id: user.id, handle: h + user.id.slice(0, 4), display_name: handle || user.email.split("@")[0], bio: "" });
}
async function refreshAuth() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  authToggle.textContent = session ? "Sign out" : "Sign in";
  await loadMine();
}
authToggle.addEventListener("click", async () => {
  if (session) { await sb.auth.signOut(); await refreshAuth(); return; }
  mode = "signin"; authTitle.textContent = "Sign in"; handleRow.hidden = true; authModeBtn.textContent = "Need an account"; authErr.hidden = true; authDialog.showModal();
});
authModeBtn.addEventListener("click", () => {
  mode = mode === "signin" ? "signup" : "signin";
  authTitle.textContent = mode === "signup" ? "Create a desk" : "Sign in";
  handleRow.hidden = mode !== "signup";
  authModeBtn.textContent = mode === "signup" ? "Have an account" : "Need an account";
});
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(authForm);
  const email = String(fd.get("email"));
  const password = String(fd.get("password"));
  const handle = String(fd.get("handle") || "");
  authErr.hidden = true;
  let error;
  if (mode === "signup") {
    const res = await sb.auth.signUp({ email, password, options: { data: { handle, display_name: handle } } });
    error = res.error;
    if (!error && res.data.user) await ensureProfile(res.data.user, handle);
  } else {
    const res = await sb.auth.signInWithPassword({ email, password });
    error = res.error;
  }
  if (error) { authErr.hidden = false; authErr.textContent = error.message; return; }
  authDialog.close();
  await refreshAuth();
});
noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!session) return;
  await ensureProfile(session.user);
  const fd = new FormData(noteForm);
  const { error } = await sb.from("notes").insert({ user_id: session.user.id, title: String(fd.get("title") || "").trim(), body: String(fd.get("body") || "").trim(), is_public: fd.get("is_public") === "on" });
  if (error) { deskHint.hidden = false; deskHint.textContent = error.message; return; }
  noteForm.reset(); noteForm.is_public.checked = true;
  const notes = await loadRoom(); await loadHour(notes); await loadMine();
});
mine.addEventListener("click", async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.del) await sb.from("notes").delete().eq("id", t.dataset.del);
  if (t.dataset.toggle) await sb.from("notes").update({ is_public: t.dataset.public !== "true" }).eq("id", t.dataset.toggle);
  const notes = await loadRoom(); await loadHour(notes); await loadMine();
});
sb.auth.onAuthStateChange(() => { refreshAuth(); });
tick();
setInterval(tick, 15000);
(async () => { await refreshAuth(); const notes = await loadRoom(); await loadHour(notes); })();
