# Arena Prietenilor

Aplicație de jocuri pentru gașca ta, gândită pentru telefon.

**Jocuri 1 la 1:** X și 0, X și 0 Quiz, 4 în linie, Spânzurătoarea, Bătălia navală.
**Jocuri de grup:** Quiz (10 niveluri × 20 de întrebări), Cine e cel mai amuzant (3–10 jucători, 30 de întrebări) și varianta 18+.
**Extra:** mascote personalizate, vot secret pentru jucătorul săptămânii, clasament săptămânal resetabil de admin.

## Cine e cel mai amuzant
- **Desfășurare:** organizatorul pornește jocul când sunt cel puțin 3 jucători (maxim 10).
- **Runda:** la fiecare întrebare toți scriu un răspuns în 60 de secunde. Apoi răspunsurile apar anonim și fiecare votează în 30 de secunde cel mai amuzant (nu pe al lui). Câștigă runda cine are cele mai multe voturi.
- **Final:** după 30 de întrebări, sau când organizatorul apasă „Închei”, câștigă cine a strâns cele mai multe voturi în total.
- **Varianta 18+:** are întrebări vulgare și cere confirmarea vârstei.
- **Întrebări noi:** le adaugi în `party-prompts.js`.

## Bătălia navală
Tablă 8×8, cu navele de 4, 3, 3, 2 și 2. Navele se așază singure, iar cu „Amestecă” le rearanjezi până îți place. Când lovești o navă, mai tragi o dată.

## Jucătorul săptămânii
Fiecare votează secret pe cineva din gașcă, în fila **Vot**. Votul se poate schimba până duminică seara. Luni, fiecare jucător vede la prima intrare o notificare cu câștigătorul.

## Mascote
La prima intrare, fiecare jucător își construiește mascota: formă, culoare, ochi, gură și accesoriu. Mascota apare peste tot în aplicație și se poate schimba din fila **Eu**.

## Clasament
Victorie 3 p, remiză 1 p. La jocurile de grup, locurile 1, 2 și 3 primesc 3, 2 și 1 p, iar ultimul loc nu primește puncte. Abandonul sau o deconectare mai lungă de 30 de secunde contează ca înfrângere. Clasamentul pornește de la zero în fiecare luni. Ca admin, îl poți reseta oricând din fila **Clasament** (butonul de jos).

## Conturi
- **Primul cont** creat pe site devine administrator. După aceea, nimeni nu-și mai poate face cont singur.
- **Conturile prietenilor** le creezi tu, din fila **Admin**, secțiunea Jucători. Scrii numele, iar parola se generează automat (sau scrii tu una). Apeși **Copiază mesajul** și i-l trimiți în privat: conține linkul, numele și parola.
- **Parolă uitată:** din același loc dai **Parolă nouă**. Prietenul e delogat de peste tot și intră cu parola nouă.
- **Schimbarea parolei:** fiecare își poate schimba singur parola apăsând pe numele lui, sus.
- **Înscriere liberă:** dacă vrei totuși ca oricine să-și poată face cont, setezi în Render `ALLOW_SIGNUP=true`.

## Pornire pe calculator (test)
```
npm install
npm start
```
Deschide http://localhost:3000. Fără `DATABASE_URL`, datele se salvează în `data.json`.

## Publicare online (Render + Neon, gratuit)

1. **Baza de date.** Fă cont pe https://neon.tech, creează un proiect și copiază „connection string” (începe cu `postgresql://`). Tabelele se creează singure la prima pornire.
2. **GitHub.** Urcă folderul într-un repo nou, fără `node_modules`.
3. **Render.** Alege New → Web Service, apoi repo-ul tău.
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - La Environment adaugi `DATABASE_URL` cu linkul de la Neon.
   - Opțional, adaugi `ADMIN_NAMES` cu numele administratorilor, separate prin virgulă (ex. `Ana,Mihai`). Dacă nu îl setezi, administrator e primul cont creat, așa că fă-ți tu contul primul.
4. **Prietenii.** Trimite-le linkul `https://numele-tau.onrender.com`.

Pe planul gratuit Render, aplicația „adoarme” când nu intră nimeni o vreme, așa că prima deschidere după aceea durează puțin mai mult. Conturile și scorurile stau în baza de date, deci nu se pierd.

## Adaugă quizuri noi

**Din aplicație (cel mai simplu).** Ca administrator, intră în fila **Quizuri** și apasă **Quiz nou**. Alegi titlul, dificultatea (1–10) și timpul pe întrebare, apoi scrii întrebările așa:

```
Care este capitala Italiei?
* Roma
- Milano
- Napoli
- Torino

Câte picioare are o albină?
* 6
- 4
- 8
```

Steluța marchează răspunsul corect. Fiecare întrebare are 2–4 răspunsuri și între întrebări lași un rând liber. Quizurile salvate apar imediat la toți. Le poți edita sau șterge oricând, iar pe cele incluse le poți copia ca model.

**Ca fișier.** Pune un fișier `.json` în folderul `quizzes/`, în același format ca cele existente (primul răspuns din listă e cel corect). Apare după următoarea publicare.

## Personalizare
- **Cuvinte noi pentru Spânzurătoarea:** în `words.js`.
- **Puncte, timp și număr de întrebări:** în constantele de la începutul lui `server.js`.
