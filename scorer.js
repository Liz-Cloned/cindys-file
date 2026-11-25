/*
 * scorer.js - reference window scorer for the evergreen Cindy's quiz (plain JavaScript).
 * Same rule and output as scorer.py. No dependencies; runs in a browser or Node.
 *
 *   score(rules, events, "Scorpio", "money", "2026-12-01", "America/New_York")
 *
 * rules = parsed QUIZ-RULES.json; events = EVENTS.json's "events" array.
 * tz is an IANA zone ("America/New_York", "UTC") or a fixed offset "+05:30" / "-08:00".
 * In a browser, Intl.DateTimeFormat().resolvedOptions().timeZone gives the visitor's zone.
 * Returns {date, score, events, line}; date is null for the no-event line.
 * Throws when today is outside the rules' valid range.
 *
 *   node scorer.js --test   runs TEST-CASES.json and compares every result with
 *                           TEST-RESULTS-PY.json (written by `py scorer.py --test`)
 */
"use strict";

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
var OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

function pad(n) { return (n < 10 ? "0" : "") + n; }

function localDate(ut, tz) {
  var t = new Date(ut.replace("Z", ":00Z"));
  var m = OFFSET_RE.exec(tz);
  if (m) {
    var mins = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    var s = new Date(t.getTime() + (m[1] === "+" ? mins : -mins) * 60000);
    return s.getUTCFullYear() + "-" + pad(s.getUTCMonth() + 1) + "-" + pad(s.getUTCDate());
  }
  var parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(t);
  var p = {};
  parts.forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day;
}

function addDays(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

function ordinal(n) {
  var suf = (n % 100 >= 11 && n % 100 <= 13) ? "th" : ({1: "st", 2: "nd", 3: "rd"}[n % 10] || "th");
  return n + suf;
}

function join(parts) {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + ", and " + parts[1];
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}

function fill(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, function (_, k) { return vals[k]; });
}

function phrase(rules, e, h) {
  var P = rules.templates.phrases, names = rules.body_names, bs = e.bodies;
  if (e.type === "new_moon") return fill(P.new_moon, {h: h(bs[0].sign)});
  if (e.type === "full_moon") {
    var hs = h(bs[0].sign), hm = h(bs[1].sign);
    if (hs && hm) return fill(P.full_moon_both, {h_sun: hs, h_moon: hm});
    if (hm) return fill(P.full_moon_moon, {h_moon: hm});
    return fill(P.full_moon_sun, {h_sun: hs});
  }
  if (e.type === "ingress") return fill(P.ingress, {body: names[bs[0].body], h: h(e.to_sign)});
  var ha = h(bs[0].sign), hb = h(bs[1].sign);
  var key = ha && hb ? "aspect_both" : (ha ? "aspect_a" : "aspect_b");
  return fill(P[key], {a: names[bs[0].body], b: names[bs[1].body], h_a: ha, h_b: hb,
    verb: rules.aspect_verbs[e.type]});
}

function score(rules, events, sign, area, today, tz) {
  if (today < rules.valid_today_from || today > rules.valid_today_to) {
    throw new Error("today " + today + " is outside " + rules.valid_today_from + ".." + rules.valid_today_to);
  }
  var signs = rules.signs, houses = rules.areas[area];
  function house(s) { return ((signs.indexOf(s) - signs.indexOf(sign)) % 12 + 12) % 12 + 1; }
  function h(s) { var n = house(s); return houses.indexOf(n) >= 0 ? rules.house_names[String(n)] : null; }
  var end = addDays(today, 29), byDate = {}, fallback = {};
  events.forEach(function (e) {  // EVENTS.json is in UT order
    if (!e.lands_in_signs.some(function (s) { return houses.indexOf(house(s)) >= 0; })) return;
    var d = localDate(e.ut, tz);
    var to = e.fallback ? fallback : byDate;
    if (d >= today && d <= end) (to[d] = to[d] || []).push(e);
  });
  if (!Object.keys(byDate).length) byDate = fallback;  // the Moon's angles only when no hard event lands
  var dates = Object.keys(byDate).sort();
  if (!dates.length) {
    return {date: null, score: 0, events: [], line: fill(rules.templates.no_event, {area: area})};
  }
  var best = dates[0];
  dates.forEach(function (d) { if (byDate[d].length > byDate[best].length) best = d; });
  var evs = byDate[best];
  var ymd = best.split("-");
  var dateText = MONTHS[parseInt(ymd[1], 10) - 1] + " " + ordinal(parseInt(ymd[2], 10));
  var line = fill(rules.templates.rank1, {
    date: dateText, events: join(evs.map(function (e) { return phrase(rules, e, h); }))
  });
  return {date: best, score: evs.length,
    events: evs.map(function (e) { return {id: e.id, ut: e.ut}; }), line: line};
}

if (typeof module !== "undefined") module.exports = {score: score, localDate: localDate};

if (typeof require !== "undefined" && require.main === module && process.argv.indexOf("--test") >= 0) {
  var fs = require("fs"), path = require("path");
  var rd = function (f) { return JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")); };
  var rules = rd("QUIZ-RULES.json"), events = rd("EVENTS.json").events;
  var cases = rd("TEST-CASES.json").cases, py = rd("TEST-RESULTS-PY.json").results;
  var results = [], diff = 0;
  cases.forEach(function (c, i) {
    var out;
    try { out = score(rules, events, c.sign, c.area, c.today, c.tz); }
    catch (ex) { out = {error: "outside valid range"}; }
    results.push({id: c.id, result: out});
    var same = JSON.stringify(out) === JSON.stringify(py[i].result) && py[i].id === c.id;
    if (!same) diff++;
    console.log(c.id + (same ? " same " : " DIFF ") + (out.line || out.error));
  });
  fs.writeFileSync(path.join(__dirname, "TEST-RESULTS-JS.json"),
    JSON.stringify({results: results}, null, 2) + "\n", "utf8");
  console.log((cases.length - diff) + "/" + cases.length + " identical to Python");
  process.exit(diff ? 1 : 0);
}
