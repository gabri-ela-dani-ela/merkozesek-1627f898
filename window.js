// Când are rost verificarea: 07:00–23:00 ora României, sau mai târziu
// cât timp un meci SC început în ultimele 6 ore nu are încă rezultat final.
// Scrie „run=true” în GITHUB_OUTPUT dacă trebuie verificat.
const fs = require('fs');

const now = new Date();
const hm = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(now).replace(':', '');
let run = process.env.EVENT === 'workflow_dispatch' || (hm >= 700 && hm <= 2315);
let reason = run ? `ora României ${hm}` : '';

if (!run) {
  try {
    const data = JSON.parse(fs.readFileSync('docs/data.json', 'utf8'));
    const live = data.games.find((g) => {
      const age = now - Date.parse(g.start);
      const final = g.result && g.result.outcome !== 'live';
      return age > 0 && age < 6 * 3600e3 && !final;
    });
    if (live) { run = true; reason = `meci în desfășurare: ${live.day} ${live.opponent}`; }
  } catch (e) {
    run = true; reason = 'data.json lipsă sau invalid';
  }
}

console.log(run ? `Verific (${reason}).` : `Ora României ${hm} – în afara intervalului, niciun meci în desfășurare.`);
if (run && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'run=true\n');
