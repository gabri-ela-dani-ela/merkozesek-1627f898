// Merkozesek 2026-2027 — SC Miercurea Ciuc / Sport Club Csíkszereda.
// Surse (numai oficiale):
//   EL: https://www.jegkorongszovetseg.hu/ersteliga/mentrend + /ersteliga/tabella (randate în browser; datele vin din API-ul paginii)
//   CN: https://frhg.ro/championships/seniori + platforma FRHG legată de acolo ("Vezi campionat"): icehockey.ro
// Ieșire: docs/data.json, docs/merkozesek.ics, docs/changes.json
// Utilizare: node build.js <outDir>   (CHROME_PATH = calea către Chrome/Edge)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'docs';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URLS = {
  elSchedule: 'https://www.jegkorongszovetseg.hu/ersteliga/mentrend',
  elStandings: 'https://www.jegkorongszovetseg.hu/ersteliga/tabella',
  frhg: 'https://frhg.ro/championships/seniori',
  frhgChamp: 'https://icehockey.ro/championship/49',
  frhgSchedule: 'https://icehockey.ro/schedule?sort1=game_date&sort2=game_time&order=asc&perPage=96&page=1',
};

// Adversari: cheie comună pentru a lega același meci din ambele campionate.
const TEAMS = [
  { key: 'GYHK', ro: 'ACSH Gheorgheni', hu: 'Gyergyói HK', re: /gheorgheni|gyergy|GYHK/i },
  { key: 'HSZA', ro: 'ACSHC Fenestela 68', hu: 'Háromszéki Ágyúsok', re: /fenestela|háromszék|HSZÁ/i },
  { key: 'BRA', ro: 'CSM Corona Brașov', hu: 'Corona Brasov', re: /corona|^BRA$/i },
  { key: 'STE', ro: 'CSA Steaua București', re: /steaua/i },
  { key: 'GAL', ro: 'CSM Galați', re: /gala[tț]i/i },
  { key: 'SAP', ro: 'ACS Sapientia U23', re: /sapientia/i },
  { key: 'SPS', ro: 'Sportul Studențesc', re: /sportul/i },
  { key: 'DEAC', hu: 'DEAC', re: /^DEAC$|debrece/i },
  { key: 'UTE', hu: 'UTE', re: /^UTE$|újpest/i },
  { key: 'DVTK', hu: 'DVTK Jegesmedvék', re: /DVTK/i },
  { key: 'DAB', hu: 'Dunaújvárosi Acélbikák', re: /^DAB$|dunaújv/i },
  { key: 'BJA', hu: 'Budapest JA HC', re: /BJA|budapest j/i },
  { key: 'FEHA', hu: 'FEHA19', re: /FEHA/i },
];
const SC_RE = /miercurea|csíkszereda|csikszereda|^SCCS$/i;
const team = (name) => TEAMS.find((t) => t.re.test(name.trim())) || { key: name, ro: name, hu: name };
const RO_MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Ora locală (Europe/Bucharest) → instant UTC, ținând cont de ora de vară.
function bucharestToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (t) => {
    const s = new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Bucharest', hourCycle: 'h23' });
    const [md, hm] = s.split(', ');
    const [M, D, Y] = md.split('/').map(Number);
    const [H, Mi] = hm.split(':').map(Number);
    return Date.UTC(Y, M - 1, D, H, Mi) - t;
  };
  return new Date(guess - off(guess - off(guess)));
}
const fmt = (date, tz) =>
  new Intl.DateTimeFormat('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const dayKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(date);

async function withPage(browser, fn) {
  const page = await browser.newPage();
  try { return await fn(page); } finally { await page.close(); }
}

// --- Erste Liga: datele exact cum le încarcă pagina oficială ---
async function fetchEL(browser) {
  const grab = (url, match) =>
    withPage(browser, async (page) => {
      let body = null;
      page.on('response', async (r) => {
        if (match(r.url())) { try { body = await r.json(); } catch {} }
      });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      for (let i = 0; i < 30 && !body; i++) await new Promise((r) => setTimeout(r, 1000));
      if (!body) throw new Error('Nu s-au primit date de la ' + url);
      return body;
    });
  const sched = await grab(URLS.elSchedule, (u) => u.includes('/v2/games-list') && u.includes('Alapszakasz'));
  const stand = await grab(URLS.elStandings, (u) => u.includes('/v2/standings'));
  const games = sched.data
    .filter((g) => SC_RE.test(g.homeTeam.shortName) || SC_RE.test(g.awayTeam.longName) || SC_RE.test(g.homeTeam.longName))
    .map((g) => {
      const home = SC_RE.test(g.homeTeam.longName) || SC_RE.test(g.homeTeam.shortName);
      const opp = home ? g.awayTeam : g.homeTeam;
      return {
        id: g.gameName.replace(' ', ''), start: new Date(g.gameDate), home, opp: team(opp.longName).key,
        oppName: opp.longName, venue: g.location?.locationName || null, tz: g.location?.timezone || 'Europe/Budapest',
        status: g.gameStatus, result: g.gameStatus ? g.result : null,
        score: g.gameStatus ? [g.homeTeamScore, g.awayTeamScore] : null,
        ot: g.isOvertime, so: g.isShootout,
        tv: g.broadcast === true, // coloana „TV Közvetítés” (televiziune), nu streamul MJSZ.TV / Erste Liga TV
      };
    });
  const standings = stand.data.map((r, i) => ({
    pos: i + 1, team: r.team.longName, sc: SC_RE.test(r.team.longName), gp: r.gamesPlayed, w: r.w, otw: r.otw + r.sow,
    otl: r.otl + r.sol, l: r.l, gf: r.gf, ga: r.ga, pts: r.points,
  }));
  return { games, standings, updated: sched.lastUpdate?.isoDate, standingsUpdated: stand.lastUpdate?.isoDate };
}

// --- CN: lista text de pe frhg.ro ---
async function fetchFRHGText(browser) {
  const text = await withPage(browser, async (page) => {
    await page.goto(URLS.frhg, { waitUntil: 'networkidle2', timeout: 90000 });
    return page.evaluate(() => document.body.innerText);
  });
  const re = /\((CN\+EL|CN)\)\s*(\d{1,2})\s+([a-zăâîșț]+)\s+(\d{4}):\s*(.+?)\s+[–-]\s+(.+?)(?:\s+(\d+)-(\d+))?\s*$/i;
  return text.split('\n').map((l) => l.trim()).map((l) => l.match(re)).filter(Boolean)
    .filter((m) => SC_RE.test(m[5]) || SC_RE.test(m[6]))
    .map((m) => {
      const home = SC_RE.test(m[5]);
      const month = RO_MONTHS.indexOf(m[3].toLowerCase()) + 1;
      return {
        both: m[1] === 'CN+EL', date: `${m[4]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`,
        home, opp: team(home ? m[6] : m[5]).key, oppName: home ? m[6] : m[5],
        score: m[7] ? [Number(m[7]), Number(m[8])] : null,
      };
    });
}

// --- CN: platforma FRHG (program cu oră, patinoar, status + clasament) ---
async function fetchFRHGPlatform(browser) {
  return withPage(browser, async (page) => {
    await page.goto(URLS.frhgChamp, { waitUntil: 'networkidle2', timeout: 90000 }); // setează campionatul 49 în sesiune
    await page.goto(URLS.frhgSchedule, { waitUntil: 'networkidle2', timeout: 90000 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('table tr')].map((tr) => [...[...tr.children].map((c) => c.innerText.trim()), tr.querySelector('a[href*="/game/"]')?.href || '']));
    const games = rows.filter((r) => /^CNM/.test(r[1] || '') && (/miercurea/i.test(r[5]) || /miercurea/i.test(r[6])))
      .map((r) => {
        const [d, mon, y] = r[2].split(' ');
        const [hh, mm] = r[3].split(':').map(Number);
        const home = /miercurea/i.test(r[5]);
        const sc = r[7].match(/(\d+)\s*-\s*(\d+)/);
        return {
          id: r[1].replace(' ', ''), start: bucharestToUtc(+y, EN_MONTHS.indexOf(mon) + 1, +d, hh, mm), home,
          opp: team(home ? r[6] : r[5]).key, oppName: home ? r[6] : r[5], venue: r[4].replace(/^Pat\.\s*/, 'Patinoarul '),
          tz: 'Europe/Bucharest', status: r[9], score: sc ? [+sc[1], +sc[2]] : null, gc: r[r.length - 1],
        };
      });
    // Hosszabbítás / büntetők: csak a Game Center oldal mutatja (harmadok: 3 = rendes, 4 = OT, 5 = SO).
    for (const g of games) {
      if (!g.score || !g.gc) continue;
      await page.goto(g.gc, { waitUntil: 'networkidle2', timeout: 90000 });
      const per = await page.evaluate(() => (document.body.innerText.match(/\d+\s*:\s*\d+\s*\n\s*\(([^)]*)\)/) || [])[1] || '');
      const n = per.split(',').filter((x) => x.trim()).length;
      g.ot = n === 4; g.so = n === 5;
    }
    await page.goto(URLS.frhgChamp, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Standings').click());
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    const st = await page.evaluate(() => [...document.querySelectorAll('table tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim())));
    const standings = st.filter((r) => r.length >= 12 && /^\d+$/.test(r[0])).map((r) => ({
      pos: +r[0], team: r[1], sc: /miercurea/i.test(r[1]), gp: +r[2], w: +r[3], otw: +r[4] + +r[5], otl: +r[6] + +r[7],
      l: +r[8], gf: +r[9], ga: +r[10], pts: +r[12],
    }));
    return { games, standings };
  });
}

const I18N = require('./i18n.js');
const INFO_FLAGS = new Set(['rescheduled']);

// Jelzések kódként: { c: kód, ...paraméterek } — a szöveg az i18n.js-ben van.
function merge(el, cnText, cn) {
  const out = [];
  const usedEL = new Set();
  const usedText = new Set();
  for (const g of cn.games) {
    const day = dayKey(g.start);
    const e = el.games.find((x) => dayKey(x.start) === day && x.opp === g.opp);
    if (e) usedEL.add(e.id);
    const ti = cnText.findIndex((t, i) => !usedText.has(i) && t.date === day && t.opp === g.opp && t.home === g.home);
    if (ti >= 0) usedText.add(ti);
    const t = cnText[ti];
    const flags = [];
    if (!t) flags.push({ c: 'notInText' });
    if (t && t.both !== !!e) flags.push({ c: t.both ? 'textBothNoEL' : 'textCNOnlyButEL' });
    if (/reschedul/i.test(g.status)) flags.push({ c: 'rescheduled' });
    if (e && Math.abs(e.start - g.start) > 60000) {
      flags.push({ c: 'timeDiff', frhg: fmt(g.start, 'Europe/Bucharest'), mjsz: `${fmt(e.start, e.tz)} ${e.tz.includes('Buda') ? 'HU' : 'RO'}` });
    }
    out.push(mk(e ? 'CN+EL' : 'CN', e || g, { cn: g, el: e, text: t, flags }));
  }
  for (const e of el.games) if (!usedEL.has(e.id)) {
    const ti = cnText.findIndex((x, i) => !usedText.has(i) && x.date === dayKey(e.start) && x.opp === e.opp);
    if (ti >= 0) usedText.add(ti);
    out.push(mk('EL', e, { el: e, flags: ti >= 0 ? [{ c: 'textHasPlatformNot' }] : [] }));
  }
  // Csak a frhg.ro szöveges listájában szereplő meccsek → ütközés az FRHG platformmal.
  cnText.forEach((t, i) => {
    if (usedText.has(i)) return;
    const [y, m, d] = t.date.split('-').map(Number);
    const base = { id: 'FRHG-' + t.date + '-' + t.opp, start: bucharestToUtc(y, m, d, 18, 30), home: t.home, opp: t.opp, oppName: t.oppName, venue: null, tz: 'Europe/Bucharest', score: t.score };
    const elSame = t.both && el.games.filter((e) => e.opp === t.opp && e.home === t.home)
      .sort((x, z) => Math.abs(x.start - base.start) - Math.abs(z.start - base.start))[0];
    const flags = [{ c: 'textOnly', both: !!t.both }, { c: 'noTime' }];
    if (elSame) flags.push({ c: 'mjszDate', date: dayKey(elSame.start) });
    out.push(mk(t.both ? 'CN+EL' : 'CN', base, { text: t, flags, timeUnknown: true }));
  });
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  // A „Rescheduled” csak tájékoztatás (a forrás maga közli), nem eltérés a források között.
  const bad = new Set(out.filter((g) => g.flags.some((f) => !INFO_FLAGS.has(f.c))).map((g) => g.day));
  for (const g of out) g.conflictDay = bad.has(g.day);
  return out;
}

function mk(comp, g, extra) {
  const t = team(g.oppName);
  const isHU = (g.tz || '').includes('Budapest');
  const score = extra.el?.score || extra.cn?.score || g.score;
  let res = null;
  if (score && (extra.el ? extra.el.status >= 1 : true)) {
    const [h, a] = score;
    const sc = g.home ? h : a, op = g.home ? a : h;
    const live = !!(extra.el && extra.el.status === 1);
    const src = extra.el || extra.cn || {};
    res = { h, a, ot: !!src.ot, so: !!src.so, outcome: live ? 'live' : sc > op ? 'W' : 'L' };
  }
  return {
    id: (extra.el ? extra.el.id : '') + (extra.cn ? (extra.el ? '+' : '') + extra.cn.id : '') || g.id,
    comp, start: g.start.toISOString(), day: dayKey(g.start), home: g.home,
    // Hivatalos nevek: EL-ben az MJSZ név, a román bajnokságban az FRHG név.
    opponent: comp === 'EL' ? t.hu || g.oppName : comp === 'CN' ? t.ro || g.oppName : `${t.hu} (${t.ro})`,
    venue: g.venue, country: isHU ? 'HU' : 'RO',
    localTime: extra.timeUnknown ? null : fmt(g.start, isHU ? 'Europe/Budapest' : 'Europe/Bucharest'),
    roTime: extra.timeUnknown ? null : fmt(g.start, 'Europe/Bucharest'),
    result: res, flags: extra.flags, tv: !!extra.el?.tv,
  };
}

const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
function flagText(f, L) {
  return fill(L.flags[f.c] || f.c, { ...f, both: f.both ? L.flags.textOnlyBoth : '' });
}
function resultText(r, L) {
  return r ? `${r.h}-${r.a}${r.so ? ' ' + L.so : r.ot ? ' ' + L.ot : ''}` : '';
}

// Zöld zászló: az a nap, amely az előző futáskor ütközéses volt, most már nem.
function trackResolved(prev, games, now) {
  const red = new Set(games.filter((g) => g.conflictDay).map((g) => g.day));
  const prevRed = new Map();
  for (const g of prev?.games || []) if (g.conflictDay) {
    if (!prevRed.has(g.day)) prevRed.set(g.day, []);
    prevRed.get(g.day).push({ id: g.id, comp: g.comp, home: g.home, opponent: g.opponent, roTime: g.roTime, flags: g.flags });
  }
  const resolved = (prev?.resolved || []).filter((r) => !red.has(r.day));
  const fresh = [];
  for (const [day, was] of prevRed) {
    if (!red.has(day) && !resolved.some((r) => r.day === day)) { const r = { day, at: now, was }; resolved.push(r); fresh.push(r); }
  }
  resolved.sort((a, b) => a.day.localeCompare(b.day));
  const green = new Set(resolved.map((r) => r.day));
  for (const g of games) g.flag = g.conflictDay ? 'red' : green.has(g.day) ? 'green' : null;
  return { resolved, fresh };
}

// --- iCalendar ---
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Sorhajtogatás 75 bájtonként (RFC 5545), UTF-8 karaktereket nem vágva ketté.
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const sig = (g) => [g.start, g.venue, g.opponent, g.home, g.comp, g.tv].join('|');
function assignSeq(data, prev) {
  const p = Object.fromEntries((prev?.games || []).map((g) => [g.id, g]));
  for (const g of data.games) {
    const o = p[g.id];
    const changed = o && (sig(o) !== sig(g) || o.flag !== g.flag);
    g.seq = o ? (changed ? (o.seq || 0) + 1 : o.seq || 0) : 0;
  }
}
function buildICS(data, lang) {
  const L = I18N[lang];
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Merkozesek//SC Csikszereda//${lang.toUpperCase()}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Merkozesek 2026-2027', 'X-WR-TIMEZONE:Europe/Bucharest', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const pos = { EL: data.standings.EL.find((r) => r.sc), CN: data.standings.CN.find((r) => r.sc) };
  for (const g of data.games) {
    const vs = g.home ? `${L.sc} – ${g.opponent}` : `${g.opponent} – ${L.sc}`;
    const res = resultText(g.result, L);
    const pre = g.flag === 'red' ? L.ics.summaryConflict : g.flag === 'green' ? L.ics.summaryResolved : '';
    const summary = `${pre}🏒 ${vs}${res ? ' ' + res : ''} [${L.compShort[g.comp]}]${g.tv ? ' 📺' : ''}`;
    const resolved = g.flag === 'green' && data.resolved.find((r) => r.day === g.day);
    const desc = [L.comp[g.comp],
      g.localTime ? `${L.ics.time}: ${g.localTime} ${g.country}${g.country === 'HU' ? ` (${g.roTime} RO)` : ''}` : L.ics.noTime,
      g.venue ? `${L.ics.venue}: ${g.venue}` : L.ics.noVenue,
      g.tv ? L.ics.tv : null,
      res ? `${L.ics.result}: ${res}` : null,
      ...['EL', 'CN'].filter((c) => g.comp.includes(c) && pos[c]).map((c) => fill(L.ics.stand, { comp: L.comp[c], ...pos[c] })),
      g.flag === 'red' ? L.ics.conflict : null,
      ...g.flags.map((f) => (INFO_FLAGS.has(f.c) ? '↻ ' : '🚩 ') + flagText(f, L)),
      resolved ? fill(L.ics.resolved, { at: resolved.at.slice(0, 10) }) : null,
      `${L.ics.updated}: ${data.generated}`].filter(Boolean).join('\n');
    const start = new Date(g.start);
    out.push('BEGIN:VEVENT', `UID:${g.id}@merkozesek-2026-2027`, `SEQUENCE:${g.seq}`, `DTSTAMP:${icsDate(data.generated)}`,
      `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(+start + 150 * 60000)}`, fold(`SUMMARY:${esc(summary)}`),
      fold(`DESCRIPTION:${esc(desc)}`), g.venue ? fold(`LOCATION:${esc(g.venue)}`) : null,
      `CATEGORIES:${g.comp}`, `COLOR:${g.comp === 'CN' ? 'white' : 'lightblue'}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT24H', fold(`DESCRIPTION:${esc(L.ics.tomorrow + vs)}`), 'END:VALARM', 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.filter(Boolean).join('\r\n') + '\r\n';
}

// --- menetrendváltozások (ntfy értesítéshez, magyarul) ---
function diff(prev, next, fresh) {
  if (!prev) return [];
  const a = Object.fromEntries(prev.games.map((g) => [g.id, g]));
  const b = Object.fromEntries(next.games.map((g) => [g.id, g]));
  const L = I18N.hu;
  const ch = [];
  const label = (g) => `${g.day} ${g.roTime ? g.roTime + ' RO' : ''} ${g.home ? 'SC – ' + g.opponent : g.opponent + ' – SC'} [${L.compShort[g.comp]}]`;
  for (const id in b) {
    if (!a[id]) ch.push('ÚJ: ' + label(b[id]));
    else if (sig(a[id]) !== sig(b[id])) ch.push(`MÓDOSULT: ${label(a[id])} → ${label(b[id])}${b[id].venue !== a[id].venue ? ' @ ' + (b[id].venue || '?') : ''}`);
    else if (!a[id].conflictDay && b[id].conflictDay && b[id].flags.length) ch.push('🚩 ÚJ ÜTKÖZÉS: ' + label(b[id]) + ' — ' + b[id].flags.map((f) => flagText(f, L)).join('; '));
  }
  for (const id in a) if (!b[id]) ch.push('TÖRÖLVE/ÁTHELYEZVE: ' + label(a[id]));
  for (const r of fresh) ch.push(`🟢 ÜTKÖZÉS MEGOLDVA: ${r.day}`);
  return ch;
}

async function readSources() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    return { el: await fetchEL(browser), cnText: await fetchFRHGText(browser), cn: await fetchFRHGPlatform(browser) };
  } finally { await browser.close(); }
}

// Dátumok visszaállítása mentett forrásadatokból (SAVE_SOURCES / LOAD_SOURCES).
function reviveSources(src) {
  for (const g of [...src.el.games, ...src.cn.games]) g.start = new Date(g.start);
  return src;
}

// config.json: { "ntfyTopic": "..." } — az értesítési téma; az oldal ebből készíti a feliratkozó gombot.
function readConfig() {
  const p = path.join(__dirname, 'config.json');
  const c = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  return { ntfyTopic: String(c.ntfyTopic || '').trim() };
}

function writeOutputs(src, prev, now) {
  const { el, cnText, cn } = src;
  if (el.games.length < 30 || cn.games.length < 10) throw new Error(`Hiányos adatok (EL ${el.games.length}, CN ${cn.games.length}) — nem írom felül.`);
  fs.mkdirSync(OUT, { recursive: true });
  const data = {
    generated: now, sources: URLS, elUpdated: el.updated, elStandingsUpdated: el.standingsUpdated, config: readConfig(),
    games: merge(el, cnText, cn), standings: { EL: el.standings, CN: cn.standings },
  };
  const { resolved, fresh } = trackResolved(prev, data.games, now);
  data.resolved = resolved;
  assignSeq(data, prev);
  const changes = diff(prev, data, fresh);
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(OUT, 'merkozesek.ics'), buildICS(data, 'hu'));
  fs.writeFileSync(path.join(OUT, 'merkozesek-en.ics'), buildICS(data, 'en'));
  fs.writeFileSync(path.join(OUT, 'changes.json'), JSON.stringify({ at: now, changes }, null, 1));
  const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const safe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  fs.copyFileSync(path.join(__dirname, 'assets', 'sccs.png'), path.join(OUT, 'icon.png'));
  fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
    name: 'Merkozesek 2026-2027', short_name: 'Merkozesek', start_url: './', display: 'standalone',
    background_color: '#ffffff', theme_color: '#425ca3', icons: [{ src: 'icon.png', sizes: '300x300', type: 'image/png', purpose: 'any' }],
  }, null, 1));
  const crest = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'sccs.png')).toString('base64');
  fs.writeFileSync(path.join(OUT, 'index.html'), tpl.replace('__DATA__', () => safe(data)).replace('__I18N__', () => safe(I18N)).replaceAll('__CREST__', crest));
  return { data, changes };
}

if (require.main === module) {
  (async () => {
    const prevPath = path.join(OUT, 'data.json');
    const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
    const src = process.env.LOAD_SOURCES ? reviveSources(JSON.parse(fs.readFileSync(process.env.LOAD_SOURCES, 'utf8'))) : await readSources();
    if (process.env.SAVE_SOURCES) fs.writeFileSync(process.env.SAVE_SOURCES, JSON.stringify(src));
    const { data, changes } = writeOutputs(src, prev, new Date().toISOString());
    console.log(`OK: ${data.games.length} meccs, ${data.games.filter((g) => g.flag === 'red').length} ütközéses napon, ${data.resolved.length} megoldott nap, ${changes.length} változás`);
    if (changes.length) console.log('CHANGES\n' + changes.join('\n'));
  })().catch((e) => { console.error(e); process.exit(1); });
}
