/* Körs INUTI Booli-sidan i appens inbyggda webbläsare, när användaren trycker "Hämta objekt".
 * Gör samma GraphQL-anrop som Boolis egen sida (www.booli.se/graphql) i användarens session.
 * Rapporterar via window.BostadsApp (Android) eller en callback (test).
 * Exporterar: BostadsFetch(config, report) där report = { progress(text), done(json), fail(text) } */
(function (root) {
  "use strict";

  const LISTING_FIELDS = `booliId objectType tenureForm streetAddress descriptiveAreaName
    latitude longitude published daysActive url
    rooms { raw } livingArea { raw } rent { raw } floor { raw }
    listPrice { raw } location { namedAreas }`;
  const SOLD_FIELDS = `booliId objectType tenureForm streetAddress descriptiveAreaName
    latitude longitude soldDate daysActive url
    soldPrice { raw } listPrice { raw }
    rooms { raw } livingArea { raw } rent { raw } floor { raw }
    location { namedAreas }`;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function gql(fetchFn, query, variables) {
    const r = await fetchFn("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) throw new Error(`Booli svarade ${r.status}`);
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error("Booli: " + j.errors.map(e => e.message).join("; "));
    return j.data;
  }

  async function resolveArea(fetchFn, name) {
    const d = await gql(fetchFn,
      "query($s: String) { areaSuggestionSearch(search: $s) { suggestions { id displayName } } }", { s: name });
    const list = (d && d.areaSuggestionSearch && d.areaSuggestionSearch.suggestions) || [];
    if (!list.length) return null;
    const n = name.toLowerCase();
    const pick = list.find(s => String(s.displayName).toLowerCase().startsWith(n) && /stockholm/i.test(s.displayName))
      || list.find(s => String(s.displayName).toLowerCase().startsWith(n))
      || list[0];
    return { name, id: String(pick.id), displayName: pick.displayName };
  }

  async function search(fetchFn, kind, areaId, filters, page, sort) {
    const fields = kind === "sold" ? SOLD_FIELDS : LISTING_FIELDS;
    const type = kind === "sold" ? "SoldProperty" : "Listing";
    const op = kind === "sold" ? "searchSold" : "searchForSale";
    const d = await gql(fetchFn,
      `query($input: SearchInput) { ${op}(input: $input) { totalCount pages result { __typename ... on ${type} { ${fields} } } } }`,
      { input: { areaId, page, ascending: false, excludeAncestors: true, facets: [], filters, sort } });
    const res = d[op] || {};
    return { pages: res.pages || 1, items: (res.result || []).filter(x => x && x.__typename === type) };
  }

  async function BostadsFetch(config, report, fetchFn) {
    fetchFn = fetchFn || root.fetch.bind(root);
    report = report || root.BostadsApp;
    const delay = config.delayMs == null ? 300 : config.delayMs;
    const c = config.criteria;
    const base = [
      { key: "objectType", value: "Lägenhet" },
      { key: "minRooms", value: String(c.minRooms) },
      { key: "minLivingArea", value: String(c.minLivingArea) },
    ];
    const out = { areas: [], forSale: [], sold: [], complete: true, errors: [] };
    try {
      const cache = config.areaIds || {};
      for (const name of config.areas) {
        report.progress(`Slår upp område: ${name}`);
        let a = cache[name];
        if (!a) { a = await resolveArea(fetchFn, name); await sleep(delay); }
        if (!a) { out.errors.push(`Hittade inget område som heter ${name}`); out.complete = false; continue; }
        out.areas.push(a);
      }
      for (const a of out.areas) {
        let page = 1, pages = 1;
        do {
          report.progress(`Till salu – ${a.name}, sida ${page}`);
          const r = await search(fetchFn, "forSale", a.id,
            base.concat([{ key: "maxListPrice", value: String(c.maxListPrice) }]), page, "");
          pages = Math.min(r.pages, config.maxPages || 20);
          out.forSale.push(...r.items);
          page++;
          await sleep(delay);
        } while (page <= pages);
        for (page = 1; page <= (config.soldPages || 3); page++) {
          report.progress(`Slutpriser – ${a.name}, sida ${page}`);
          const r = await search(fetchFn, "sold", a.id, base, page, "soldDate");
          out.sold.push(...r.items);
          await sleep(delay);
          if (page >= r.pages) break;
        }
      }
      report.done(JSON.stringify(out));
    } catch (e) {
      report.fail(String((e && e.message) || e));
    }
  }

  root.BostadsFetch = BostadsFetch;
  if (typeof module === "object" && module.exports) module.exports = { BostadsFetch };
})(typeof self !== "undefined" ? self : globalThis);
