# Merkozesek 2026-2027

Programul SC Csíkszereda (Erste Liga + Campionatul Național), citit automat numai din sursele oficiale:
- https://www.jegkorongszovetseg.hu/ersteliga/mentrend și /ersteliga/tabella
- https://frhg.ro/championships/seniori și platforma FRHG legată de acolo (icehockey.ro)

## A. Instalare — o singură dată, de către administrator (pe laptop, ~10 minute)

1. **Cont GitHub:** https://github.com/signup (gratuit).
2. **Repository nou:** https://github.com/new
   - Nume: `merkozesek` · vizibilitate **Public** · apasă „Create repository”.
3. **Încarcă fișierele:** în repository › „uploading an existing file” › trage TOT conținutul folderului
   `C:\Users\user\Merkozesek-2026-2027` (inclusiv folderele `.github`, `assets`, `docs`) › „Commit changes”.
   (Folderul `.github` e ascuns în Windows: Explorer › Vizualizare › Afișare › Elemente ascunse.)
4. **Pagina publică:** Settings › Pages › Source: *Deploy from a branch* › Branch `main`, folder `/docs` › Save.
5. **Permisiune pentru actualizarea automată:** Settings › Actions › General › Workflow permissions: *Read and write permissions* › Save.
6. **Tema pentru alerte (ntfy):** alege un nume greu de ghicit, de ex. `merkozesek-sccs-7f3k9q`.
   Deschide `config.json` în repository (creionul de editare) și scrie: `{ "ntfyTopic": "merkozesek-sccs-7f3k9q" }` › Commit.
7. **Prima rulare:** Actions › „Actualizare program” › Run workflow.

După ~2 minute pagina e la: `https://<utilizator-github>.github.io/merkozesek/`
De atunci rulează singură la fiecare 30 de minute; laptopul nu mai trebuie să fie pornit.

## B. Pe fiecare telefon — oricine are linkul, fără cont și fără email

Deschide `https://<utilizator-github>.github.io/merkozesek/` și jos, la „Telepítés a telefonra”:
1. **Pagina ca aplicație:** iPhone (Safari): Partajare › „Adaugă pe ecranul principal”. Android (Chrome): ⋮ › „Adaugă pe ecranul de pornire”.
2. **Calendarul cu alarmă cu 24 h înainte:** butonul „iPhone naptárba” sau „Google Naptárba (Android)”.
   - iPhone: „Elimină alertele” = dezactivat.
   - Google: la setările calendarului „Merkozesek 2026-2027”, notificare implicită „1 zi înainte”.
3. **Alertă imediată la schimbarea programului:** instalează ntfy
   (iPhone: https://apps.apple.com/us/app/ntfy/id1625396347 · Android: https://play.google.com/store/apps/details?id=io.heckel.ntfy),
   apoi apasă pe pagină „Feliratkozás az értesítésekre”.

## Rulare locală
`npm install` apoi `node build.js docs` (cu `CHROME_PATH` către Chrome/Edge).
