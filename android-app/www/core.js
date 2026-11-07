/* Logik utan beroenden: tolka Booli-sidor, kriterier, uppdatera objekt, statistik.
 * Fungerar både i webbläsaren (window.Core) och i Node (require) för tester. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CRITERIA = {
    minLivingArea: 70,
    minRooms: 3,
    maxListPrice: 13000000,
    // Postnummer 111–118 = Stockholms innerstad
    zipPrefixes: ["111", "112", "113", "114", "115", "116", "117", "118"],
  };

  // ---------- Tolkning ----------

  const raw = v => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const k of ["raw", "value", "amount"]) if (k in v) return v[k];
      return "formatted" in v ? v.formatted : null;
    }
    return v;
  };

  const num = v => {
    v = raw(v);
    if (v == null || typeof v === "boolean") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const m = v.replace(/[\s ]/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    }
    return null;
  };

  const first = (d, ...keys) => {
    for (const k of keys) if (d && d[k] != null && d[k] !== "") return d[k];
    return null;
  };

  const isoDate = v => {
    v = raw(v);
    if (!v) return null;
    if (typeof v === "number") return new Date(v > 1e11 ? v : v * 1000).toISOString().slice(0, 10);
    const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  };

  function* walk(node) {
    if (Array.isArray(node)) for (const v of node) yield* walk(v);
    else if (node && typeof node === "object") {
      yield node;
      for (const v of Object.values(node)) yield* walk(v);
    }
  }

  function location(d) {
    let lat = num(first(d, "latitude", "lat"));
    let lng = num(first(d, "longitude", "lng", "lon"));
    for (const key of ["location", "position", "coordinates", "point"]) {
      const sub = d[key];
      if (!sub || typeof sub !== "object") continue;
      for (const s of [sub, sub.position]) {
        if (!s || typeof s !== "object") continue;
        if (lat == null) lat = num(first(s, "latitude", "lat"));
        if (lng == null) lng = num(first(s, "longitude", "lng", "lon"));
      }
    }
    return [lat, lng];
  }

  function address(d) {
    let a = first(d, "streetAddress", "address");
    if (a && typeof a === "object") a = first(a, "streetAddress", "street", "formatted");
    if (!a && d.location && d.location.address && typeof d.location.address === "object")
      a = first(d.location.address, "streetAddress", "street");
    return a ? String(a) : null;
  }

  function areaName(d) {
    let n = first(d, "descriptiveAreaName", "areaName", "neighbourhood", "district");
    if (!n && d.location && Array.isArray(d.location.namedAreas) && d.location.namedAreas.length) {
      const x = d.location.namedAreas[0];
      n = typeof x === "string" ? x : first(x, "name");
    }
    n = raw(n);
    return n ? String(n) : null;
  }

  function zip(d) {
    let z = first(d, "postcode", "zipCode", "postalCode");
    if (z == null) {
      for (const key of ["location", "address"]) {
        const sub = d[key];
        if (!sub || typeof sub !== "object") continue;
        z = first(sub, "postcode", "zipCode", "postalCode");
        if (z == null && sub.address && typeof sub.address === "object")
          z = first(sub.address, "postcode", "zipCode", "postalCode");
        if (z) break;
      }
    }
    z = raw(z);
    return z ? String(z).replace(/\D/g, "") : null;
  }

  function normalize(d) {
    const bid = raw(first(d, "booliId", "id"));
    if (bid == null) return null;
    const [lat, lng] = location(d);
    if (lat == null || lng == null) return null;
    const soldPrice = num(first(d, "soldPrice", "finalPrice"));
    const listPrice = num(first(d, "listPrice", "price", "askingPrice"));
    if (soldPrice == null && listPrice == null) return null;
    let url = first(d, "url", "listingUrl");
    if (url && String(url).startsWith("/")) url = "https://www.booli.se" + url;
    const type = raw(first(d, "objectType", "propertyType", "type"));
    return {
      booli_id: String(bid),
      address: address(d),
      area_name: areaName(d),
      zip: zip(d),
      lat, lng,
      living_area: num(first(d, "livingArea", "area")),
      rooms: num(first(d, "rooms", "numberOfRooms")),
      floor: num(first(d, "floor")),
      rent: num(first(d, "rent", "monthlyFee", "fee")),
      object_type: type ? String(type) : null,
      list_price: listPrice,
      sold_price: soldPrice,
      sold_date: isoDate(first(d, "soldDate", "dateSold")),
      published: isoDate(first(d, "published", "publishedDate", "firstPublished")),
      url: url ? String(url) : null,
    };
  }

  /** Hittar JSON-data i sidan: __NEXT_DATA__ och/eller Next.js "flight"-data (self.__next_f). */
  function jsonRoots(html) {
    const roots = [];
    const nd = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nd) { try { roots.push(JSON.parse(nd[1])); } catch (e) { /* ignorera */ } }
    // Flight-data: self.__next_f.push([1,"..."]) – strängar med JSON inuti
    const re = /self\.__next_f\.push\(\[\d+,("(?:[^"\\]|\\.)*")\]\)/g;
    let m, text = "";
    while ((m = re.exec(html))) { try { text += JSON.parse(m[1]); } catch (e) { /* ignorera */ } }
    if (text) roots.push(...objectsAround(text, '"booliId"'));
    if (!roots.length) roots.push(...objectsAround(html, '"booliId"'));
    return roots;
  }

  /** Plockar ut de JSON-objekt som innehåller en viss nyckel ur fri text. */
  function objectsAround(text, needle) {
    const out = [];
    let pos = text.indexOf(needle);
    let guard = 0;
    while (pos !== -1 && guard++ < 5000) {
      let found = null, start = pos;
      for (let tries = 0; tries < 6; tries++) {
        start = text.lastIndexOf("{", start - 1);
        if (start < 0) break;
        const end = matchBrace(text, start);
        if (end > pos) {
          try { found = { obj: JSON.parse(text.slice(start, end + 1)), end }; break; } catch (e) { /* prova yttre */ }
        }
      }
      if (found) { out.push(found.obj); pos = text.indexOf(needle, found.end); }
      else pos = text.indexOf(needle, pos + needle.length);
    }
    return out;
  }

  function matchBrace(s, i) {
    let depth = 0, inStr = false;
    for (let j = i; j < s.length && j < i + 200000; j++) {
      const c = s[j];
      if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { if (--depth === 0) return j; }
    }
    return -1;
  }

  function parsePage(html) {
    const out = new Map();
    for (const root of jsonRoots(html)) {
      for (const node of walk(root)) {
        if (!("booliId" in node)) continue;
        const o = normalize(node);
        if (!o) continue;
        const prev = out.get(o.booli_id);
        if (!prev) out.set(o.booli_id, o);
        else for (const [k, v] of Object.entries(o)) if ((prev[k] == null || prev[k] === "") && v != null && v !== "") prev[k] = v;
      }
    }
    return [...out.values()];
  }

  // ---------- Kriterier och lagring ----------

  function matchesCriteria(o, c = CRITERIA) {
    if (o.living_area == null || o.living_area < c.minLivingArea) return false;
    if (o.rooms == null || o.rooms < c.minRooms) return false;
    if (o.list_price != null && o.list_price > c.maxListPrice) return false;
    const t = (o.object_type || "").toLowerCase();
    if (t && !t.includes("lägenhet") && !t.includes("apartment")) return false;
    if (o.zip && !c.zipPrefixes.some(p => o.zip.startsWith(p))) return false;
    return true;
  }

  const FIELDS = ["address", "area_name", "zip", "lat", "lng", "living_area", "rooms", "floor",
    "rent", "object_type", "published", "url"];
  const today = () => new Date().toISOString().slice(0, 10);
  const normAddr = a => (a || "").toLowerCase().replace(/[^a-zåäö0-9]/g, "");

  function findMatch(listings, s) {
    const byId = listings.find(l => l.booli_id === s.booli_id);
    if (byId) return byId;
    const a = normAddr(s.address);
    if (!a) return null;
    return listings.find(l => l.status !== "sold" && normAddr(l.address) === a &&
      !(s.living_area && l.living_area && Math.abs(s.living_area - l.living_area) > 2)) || null;
  }

  function markSold(l, price, date, day = today()) {
    l.status = "sold";
    l.sold_price = price;
    l.sold_date = date || l.sold_date || day;
  }

  /** Applicerar objekt från en sida på listan. Muterar listings. */
  function applyItems(listings, items, day = today()) {
    let added = 0, updated = 0, sold = 0, skipped = 0;
    for (const o of items) {
      if (o.sold_price != null) {
        const l = findMatch(listings, o);
        if (l && l.status !== "sold") { markSold(l, o.sold_price, o.sold_date, day); sold++; }
        else if (!l) skipped++;
        continue;
      }
      if (!matchesCriteria(o)) { skipped++; continue; }
      const l = listings.find(x => x.booli_id === o.booli_id);
      if (!l) {
        const n = { booli_id: o.booli_id, status: "for_sale", first_seen: day, last_seen: day,
          list_price: o.list_price, first_list_price: o.list_price, sold_price: null, sold_date: null, note: null };
        for (const f of FIELDS) n[f] = o[f] ?? null;
        listings.push(n);
        added++;
      } else {
        for (const f of FIELDS) if (o[f] != null) l[f] = o[f];
        if (o.list_price != null) l.list_price = o.list_price;
        l.last_seen = day;
        updated++;
      }
    }
    return { added, updated, sold, skipped, total: items.length };
  }

  // ---------- Statistik ----------

  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const median = a => {
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const days = (a, b) => {
    const x = Date.parse(a), y = Date.parse(b);
    return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 864e5) : null;
  };

  function stats(listings) {
    const sold = listings.filter(l => l.status === "sold" && l.sold_price);
    const out = {
      counts: {
        for_sale: listings.filter(l => l.status === "for_sale").length,
        removed: listings.filter(l => l.status === "removed").length,
        sold: sold.length,
      },
      sold: null, by_area: [], by_month: [],
    };
    if (!sold.length) return out;
    const sqm = l => (l.living_area ? l.sold_price / l.living_area : null);
    const diff = l => { const b = l.first_list_price || l.list_price; return b ? (l.sold_price / b - 1) * 100 : null; };
    const prices = sold.map(l => l.sold_price);
    const sqms = sold.map(sqm).filter(v => v);
    const diffs = sold.map(diff).filter(v => v != null);
    const ds = sold.map(l => days(l.published || l.first_seen, l.sold_date)).filter(d => d != null && d >= 0);
    out.sold = {
      avg_price: mean(prices), median_price: median(prices),
      min_price: Math.min(...prices), max_price: Math.max(...prices),
      avg_sqm_price: sqms.length ? mean(sqms) : null,
      median_sqm_price: sqms.length ? median(sqms) : null,
      avg_diff_pct: diffs.length ? mean(diffs) : null,
      share_over_list_pct: diffs.length ? 100 * diffs.filter(d => d > 0).length / diffs.length : null,
      median_days_to_sale: ds.length ? median(ds) : null,
    };
    const groups = new Map();
    for (const l of sold) {
      const k = l.area_name || "Okänt";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    out.by_area = [...groups].map(([area, ls]) => ({
      area, count: ls.length,
      median_sqm_price: (s => (s.length ? median(s) : 0))(ls.map(sqm).filter(v => v)),
      avg_diff_pct: (d => (d.length ? mean(d) : 0))(ls.map(diff).filter(v => v != null)),
    })).sort((a, b) => b.count - a.count);
    const months = new Map();
    for (const l of sold) if (l.sold_date) {
      const k = l.sold_date.slice(0, 7);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(l);
    }
    out.by_month = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, ls]) => ({
      month, count: ls.length,
      median_price: median(ls.map(l => l.sold_price)),
      median_sqm_price: (s => (s.length ? median(s) : 0))(ls.map(sqm).filter(v => v)),
    }));
    return out;
  }

  /** Söklänkar på Booli med kriterierna förifyllda. */
  function searchUrl(sold, areaId) {
    const p = new URLSearchParams({ objectType: "Lägenhet", minLivingArea: CRITERIA.minLivingArea, minRooms: CRITERIA.minRooms });
    if (areaId) p.set("areaIds", areaId);
    if (!sold) p.set("maxListPrice", CRITERIA.maxListPrice);
    return `https://www.booli.se/sok/${sold ? "slutpriser" : "till-salu"}?${p}`;
  }

  return { CRITERIA, parsePage, normalize, matchesCriteria, applyItems, markSold, findMatch, stats, searchUrl };
});
