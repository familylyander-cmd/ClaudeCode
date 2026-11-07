const test = require("node:test");
const assert = require("node:assert");
const Core = require("../www/core.js");

const listing = (id, o = {}) => ({
  booliId: id, streetAddress: o.addr || "Testgatan 1", descriptiveAreaName: "Vasastan",
  latitude: 59.34, longitude: 18.05, postcode: o.zip || "11346",
  livingArea: { raw: o.area ?? 75, formatted: "x" }, rooms: { raw: o.rooms ?? 3 },
  listPrice: { raw: o.price ?? 12000000 }, objectType: o.type || "Lägenhet",
  url: `/annons/${id}`, published: "2026-10-01 10:00:00", ...o.extra,
});
const nextData = objs => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
  { props: { pageProps: { __APOLLO_STATE__: Object.fromEntries(objs.map(o => [`Listing:${o.booliId}`, o])) } } })}</script></html>`;

test("tolkar __NEXT_DATA__ och filtrerar på kriterier", () => {
  const items = Core.parsePage(nextData([
    listing(1), listing(2, { price: 14000000 }), listing(3, { area: 60 }),
    listing(4, { rooms: 2 }), listing(5, { zip: "12030" }), listing(6, { type: "Villa" }),
  ]));
  assert.deepStrictEqual(items.filter(i => Core.matchesCriteria(i)).map(i => i.booli_id), ["1"]);
  const one = items.find(i => i.booli_id === "1");
  assert.strictEqual(one.url, "https://www.booli.se/annons/1");
  assert.strictEqual(one.published, "2026-10-01");
});

test("tolkar Next.js flight-data (self.__next_f)", () => {
  const payload = `1:["$","div",null,{"listing":${JSON.stringify(listing(42))}}]\n`;
  const html = `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
  const items = Core.parsePage(html);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].booli_id, "42");
  assert.strictEqual(items[0].living_area, 75);
});

test("objekt sparas, säljs och statistik räknas", () => {
  const list = [];
  let r = Core.applyItems(list, Core.parsePage(nextData([listing(1), listing(2, { addr: "Annan gatan 5" })])), "2026-10-01");
  assert.strictEqual(r.added, 2);
  // Slutprissida: annat id, matchas på adress + boarea
  r = Core.applyItems(list, Core.parsePage(nextData([{ booliId: 999, streetAddress: "Testgatan 1", latitude: 59.34,
    longitude: 18.05, livingArea: 75, soldPrice: { raw: 12600000 }, soldDate: "2026-11-01" }])), "2026-11-02");
  assert.strictEqual(r.sold, 1);
  const s1 = list.find(l => l.booli_id === "1");
  assert.strictEqual(s1.status, "sold");
  assert.strictEqual(s1.sold_price, 12600000);
  const st = Core.stats(list);
  assert.deepStrictEqual(st.counts, { for_sale: 1, removed: 0, sold: 1 });
  assert.strictEqual(Math.round(st.sold.avg_diff_pct * 10) / 10, 5);
  assert.strictEqual(st.sold.median_days_to_sale, 31);
  assert.strictEqual(st.by_area[0].area, "Vasastan");
  // Sparad igen senare – utgångspris uppdateras men första utgångspris behålls
  Core.applyItems(list, Core.parsePage(nextData([listing(2, { addr: "Annan gatan 5", price: 11500000 })])));
  const s2 = list.find(l => l.booli_id === "2");
  assert.strictEqual(s2.list_price, 11500000);
  assert.strictEqual(s2.first_list_price, 12000000);
});

test("söklänk innehåller kriterierna", () => {
  const u = new URL(Core.searchUrl(false, "115355"));
  assert.strictEqual(u.searchParams.get("maxListPrice"), "13000000");
  assert.strictEqual(u.searchParams.get("minLivingArea"), "70");
  assert.strictEqual(u.searchParams.get("areaIds"), "115355");
  assert.ok(!new URL(Core.searchUrl(true, "")).searchParams.has("maxListPrice"));
});
