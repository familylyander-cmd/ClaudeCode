/* global Core, L, Chart */
"use strict";

// Visa oväntade fel i appen istället för att tyst sluta fungera
window.addEventListener("error", e => setMsg("Fel: " + e.message, true));
window.addEventListener("unhandledrejection", e => setMsg("Fel: " + (e.reason?.message || e.reason), true));

// ---------- Plattform: Capacitor på Android, annars vanlig webbläsare (för test) ----------
const Cap = window.Capacitor;
const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = name => {
  if (!native) return null;
  try { return Cap.registerPlugin(name); } catch (e) { console.error(e); return null; }
};
const Prefs = plugin("Preferences");
const Browser = plugin("BooliBrowser");
const FS = plugin("Filesystem");
const ShareP = plugin("Share");

const store = {
  async get(key) {
    if (Prefs) return (await Prefs.get({ key })).value;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  async set(key, value) {
    if (Prefs) return Prefs.set({ key, value });
    try { localStorage.setItem(key, value); } catch (e) { /* ignorera */ }
  },
};

const STATUS = { for_sale: "Till salu", sold: "Såld", removed: "Borttagen" };
const kr = v => v == null ? "–" : Math.round(v).toLocaleString("sv-SE") + " kr";
const mkr = v => v == null ? "–" : (v / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: 2 }) + " mkr";
const pct = v => v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + " %";
const num = v => v == null ? "–" : v.toLocaleString("sv-SE");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $ = id => document.getElementById(id);

let listings = [], areas = Core.AREAS.slice(), areaIds = {}, sortKey = "first_seen", sortDir = -1, map, layer, charts = {};

async function load() {
  try { listings = JSON.parse((await store.get("listings")) || "[]"); } catch (e) { listings = []; }
  try { const a = JSON.parse((await store.get("areas")) || "null"); if (Array.isArray(a) && a.length) areas = a; } catch (e) { /* standard */ }
  try { areaIds = JSON.parse((await store.get("areaIds")) || "{}") || {}; } catch (e) { areaIds = {}; }
  const c = Core.CRITERIA;
  $("crit").textContent = `Lägenhet · ≥ ${c.minLivingArea} kvm · ≥ ${c.minRooms} rum · utgångspris ≤ ${mkr(c.maxListPrice)}`;
  render();
}
const save = () => store.set("listings", JSON.stringify(listings));
function setMsg(t, err) { const m = document.getElementById("msg"); if (!m) return; m.textContent = t || ""; m.className = err ? "err" : ""; }

// ---------- Booli i inbyggd webbläsare ----------
async function handlePage(html, url) {
  let items;
  try { items = Core.parsePage(html); } catch (e) { items = []; }
  const r = Core.applyItems(listings, items);
  await save();
  render();
  const text = items.length
    ? `${r.added} nya, ${r.updated} uppdaterade, ${r.sold} sålda` + (r.skipped ? ` (${r.skipped} utanför kriterierna)` : "")
    : "Hittade inga objekt på sidan";
  setMsg(text, !items.length);
  if (Browser) Browser.showMessage({ text });
  return r;
}

// ---------- Hämtning via Booli i inbyggd webbläsare ----------
let fetchScript = null;
async function fetchConfig() {
  if (!fetchScript) fetchScript = await (await fetch("booli-fetch.js")).text();
  const cached = {};
  for (const a of areas) if (areaIds[a]) cached[a] = areaIds[a];
  return JSON.stringify({ areas, areaIds: cached, criteria: Core.CRITERIA, soldPages: 3, maxPages: 20 });
}

async function handleResult(json) {
  let result;
  try { result = JSON.parse(json); } catch (e) { setMsg("Kunde inte läsa svaret från Booli", true); return; }
  for (const a of result.areas || []) areaIds[a.name] = a;
  await store.set("areaIds", JSON.stringify(areaIds));
  const r = Core.applyFetch(listings, result);
  await save();
  render();
  const text = `${r.forSale} till salu hos Booli: ${r.added} nya, ${r.removed} borttagna. ` +
    `${r.sold} sålda med slutpris` + (r.history ? `, ${r.history} tidigare sålda tillagda` : "") +
    ((result.errors || []).length ? `. Varning: ${result.errors.join("; ")}` : "");
  setMsg(text, (result.errors || []).length > 0);
  if (Browser) Browser.showMessage({ text });
}
if (Browser) Browser.addListener("result", e => handleResult(e.json || ""));

async function updateFromBooli() {
  if (!Browser) { setMsg("Hämtning fungerar bara i Android-appen", true); return; }
  try {
    const config = await fetchConfig();
    await Browser.open({ url: "https://www.booli.se/", script: fetchScript, config,
      label: `Hämta objekt (${areas.length} områden)` });
  } catch (e) { setMsg("Kunde inte öppna Booli: " + (e.message || e), true); }
}

function openBooli(url) {
  if (Browser) Browser.open({ url }).catch(e => setMsg("Kunde inte öppna Booli: " + (e.message || e), true));
  else if (native) setMsg("Webbläsaren för Booli saknas i appen", true);
  else window.open(url, "_blank");
}


// ---------- Rendering ----------
function derived(l) {
  const base = l.first_list_price || l.list_price;
  return { ...l,
    diff: l.sold_price && base ? (l.sold_price / base - 1) * 100 : null,
    sqm: l.living_area ? (l.sold_price || l.list_price) / l.living_area : null };
}
function visible() {
  const on = [...document.querySelectorAll("#filters input:checked")].map(i => i.value);
  return listings.map(derived).filter(l => on.includes(l.status));
}
function render() {
  renderList();
  if (map) renderMap();
  if (!$("view-stats").classList.contains("hidden")) renderStats();
}
function cell(label, value, cls = "num") {
  const empty = value === "" || value === "–";
  return `<td data-l="${label}" class="${cls}${empty ? " empty-cell" : ""}">${value}</td>`;
}
function renderList() {
  const rows = visible().sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  $("emptyList").classList.toggle("hidden", listings.length > 0);
  $("tbody").innerHTML = rows.map(l => `
    <tr class="row-${l.status}">
      <td><span class="badge"><span class="dot st-${l.status}"></span>${STATUS[l.status]}</span></td>
      <td class="addr">${l.url ? `<a href="#" data-open="${esc(l.url)}">${esc(l.address || l.booli_id)}</a>` : esc(l.address || l.booli_id)}</td>
      ${cell("Område", esc(l.area_name || ""), "")}
      ${cell("Rum", num(l.rooms))}${cell("Kvm", num(l.living_area))}
      ${cell("Utgångspris", kr(l.first_list_price || l.list_price))}
      ${cell("Slutpris", kr(l.sold_price))}${cell("Diff", pct(l.diff))}
      ${cell("Kr/kvm", kr(l.sqm))}${cell("Avgift", kr(l.rent))}
      ${cell("Sparad", esc(l.first_seen), "")}${cell("Såld", esc(l.sold_date || ""), "")}
      <td class="${l.status === "sold" ? "empty-cell" : ""}">${l.status !== "sold" ? `<button data-sold="${esc(l.booli_id)}">Ange slutpris</button>` : ""}</td>
    </tr>`).join("");
}

function renderMap() {
  if (!map) {
    map = L.map("map").setView([59.334, 18.065], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap-bidragsgivare",
    }).addTo(map);
    const lg = L.control({ position: "bottomleft" });
    lg.onAdd = () => { const d = L.DomUtil.create("div");
      d.style.cssText = "background:#fff;color:#0b0b0b;padding:6px 8px;border-radius:6px;font-size:12px";
      d.innerHTML = `<div><span class="dot st-for_sale"></span> Till salu</div><div><span class="dot st-sold"></span> Såld</div><div><span class="dot st-removed"></span> Borttagen</div>`; return d; };
    lg.addTo(map);
  }
  if (layer) layer.remove();
  const color = { for_sale: css("--for-sale"), sold: css("--sold"), removed: css("--removed") };
  layer = L.layerGroup(visible().filter(l => l.lat && l.lng).map(l => L.circleMarker([l.lat, l.lng], {
    radius: 9, color: "#ffffff", weight: 2, fillColor: color[l.status], fillOpacity: 0.95,
  }).bindPopup(`<b>${esc(l.address || "")}</b><br>${esc(l.area_name || "")}<br>
      ${STATUS[l.status]} · ${num(l.rooms)} rum · ${num(l.living_area)} kvm<br>
      Utgångspris: ${kr(l.first_list_price || l.list_price)}<br>
      ${l.sold_price ? `Slutpris: ${kr(l.sold_price)} (${pct(l.diff)})<br>` : ""}
      ${l.url ? `<a href="#" data-open="${esc(l.url)}">Visa på Booli</a>` : ""}`))).addTo(map);
  setTimeout(() => map.invalidateSize(), 0);
}

function renderStats() {
  const s = Core.stats(listings), t = s.sold || {};
  const tiles = [
    ["Till salu", num(s.counts.for_sale)], ["Sålda", num(s.counts.sold)], ["Borttagna utan slutpris", num(s.counts.removed)],
    ["Medianslutpris", mkr(t.median_price)], ["Snitt slutpris", mkr(t.avg_price)],
    ["Median kr/kvm", kr(t.median_sqm_price)], ["Snitt diff mot utgångspris", pct(t.avg_diff_pct)],
    ["Andel över utgångspris", t.share_over_list_pct == null ? "–" : Math.round(t.share_over_list_pct) + " %"],
    ["Mediantid till försäljning", t.median_days_to_sale == null ? "–" : Math.round(t.median_days_to_sale) + " dagar"],
  ];
  $("tiles").innerHTML = tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("areaBody").innerHTML = s.by_area.map(a =>
    `<tr><td>${esc(a.area)}</td><td class="num">${a.count}</td><td class="num">${kr(a.median_sqm_price)}</td><td class="num">${pct(a.avg_diff_pct)}</td></tr>`).join("")
    || `<tr><td colspan="4" class="empty">Inga sålda objekt ännu.</td></tr>`;

  const sold = css("--sold");
  Chart.defaults.color = css("--text2"); Chart.defaults.borderColor = css("--border");
  const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
  const mk = (id, cfg) => { charts[id]?.destroy(); charts[id] = new Chart($(id), cfg); };
  mk("chMonth", { type: "line", data: { labels: s.by_month.map(m => m.month),
      datasets: [{ data: s.by_month.map(m => m.median_sqm_price), borderColor: sold, backgroundColor: sold, borderWidth: 2, pointRadius: 4 }] },
    options: { ...base, interaction: { mode: "index", intersect: false },
      plugins: { ...base.plugins, tooltip: { callbacks: { label: c => kr(c.parsed.y) + "/kvm" } } },
      scales: { y: { ticks: { callback: v => (v / 1000) + " tkr" } }, x: { grid: { display: false } } } } });
  mk("chArea", { type: "bar", data: { labels: s.by_area.map(a => a.area),
      datasets: [{ data: s.by_area.map(a => a.count), backgroundColor: sold, borderRadius: 4, maxBarThickness: 28 }] },
    options: { ...base, indexAxis: "y", scales: { x: { ticks: { precision: 0 } }, y: { grid: { display: false } } } } });
  const soldList = listings.map(derived).filter(l => l.status === "sold" && l.diff != null)
    .sort((a, b) => (a.sold_date || "").localeCompare(b.sold_date || ""));
  mk("chDiff", { type: "bar", data: { labels: soldList.map(l => l.address || l.booli_id),
      datasets: [{ data: soldList.map(l => l.diff), backgroundColor: sold, borderRadius: 4, maxBarThickness: 20 }] },
    options: { ...base, plugins: { ...base.plugins, tooltip: { callbacks: { label: c => pct(c.parsed.y) } } },
      scales: { x: { ticks: { display: false }, grid: { display: false } }, y: { ticks: { callback: v => v + " %" } } } } });
}

// ---------- Säkerhetskopia ----------
async function exportBackup() {
  const data = JSON.stringify({ version: 1, exported: new Date().toISOString(), listings }, null, 1);
  const name = `bostadsbevakning-${new Date().toISOString().slice(0, 10)}.json`;
  if (FS && ShareP) {
    const r = await FS.writeFile({ path: name, data, directory: "CACHE", encoding: "utf8" });
    await ShareP.share({ title: "Säkerhetskopia", url: r.uri });
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = name; a.click();
  }
}
async function importBackup(file) {
  const data = JSON.parse(await file.text());
  const incoming = Array.isArray(data) ? data : data.listings;   // datorappens /api/listings ger en lista
  if (!Array.isArray(incoming)) throw new Error("Okänt filformat");
  let added = 0, updated = 0;
  for (const l of incoming) {
    if (!l.booli_id) continue;
    const cur = listings.find(x => x.booli_id === String(l.booli_id));
    if (!cur) { listings.push({ ...l, booli_id: String(l.booli_id) }); added++; }
    else {
      for (const [k, v] of Object.entries(l)) if (v != null && cur[k] == null) cur[k] = v;   // fyll i saknade fält
      if (l.status === "sold" && l.sold_price && cur.status !== "sold") Core.markSold(cur, l.sold_price, l.sold_date);
      updated++;
    }
  }
  await save(); render();
  setMsg(`Importerade: ${added} nya, ${updated} uppdaterade`);
}

// ---------- Händelser ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === b));
  ["list", "map", "stats"].forEach(v => $("view-" + v).classList.toggle("hidden", v !== b.dataset.view));
  $("filters").classList.toggle("hidden", b.dataset.view === "stats");
  if (b.dataset.view === "map") renderMap();
  if (b.dataset.view === "stats") renderStats();
});
document.querySelectorAll("#filters input").forEach(i => i.onchange = render);
document.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
  sortDir = sortKey === th.dataset.k ? -sortDir : 1; sortKey = th.dataset.k; renderList();
});
document.addEventListener("click", e => {
  const a = e.target.closest("[data-open]");
  if (a) { e.preventDefault(); openBooli(a.dataset.open); }
});

$("booliBtn").onclick = () => $("booliDlg").showModal();
$("booliDlg").onclose = () => {
  const v = $("booliDlg").returnValue;
  if (v === "fetch") updateFromBooli();
  if (v === "home") openBooli("https://www.booli.se/");
};

function renderAreas() {
  $("areas").value = areas.join(", ");
  $("areaInfo").innerHTML = areas.map(a => areaIds[a]
    ? `${esc(a)} → ${esc(areaIds[a].displayName)} (id ${esc(areaIds[a].id)})`
    : `${esc(a)} → slås upp vid nästa hämtning`).join("<br>");
}
$("moreBtn").onclick = () => { renderAreas(); $("moreDlg").showModal(); };
$("resetAreas").onclick = e => { e.preventDefault(); areas = Core.AREAS.slice(); areaIds = {}; renderAreas(); };
$("moreDlg").onclose = async () => {
  const next = $("areas").value.split(",").map(x => x.trim()).filter(Boolean);
  if (next.length) areas = next;
  await store.set("areas", JSON.stringify(areas));
  await store.set("areaIds", JSON.stringify(areaIds));
  const v = $("moreDlg").returnValue;
  try {
    if (v === "export") await exportBackup();
    if (v === "import") $("importFile").click();
  } catch (e) { setMsg(String(e.message || e), true); }
};
$("importFile").onchange = async e => {
  try { if (e.target.files[0]) await importBackup(e.target.files[0]); }
  catch (err) { setMsg("Import misslyckades: " + (err.message || err), true); }
  e.target.value = "";
};

let soldId = null;
$("tbody").addEventListener("click", e => {
  const id = e.target.dataset?.sold; if (!id) return;
  soldId = id; const l = listings.find(x => x.booli_id === id);
  $("soldAddr").textContent = l.address || id;
  $("soldPrice").value = ""; $("soldDate").value = new Date().toISOString().slice(0, 10);
  $("soldDlg").showModal();
});
$("soldDlg").onclose = async () => {
  const price = $("soldPrice").value;
  if ($("soldDlg").returnValue !== "ok" || !price) return;
  Core.markSold(listings.find(x => x.booli_id === soldId), Number(price), $("soldDate").value || null);
  await save(); render();
};

// Exponeras för test i vanlig webbläsare
window.__app = { handlePage, handleResult, fetchConfig, get listings() { return listings; } };
load();
