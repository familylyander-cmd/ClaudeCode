const test = require("node:test");
const assert = require("node:assert");
const Core = require("../www/core.js");
const { BostadsFetch } = require("../www/booli-fetch.js");

// Svar formade enligt Boolis GraphQL (searchForSale / searchSold / areaSuggestionSearch)
const fv = raw => ({ __typename: "FormattedValue", raw, formatted: `${raw}` });
const listing = (id, rid, o = {}) => ({ __typename: "Listing", booliId: id, objectType: "Lägenhet",
  tenureForm: "Bostadsrätt", streetAddress: o.addr || `Gata ${id}`, descriptiveAreaName: o.area || "Vasastan",
  latitude: 59.34, longitude: 18.05, published: "2026-10-01 09:00:00", daysActive: 10, url: `/bostad/${rid}`,
  rooms: fv(o.rooms ?? 3), livingArea: fv(o.lv ?? 75), rent: fv(4500), floor: fv(2),
  listPrice: fv(o.price ?? 12000000), location: { namedAreas: [o.area || "Vasastan"] } });
const sold = (id, rid, o = {}) => ({ __typename: "SoldProperty", booliId: id, objectType: "Lägenhet",
  streetAddress: o.addr || `Gata ${id}`, descriptiveAreaName: "Vasastan", latitude: 59.34, longitude: 18.05,
  soldDate: o.date || "2026-11-01", daysActive: 25, url: `/bostad/${rid}`, soldPrice: fv(o.sp),
  listPrice: fv(o.lp ?? 12000000), rooms: fv(3), livingArea: fv(o.lv ?? 75), rent: fv(4500), floor: fv(1),
  location: { namedAreas: ["Vasastan"] } });

function mockBooli(state) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ url, query, variables });
    let data;
    if (query.includes("areaSuggestionSearch")) {
      data = { areaSuggestionSearch: { suggestions: [
        { id: 999, displayName: `${variables.s}gatan, Bromma` },
        { id: state.ids[variables.s], displayName: `${variables.s}, Stockholms kommun` }] } };
    } else {
      const op = query.includes("searchSold") ? "searchSold" : "searchForSale";
      const src = (op === "searchSold" ? state.sold : state.forSale)[variables.input.areaId] || [];
      const page = variables.input.page, size = 2;
      data = { [op]: { totalCount: src.length, pages: Math.max(1, Math.ceil(src.length / size)),
        result: [{ __typename: "Project", name: "Nyproduktion" }, ...src.slice((page - 1) * size, page * size)] } };
    }
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetchFn, calls };
}

function run(cfg, fetchFn) {
  return new Promise((resolve, reject) => BostadsFetch(cfg,
    { progress() {}, done: j => resolve(JSON.parse(j)), fail: reject }, fetchFn));
}

const cfg = { areas: ["Vasastan", "Södermalm"], areaIds: {}, criteria: Core.CRITERIA, soldPages: 3, delayMs: 0 };

test("hämtar alla sidor per område med kriterierna som filter", async () => {
  const m = mockBooli({ ids: { Vasastan: 11, "Södermalm": 22 },
    forSale: { 11: [listing(1, 101), listing(2, 102), listing(3, 103)], 22: [listing(4, 104, { area: "Södermalm" })] },
    sold: { 11: [sold(50, 150, { sp: 9000000, lp: 8500000 })] } });
  const out = await run(cfg, m.fetchFn);
  assert.deepStrictEqual(out.areas.map(a => [a.name, a.id]), [["Vasastan", "11"], ["Södermalm", "22"]]);
  assert.strictEqual(out.forSale.length, 4);           // två sidor för Vasastan, Project filtrerat bort
  assert.strictEqual(out.sold.length, 1);
  const q = m.calls.find(c => c.query.includes("searchForSale")).variables.input;
  assert.deepStrictEqual(q.filters, [
    { key: "objectType", value: "Lägenhet" }, { key: "minRooms", value: "3" },
    { key: "minLivingArea", value: "70" }, { key: "maxListPrice", value: "13000000" }]);
  assert.ok(m.calls.every(c => c.url === "/graphql"));
});

test("cachade område-id slås inte upp igen", async () => {
  const m = mockBooli({ ids: {}, forSale: {}, sold: {} });
  await run({ ...cfg, areas: ["Vasastan"], areaIds: { Vasastan: { name: "Vasastan", id: "11", displayName: "x" } } }, m.fetchFn);
  assert.ok(!m.calls.some(c => c.query.includes("areaSuggestionSearch")));
});

test("Booli-fel rapporteras", async () => {
  const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(run(cfg, fetchFn), /403/);
});

test("hela flödet: till salu → borttagen → såld (matchas på bostads-id)", () => {
  const list = [];
  let r = Core.applyFetch(list, { complete: true, errors: [],
    forSale: [listing(1, 101), listing(2, 102), listing(3, 103, { price: 14000000 })],
    sold: [sold(60, 160, { sp: 11000000, lp: 10500000, date: "2026-09-01" }),
           sold(61, 161, { sp: 15000000, lp: 14500000 })] }, "2026-10-05");
  assert.strictEqual(r.added, 2);          // 14 mkr utanför kriterierna
  assert.strictEqual(r.history, 1);        // tidigare sålt objekt inom kriterierna läggs till
  assert.strictEqual(list.length, 3);

  // Objekt 1 försvinner från till salu → borttaget
  r = Core.applyFetch(list, { complete: true, errors: [], forSale: [listing(2, 102)], sold: [] }, "2026-10-20");
  assert.strictEqual(r.removed, 1);
  assert.strictEqual(list.find(l => l.booli_id === "1").status, "removed");

  // Dyker upp som sålt med annat booliId men samma bostads-id
  r = Core.applyFetch(list, { complete: true, errors: [], forSale: [listing(2, 102)],
    sold: [sold(777, 101, { sp: 12600000, addr: "Annan adress" })] }, "2026-11-02");
  const l1 = list.find(l => l.booli_id === "1");
  assert.strictEqual(r.sold, 1);
  assert.strictEqual(l1.status, "sold");
  assert.strictEqual(l1.sold_price, 12600000);
  assert.strictEqual(l1.days_active, 25);

  const st = Core.stats(list);
  assert.deepStrictEqual(st.counts, { for_sale: 1, removed: 0, sold: 2 });
  assert.strictEqual(st.sold.median_days_to_sale, 25);
});

test("ofullständig hämtning markerar inget som borttaget", () => {
  const list = [];
  Core.applyFetch(list, { complete: true, errors: [], forSale: [listing(1, 101)], sold: [] });
  const r = Core.applyFetch(list, { complete: false, errors: ["x"], forSale: [], sold: [] });
  assert.strictEqual(r.removed, 0);
  assert.strictEqual(list[0].status, "for_sale");
});
