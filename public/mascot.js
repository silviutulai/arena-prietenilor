'use strict';
// Mascotele: { b: formă, c: culoare, e: ochi, m: gură, a: accesoriu } -> SVG.
(function () {
  const INK = '#1E1B3A';
  const COLORS = ['#FF6B6B', '#FF9F43', '#FECA57', '#2ED3A0', '#1DD1E8', '#54A0FF', '#7C5CFF', '#FF5FA2', '#A3E635', '#C49A6C'];
  const NAMES = {
    b: ['Bulină', 'Fantomă', 'Pisică', 'Monstruleț', 'Fasole', 'Ursuleț'],
    e: ['Puncte', 'Ochi mari', 'Fericiți', 'Ciclop', 'Face cu ochiul', 'Somnoros'],
    m: ['Zâmbet', 'Râs', 'Limbă', 'Mirat', 'Dinți', 'Pisicesc'],
    a: ['Nimic', 'Coroană', 'Coif de petrecere', 'Ochelari', 'Fundiță', 'Coarne', 'Căști', 'Căciulă']
  };
  const TOP = [24, 22, 27, 24, 18, 25]; // unde începe capul, pentru pălării

  const st = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

  function body(b, fill) {
    const f = `fill="${fill}" ${st}`;
    switch (b) {
      case 1: return `<path ${f} d="M18 58 Q18 22 50 22 Q82 22 82 58 L82 84 Q76 78 70 84 Q63 91 57 84 Q50 78 43 84 Q37 91 30 84 Q24 78 18 84 Z"/>`;
      case 2: return `<path ${f} d="M22 44 L26 12 L46 30 Z"/><path ${f} d="M78 44 L74 12 L54 30 Z"/><ellipse ${f} cx="50" cy="58" rx="34" ry="30"/>`;
      case 3: return `<rect ${f} x="17" y="24" width="66" height="64" rx="20"/>`;
      case 4: return `<ellipse ${f} cx="50" cy="55" rx="29" ry="37"/>`;
      case 5: return `<circle ${f} cx="25" cy="30" r="11"/><circle ${f} cx="75" cy="30" r="11"/><circle fill="#ffffff55" cx="25" cy="30" r="5"/><circle fill="#ffffff55" cx="75" cy="30" r="5"/><circle ${f} cx="50" cy="57" r="33"/>`;
      default: return `<ellipse ${f} cx="50" cy="57" rx="35" ry="32"/>`;
    }
  }

  function eyes(e) {
    const dot = (x) => `<circle cx="${x}" cy="50" r="4.6" fill="${INK}"/><circle cx="${x + 1.5}" cy="48.4" r="1.4" fill="#fff"/>`;
    const happy = (x) => `<path d="M${x - 6} 52 Q${x} 44 ${x + 6} 52" fill="none" ${st} stroke-width="3.5"/>`;
    switch (e) {
      case 1: return [38, 62].map((x) => `<circle cx="${x}" cy="49" r="9" fill="#fff" ${st} stroke-width="2.5"/><circle cx="${x + 2}" cy="51" r="4" fill="${INK}"/>`).join('');
      case 2: return happy(38) + happy(62);
      case 3: return `<circle cx="50" cy="47" r="13" fill="#fff" ${st}/><circle cx="51" cy="48" r="6" fill="${INK}"/><circle cx="53" cy="45.5" r="2" fill="#fff"/>`;
      case 4: return dot(38) + happy(62);
      case 5: return [38, 62].map((x) => `<path d="M${x - 6} 50 Q${x} 55 ${x + 6} 50" fill="none" ${st}/><path d="M${x - 7} 47 L${x + 7} 47" ${st} stroke-width="2"/>`).join('');
      default: return dot(38) + dot(62);
    }
  }

  function mouth(m) {
    switch (m) {
      case 1: return `<path d="M40 61 Q50 78 60 61 Z" fill="${INK}" ${st} stroke-width="2.5"/><path d="M45 69 Q50 66 55 69 Q50 74 45 69 Z" fill="#FF7FA8"/>`;
      case 2: return `<path d="M42 62 Q50 69 58 62" fill="none" ${st}/><path d="M47 65 Q47 74 51.5 74 Q56 74 55 65 Z" fill="#FF7FA8" ${st} stroke-width="2"/>`;
      case 3: return `<ellipse cx="50" cy="66" rx="4.5" ry="5.5" fill="${INK}"/>`;
      case 4: return `<rect x="39" y="60" width="22" height="10" rx="5" fill="#fff" ${st} stroke-width="2.5"/><path d="M50 60 L50 70 M44.5 60 L44.5 70 M55.5 60 L55.5 70" ${st} stroke-width="1.5"/>`;
      case 5: return `<path d="M41 62 Q45.5 68 50 62 Q54.5 68 59 62" fill="none" ${st}/>`;
      default: return `<path d="M41 62 Q50 72 59 62" fill="none" ${st}/>`;
    }
  }

  function accessory(a, b) {
    const dy = TOP[b] - 24;
    const hat = (svg) => `<g transform="translate(0 ${dy})">${svg}</g>`;
    switch (a) {
      case 1: return hat(`<path d="M33 27 L35 9 L43.5 18 L50 5 L56.5 18 L65 9 L67 27 Z" fill="#FFC93C" ${st} stroke-width="2.5"/><circle cx="50" cy="20" r="2.6" fill="#FF5FA2"/><circle cx="40" cy="22" r="2" fill="#3DB2FF"/><circle cx="60" cy="22" r="2" fill="#3DB2FF"/>`);
      case 2: return hat(`<path d="M39 27 L50 1 L61 27 Z" fill="#FF5FA2" ${st} stroke-width="2.5"/><path d="M44 15 L56 19 M42 21 L58 25" stroke="#FFC93C" stroke-width="3"/><circle cx="50" cy="2" r="4.5" fill="#FFC93C" ${st} stroke-width="2"/>`);
      case 3: return `<rect x="26" y="42" width="21" height="14" rx="6" fill="${INK}"/><rect x="53" y="42" width="21" height="14" rx="6" fill="${INK}"/><path d="M47 47 L53 47" ${st}/><path d="M31 46 L36 46 M58 46 L63 46" stroke="#ffffff99" stroke-width="2.5" stroke-linecap="round"/>`;
      case 4: return hat(`<g transform="translate(66 27)"><path d="M0 0 L-13 -9 L-13 9 Z" fill="#FF5FA2" ${st} stroke-width="2.5"/><path d="M0 0 L13 -9 L13 9 Z" fill="#FF5FA2" ${st} stroke-width="2.5"/><circle r="4" fill="#FF8FC0" ${st} stroke-width="2.5"/></g>`);
      case 5: return hat(`<path d="M33 30 Q22 18 29 5 Q34 18 43 25 Z" fill="#FFF4E0" ${st} stroke-width="2.5"/><path d="M67 30 Q78 18 71 5 Q66 18 57 25 Z" fill="#FFF4E0" ${st} stroke-width="2.5"/>`);
      case 6: return `<path d="M19 54 Q17 14 50 14 Q83 14 81 54" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><rect x="11" y="45" width="13" height="21" rx="6" fill="#7C5CFF" ${st} stroke-width="2.5"/><rect x="76" y="45" width="13" height="21" rx="6" fill="#7C5CFF" ${st} stroke-width="2.5"/>`;
      case 7: return hat(`<path d="M23 30 Q23 6 50 6 Q77 6 77 30 Z" fill="#3DB2FF" ${st} stroke-width="2.5"/><rect x="21" y="25" width="58" height="10" rx="5" fill="#2E86DE" ${st} stroke-width="2.5"/><circle cx="50" cy="5" r="5.5" fill="#fff" ${st} stroke-width="2.5"/>`);
      default: return '';
    }
  }

  function svg(cfg) {
    const c = cfg || {};
    const b = c.b ?? 0;
    const fill = COLORS[c.c ?? 6];
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="50" cy="94" rx="26" ry="4" fill="#00000018"/>
      <g class="m-body">${body(b, fill)}
        <ellipse cx="36" cy="38" rx="9" ry="5" fill="#ffffff55" transform="rotate(-25 36 38)"/>
        <ellipse cx="29" cy="61" rx="5.5" ry="3.2" fill="#FF7FA8" opacity=".6"/>
        <ellipse cx="71" cy="61" rx="5.5" ry="3.2" fill="#FF7FA8" opacity=".6"/>
        <g class="m-eyes">${eyes(c.e ?? 0)}</g>
        ${mouth(c.m ?? 0)}
        ${accessory(c.a ?? 0, b)}
      </g>
    </svg>`;
  }

  // Mascotă implicită pentru cine nu și-a făcut încă una (stabilă pentru același id).
  function fallback(id) {
    const n = Number(id) || 0;
    return { b: n % 6, c: (n * 3) % 10, e: (n * 5) % 6, m: (n * 7) % 6, a: 0 };
  }

  function random() {
    const r = (n) => Math.floor(Math.random() * n);
    return { b: r(6), c: r(10), e: r(6), m: r(6), a: r(8) };
  }

  window.Mascot = { svg, random, fallback, COLORS, NAMES, COUNTS: { b: 6, c: 10, e: 6, m: 6, a: 8 } };
})();
