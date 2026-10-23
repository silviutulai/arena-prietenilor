# Arena Prietenilor

Platformă de jocuri pentru tine și prietenii tăi. Conține **X și 0**, **X și 0 Quiz**, **4 în linie** și **Spânzurătoarea** (1 contra 1) și **10 quizuri** pe niveluri de dificultate, de la ușor la foarte greu, cu câte 20 de întrebări (toți joacă odată). Are și un **clasament săptămânal**, care pornește de la zero în fiecare luni, după ora României.

## X și 0 Quiz
Alegi o căsuță și apare o întrebare de cultură generală (din toate quizurile, inclusiv cele adăugate de tine). Dacă răspunzi corect în 20 de secunde, îți pui X sau 0 acolo. Dacă greșești sau expiră timpul, căsuța rămâne liberă și rândul trece la celălalt.

## Conturi
- **Primul cont** creat pe site devine administrator. După aceea, nimeni nu-și mai poate face cont singur.
- **Conturile prietenilor** le creezi tu, din fila **Admin**, secțiunea Jucători. Scrii numele, iar parola se generează automat (sau scrii tu una). Apeși **Copiază mesajul** și i-l trimiți în privat: conține linkul, numele și parola.
- **Parolă uitată:** din același loc dai **Parolă nouă**. Prietenul e delogat de peste tot și intră cu parola nouă.
- **Schimbarea parolei:** fiecare își poate schimba singur parola apăsând pe numele lui, sus.
- **Înscriere liberă:** dacă vrei totuși ca oricine să-și poată face cont, setezi în Render `ALLOW_SIGNUP=true`.

## Punctaj
- **Meci 1 contra 1:** victorie 3 p, remiză 1 p, înfrângere 0 p.
- **Quiz:** locul 1 = 3 p, locul 2 = 2 p, locul 3 = 1 p. Ultimul loc nu primește puncte.
- **Abandon:** abandonul sau o deconectare mai lungă de 30 de secunde contează ca înfrângere.

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
