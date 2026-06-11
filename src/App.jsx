import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Play,
  Pause,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  X,
  Loader2,
  ScrollText,
  MoreVertical,
  Wind,
  MessagesSquare,
  BookOpen,
  KeyRound,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

// Il prompt originale chiedeva claude-sonnet-4-20250514, ma quel modello viene
// ritirato il 15/06/2026: usiamo il suo sostituto diretto.
const MODEL = 'claude-sonnet-4-6'
// 1000 token (come da prompt originale) troncano il JSON del turno (causa n.1
// di "JSON malformato"): verificato sul campo, sotto i 4000 capita spesso.
const MAX_TOKENS_TURNO = 4000
const MAX_TOKENS_GENESI = 3000
const STORAGE_KEY = 'borgo-stato'

const MOMENTI = ['mattina', 'pomeriggio', 'sera']
const MOMENTO_LABEL = { mattina: 'Mattina', pomeriggio: 'Pomeriggio', sera: 'Sera' }
const MOMENTO_EMOJI = { mattina: '🌅', pomeriggio: '☀️', sera: '🌙' }

// Eventi pronti da scatenare con un tap
const EVENTI_RAPIDI = [
  { emoji: '🧳', label: 'Forestiero', testo: 'Arriva in paese un forestiero misterioso che fa troppe domande' },
  { emoji: '💌', label: 'Lettera', testo: "Circola una lettera anonima piena di accuse: qualcuno l'ha affissa di notte sulla porta della chiesa" },
  { emoji: '💰', label: 'Tesoro', testo: "Qualcuno trova una borsa di monete d'oro nascosta in un muro a secco" },
  { emoji: '🔥', label: 'Incendio', testo: 'Un piccolo incendio scoppia in paese: si spegne presto, ma da dove è partito?' },
  { emoji: '⛈️', label: 'Tempesta', testo: 'Un temporale violentissimo costringe tutti a rifugiarsi negli stessi posti' },
  { emoji: '🎻', label: 'Festa', testo: 'Arrivano musici girovaghi: stasera si balla in piazza, e il vino scioglie le lingue' },
]

// Coordinate in uno spazio 800x600 (poi convertite in %)
const LUOGHI = {
  piazza: { nome: 'La Piazza', x: 400, y: 330 },
  chiesa: { nome: 'La Chiesa', x: 400, y: 120 },
  osteria: { nome: "L'Osteria", x: 645, y: 250 },
  forno: { nome: 'Il Forno', x: 160, y: 235 },
  bottega: { nome: 'La Bottega', x: 630, y: 455 },
  mercato: { nome: 'Il Mercato', x: 185, y: 440 },
  campi: { nome: 'I Campi', x: 95, y: 545 },
}

// Una casetta per ciascuno dei 7 cittadini (per il luogo "casa")
const CASE = [
  { x: 295, y: 555 },
  { x: 375, y: 565 },
  { x: 455, y: 555 },
  { x: 535, y: 565 },
  { x: 720, y: 560 },
  { x: 735, y: 130 },
  { x: 75, y: 120 },
]

const NOMI_LUOGHI_VALIDI = [...Object.keys(LUOGHI), 'casa']

// ---------------------------------------------------------------------------
// Chiamate API + parsing difensivo
// ---------------------------------------------------------------------------

function parseJsonLoose(text) {
  let t = String(text || '').trim()
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Nessun JSON nella risposta')
  }
  return JSON.parse(t.slice(first, last + 1))
}

// Sul sito statico (GitHub Pages) la chiave del visitatore vive in localStorage
const CHIAVE_API = 'borgo-api-key'
export const ambienteStatico = () => window.__BORGO_STATICO === true
export const chiaveSalvata = () =>
  ambienteStatico() ? localStorage.getItem(CHIAVE_API) || '' : 'server'

async function chiamaClaude(system, user, maxTokens) {
  let url = '/api/anthropic'
  const headers = { 'content-type': 'application/json' }
  if (ambienteStatico()) {
    const key = localStorage.getItem(CHIAVE_API)
    if (!key) throw new Error('Nessuna chiave API: inseriscila per entrare nel borgo.')
    url = 'https://api.anthropic.com/v1/messages'
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      data?.error?.message || data?.error || `Errore API (HTTP ${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

async function chiamaClaudeJson(system, user, maxTokens) {
  let testo = await chiamaClaude(system, user, maxTokens)
  try {
    return parseJsonLoose(testo)
  } catch (e1) {
    console.warn('[borgo] primo parse fallito:', e1.message, '\n--- risposta ---\n', testo)
    // Retry singolo in caso di JSON malformato
    testo = await chiamaClaude(
      system,
      user +
        '\n\nATTENZIONE: la risposta precedente non era JSON valido (probabilmente troncata). Rispondi di nuovo, SOLO JSON valido e completo, molto più conciso, compatto su una riga, nessun altro testo.',
      maxTokens
    )
    try {
      return parseJsonLoose(testo)
    } catch (e2) {
      console.warn('[borgo] anche il retry è fallito:', e2.message, '\n--- risposta ---\n', testo)
      throw e2
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_JSON = `Sei il motore narrativo di "Borgo Vivente", un piccolo borgo toscano abitato da cittadini autonomi.
Rispondi SEMPRE e SOLO con JSON valido: niente backtick, niente \`\`\`json, niente preamboli, niente testo prima o dopo il JSON.
Tutti i testi narrativi e i dialoghi sono in italiano, con voci distinte e tono da cronaca di paese.`

function promptGenesi() {
  return `Genera un piccolo borgo toscano unico con ESATTAMENTE 7 cittadini.
Ogni cittadino ha: id ("c1"..."c7"), nome (italiano, con cognome), eta, mestiere, personalita (3-4 tratti forti e in tensione tra loro), segreto (concreto, potenzialmente esplosivo), desiderio, umore iniziale, emoji (una sola emoji che rappresenta l'umore), luogo iniziale.
Crea anche relazioni iniziali interessanti e asimmetriche: amicizie, rivalità, debiti, amori non corrisposti. Valori da -100 a +100.
Luoghi validi: ${NOMI_LUOGHI_VALIDI.join(', ')}.

Rispondi SOLO con questo JSON:
{
  "nome_borgo": "nome inventato del borgo",
  "cittadini": [
    {"id":"c1","nome":"...","eta":0,"mestiere":"...","personalita":["...","...","..."],"segreto":"...","desiderio":"...","umore":"...","emoji":"🙂","luogo":"piazza"}
  ],
  "relazioni": [
    {"da":"c1","a":"c2","valore":35,"descrizione":"breve descrizione del legame"}
  ]
}
Le relazioni sono direzionali: includi almeno 12 coppie significative (non serve la matrice completa).`
}

function promptTurno(stato) {
  const cittadini = stato.cittadini.map((c) => ({
    id: c.id,
    nome: c.nome,
    eta: c.eta,
    mestiere: c.mestiere,
    personalita: c.personalita,
    segreto: c.segreto,
    desiderio: c.desiderio,
    umore: c.umore,
    luogo: c.luogo,
    memorie: c.memorie,
  }))
  const relazioni = Object.entries(stato.relazioni).map(([k, v]) => {
    const [da, a] = k.split('>')
    return { da, a, valore: v.valore, descrizione: v.descrizione }
  })
  const ultimaCronaca = stato.cronaca.slice(0, 3).map((e) => e.evento)
  const daComprimere = stato.cittadini
    .filter((c) => c.memorie.length > 10)
    .map((c) => c.id)

  let interventi = ''
  if (stato.eventiPendenti.length > 0) {
    interventi += `\nEVENTI IMPOSTI DALL'OSSERVATORE (devono accadere questo turno e avere conseguenze): ${JSON.stringify(stato.eventiPendenti)}`
  }
  if (stato.conversazioneForzata) {
    interventi += `\nCONVERSAZIONE OBBLIGATORIA questo turno tra ${stato.conversazioneForzata[0]} e ${stato.conversazioneForzata[1]} (falli incontrare nello stesso luogo).`
  }
  let compressione = ''
  if (daComprimere.length > 0) {
    compressione = `\nQuesti cittadini hanno troppe memorie: ${daComprimere.join(', ')}. Per ciascuno includi in "memorie_compresse" un riassunto di 1-2 frasi delle memorie più vecchie (tutte tranne le ultime 4).`
  }

  return `Borgo: ${stato.nomeBorgo}. È il giorno ${stato.giorno}, ${stato.momento}.

STATO DEL BORGO:
Cittadini: ${JSON.stringify(cittadini)}
Relazioni (direzionali, -100..+100): ${JSON.stringify(relazioni)}
Ultimi eventi: ${JSON.stringify(ultimaCronaca)}${interventi}${compressione}

Simula il prossimo turno. Regole:
- Ogni cittadino agisce secondo personalità, umore, desideri e memorie. Le relazioni e i segreti hanno conseguenze reali.
- Se un segreto è stato scoperto o accennato in un dialogo, propagalo come gossip nei turni successivi.
- 1 o 2 dialoghi tra cittadini, 2-4 battute ciascuno, voci distinte, in italiano.
- Aggiorna SOLO le relazioni toccate dagli eventi (valore assoluto -100..+100, con motivazione).
- Una nuova memoria breve (prima persona) per ogni cittadino coinvolto in qualcosa di rilevante.
- "evento" è la cronaca del turno in 1-2 frasi secche, stile gazzetta di paese.
- "emoji" è una sola emoji che fotografa l'umore del cittadino in quel momento.
- Luoghi validi: ${NOMI_LUOGHI_VALIDI.join(', ')}.
- SII CONCISO: memorie di 1 frase breve, "azione" max 8 parole, "motivo" delle relazioni max 12 parole. JSON compatto su una sola riga, senza indentazione né a capo. La risposta intera deve restare ben sotto i 3500 token.

Rispondi SOLO con questo JSON:
{
  "evento": "cronaca del turno",
  "azioni": [{"id":"c1","luogo":"osteria","azione":"cosa fa, breve","umore":"umore aggiornato","emoji":"😠"}],
  "dialoghi": [{"luogo":"piazza","battute":[{"chi":"c1","testo":"..."},{"chi":"c2","testo":"..."}]}],
  "relazioni": [{"da":"c1","a":"c2","valore":-20,"motivo":"..."}],
  "memorie": [{"id":"c1","memoria":"..."}],
  "memorie_compresse": [{"id":"c1","riassunto":"..."}]
}
"azioni" deve contenere tutti e 7 i cittadini. "memorie_compresse" solo se richiesto sopra, altrimenti [].`
}

// ---------------------------------------------------------------------------
// Logica di stato
// ---------------------------------------------------------------------------

function normalizzaLuogo(luogo) {
  const l = String(luogo || '').toLowerCase().trim()
  return NOMI_LUOGHI_VALIDI.includes(l) ? l : 'piazza'
}

function statoDaGenesi(parsed) {
  const cittadini = (parsed.cittadini || []).slice(0, 7).map((c, i) => ({
    id: c.id || `c${i + 1}`,
    nome: c.nome || `Cittadino ${i + 1}`,
    eta: c.eta || 40,
    mestiere: c.mestiere || 'contadino',
    personalita: Array.isArray(c.personalita) ? c.personalita : [],
    segreto: c.segreto || '',
    desiderio: c.desiderio || '',
    umore: c.umore || 'tranquillo',
    emoji: c.emoji || '🙂',
    luogo: normalizzaLuogo(c.luogo),
    memorie: [],
  }))
  const relazioni = {}
  for (const r of parsed.relazioni || []) {
    if (!r.da || !r.a) continue
    relazioni[`${r.da}>${r.a}`] = {
      valore: Math.max(-100, Math.min(100, Number(r.valore) || 0)),
      descrizione: r.descrizione || '',
    }
  }
  return {
    nomeBorgo: parsed.nome_borgo || 'Borgo Vivente',
    giorno: 1,
    momento: 'mattina',
    cittadini,
    relazioni,
    cronaca: [
      {
        giorno: 1,
        momento: 'mattina',
        evento: `Il borgo di ${parsed.nome_borgo || 'Borgo Vivente'} si sveglia per la prima volta. ${cittadini.length} anime, e già parecchi non detti.`,
        dialoghi: [],
      },
    ],
    eventiPendenti: [],
    conversazioneForzata: null,
  }
}

function applicaTurno(stato, parsed) {
  const nuovo = structuredClone(stato)

  for (const a of parsed.azioni || []) {
    const c = nuovo.cittadini.find((x) => x.id === a.id)
    if (!c) continue
    c.luogo = normalizzaLuogo(a.luogo)
    if (a.umore) c.umore = a.umore
    if (a.emoji) c.emoji = a.emoji
  }

  for (const r of parsed.relazioni || []) {
    if (!r.da || !r.a) continue
    const chiave = `${r.da}>${r.a}`
    nuovo.relazioni[chiave] = {
      valore: Math.max(-100, Math.min(100, Number(r.valore) || 0)),
      descrizione: r.motivo || nuovo.relazioni[chiave]?.descrizione || '',
    }
  }

  for (const m of parsed.memorie || []) {
    const c = nuovo.cittadini.find((x) => x.id === m.id)
    if (c && m.memoria) c.memorie.push(m.memoria)
  }

  for (const mc of parsed.memorie_compresse || []) {
    const c = nuovo.cittadini.find((x) => x.id === mc.id)
    if (c && mc.riassunto && c.memorie.length > 6) {
      const recenti = c.memorie.slice(-4)
      c.memorie = [`[Ricordi passati] ${mc.riassunto}`, ...recenti]
    }
  }

  nuovo.cronaca.unshift({
    giorno: nuovo.giorno,
    momento: nuovo.momento,
    evento: parsed.evento || 'Una giornata come tante, in apparenza.',
    dialoghi: (parsed.dialoghi || []).map((d) => ({
      luogo: normalizzaLuogo(d.luogo),
      battute: (d.battute || []).map((b) => ({
        chi: b.chi,
        testo: b.testo,
      })),
    })),
  })
  if (nuovo.cronaca.length > 60) nuovo.cronaca.length = 60

  // Avanza il tempo
  const idx = MOMENTI.indexOf(nuovo.momento)
  if (idx === MOMENTI.length - 1) {
    nuovo.momento = 'mattina'
    nuovo.giorno += 1
  } else {
    nuovo.momento = MOMENTI[idx + 1]
  }

  // Gli interventi sono stati consumati
  nuovo.eventiPendenti = []
  nuovo.conversazioneForzata = null

  return nuovo
}

// ---------------------------------------------------------------------------
// Componenti di supporto
// ---------------------------------------------------------------------------

function iniziali(nome) {
  return String(nome || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
}

function BarraRelazione({ valore }) {
  const pct = Math.abs(valore)
  const positivo = valore >= 0
  return (
    <div className="rel-barra">
      <div className="rel-barra-meta sinistra">
        {!positivo && (
          <div className="rel-barra-fill negativa" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="rel-barra-meta">
        {positivo && (
          <div className="rel-barra-fill positiva" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  )
}

function Mappa({ stato, onCittadino, selezionato, inCorso }) {
  const gruppi = {}
  stato.cittadini.forEach((c) => {
    const k = c.luogo === 'casa' ? `casa-${c.id}` : c.luogo
    if (!gruppi[k]) gruppi[k] = []
    gruppi[k].push(c)
  })

  function posizione(c) {
    let base
    if (c.luogo === 'casa') {
      const idx = stato.cittadini.findIndex((x) => x.id === c.id)
      base = CASE[idx % CASE.length]
    } else {
      base = LUOGHI[c.luogo] || LUOGHI.piazza
    }
    const gruppo = c.luogo === 'casa' ? [c] : gruppi[c.luogo] || [c]
    const i = gruppo.findIndex((x) => x.id === c.id)
    const n = gruppo.length
    let dx = 0
    let dy = 0
    if (n > 1) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2
      dx = Math.cos(ang) * 32
      dy = Math.sin(ang) * 24
    }
    return {
      left: `${((base.x + dx) / 800) * 100}%`,
      top: `${((base.y + dy) / 600) * 100}%`,
    }
  }

  return (
    <div className="mappa">
      <svg viewBox="0 0 800 600" preserveAspectRatio="none" className="mappa-svg">
        <rect x="0" y="0" width="800" height="600" fill="#e9dcb8" />
        <rect x="0" y="0" width="800" height="600" fill="url(#trama)" opacity="0.5" />
        <defs>
          <pattern id="trama" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#d9c79a" />
          </pattern>
        </defs>

        <path
          d="M 400 180 L 400 300 M 400 360 C 400 430 330 470 250 460 M 400 360 C 410 440 520 460 615 455 M 430 320 C 520 300 580 280 630 262 M 370 320 C 290 300 230 270 185 250 M 250 470 C 200 500 150 520 110 540"
          stroke="#cdb88a"
          strokeWidth="26"
          fill="none"
          strokeLinecap="round"
        />

        <g transform="translate(40,495)">
          <rect x="0" y="0" width="130" height="80" rx="6" fill="#8a9a55" />
          {[12, 32, 52, 72, 92, 112].map((x) => (
            <line key={x} x1={x} y1="6" x2={x} y2="74" stroke="#6b7a46" strokeWidth="5" />
          ))}
        </g>

        <ellipse cx="400" cy="330" rx="95" ry="58" fill="#d8c290" />
        <ellipse cx="400" cy="330" rx="95" ry="58" fill="none" stroke="#c2ab77" strokeWidth="3" />
        <circle cx="400" cy="330" r="14" fill="#8fa8b8" stroke="#5e7889" strokeWidth="3" />
        <circle cx="400" cy="330" r="5" fill="#dfeaf1" />

        <g transform="translate(355,55)">
          <rect x="10" y="38" width="70" height="58" fill="#e7d3ae" stroke="#a98e63" strokeWidth="2" />
          <polygon points="5,40 45,8 85,40" fill="#b85c38" stroke="#8c3f25" strokeWidth="2" />
          <rect x="62" y="0" width="20" height="96" fill="#dec9a2" stroke="#a98e63" strokeWidth="2" />
          <polygon points="58,2 72,-16 86,2" fill="#b85c38" />
          <line x1="72" y1="-16" x2="72" y2="-28" stroke="#6b5232" strokeWidth="2.5" />
          <line x1="66" y1="-23" x2="78" y2="-23" stroke="#6b5232" strokeWidth="2.5" />
          <rect x="36" y="66" width="16" height="30" rx="8" fill="#7a5c38" />
        </g>

        <g transform="translate(600,205)">
          <rect x="0" y="22" width="86" height="52" fill="#e3c89b" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,24 43,-6 92,24" fill="#a85a32" stroke="#82431f" strokeWidth="2" />
          <rect x="12" y="44" width="14" height="30" fill="#7a5c38" />
          <rect x="52" y="40" width="20" height="16" fill="#f4e6c8" stroke="#a98e63" />
          <circle cx="80" cy="34" r="7" fill="#6b7a46" />
        </g>

        <g transform="translate(118,195)">
          <rect x="0" y="18" width="76" height="46" fill="#e8d2a8" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,20 38,-8 82,20" fill="#c1693f" stroke="#8c3f25" strokeWidth="2" />
          <rect x="50" y="-2" width="12" height="22" fill="#9a7d52" />
          <path d="M 56 -8 q 4 -8 0 -14" stroke="#bbb3a2" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="12" y="36" width="14" height="28" fill="#7a5c38" />
        </g>

        <g transform="translate(588,415)">
          <rect x="0" y="16" width="80" height="46" fill="#e3cda4" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,18 40,-8 86,18" fill="#b85c38" stroke="#8c3f25" strokeWidth="2" />
          <rect x="10" y="34" width="26" height="28" fill="#d9a04b" stroke="#a87830" />
          <rect x="48" y="36" width="22" height="14" fill="#f4e6c8" stroke="#a98e63" />
        </g>

        <g transform="translate(140,405)">
          <polygon points="0,20 45,-4 90,20" fill="#d9a04b" stroke="#a87830" strokeWidth="2" />
          <line x1="8" y1="20" x2="8" y2="58" stroke="#8a6b40" strokeWidth="4" />
          <line x1="82" y1="20" x2="82" y2="58" stroke="#8a6b40" strokeWidth="4" />
          <rect x="18" y="38" width="54" height="14" fill="#c7a96e" />
        </g>

        {CASE.map((p, i) => (
          <g key={i} transform={`translate(${p.x - 22},${p.y - 14})`}>
            <rect x="0" y="10" width="44" height="26" fill="#ead7ae" stroke="#a98e63" strokeWidth="1.5" />
            <polygon points="-4,12 22,-6 48,12" fill="#b56a45" stroke="#8c4f2e" strokeWidth="1.5" />
            <rect x="17" y="20" width="10" height="16" fill="#7a5c38" />
          </g>
        ))}

        {[
          [60, 320],
          [740, 350],
          [310, 130],
          [500, 120],
          [700, 520],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x},${y})`}>
            <ellipse cx="0" cy="-16" rx="9" ry="26" fill="#4c5934" />
            <rect x="-2" y="6" width="4" height="10" fill="#6b5232" />
          </g>
        ))}

        {Object.entries(LUOGHI).map(([k, l]) => (
          <text key={k} x={l.x} y={l.y + 46} textAnchor="middle" className="etichetta">
            {l.nome}
          </text>
        ))}
      </svg>

      {stato.cittadini.map((c) => {
        const pos = posizione(c)
        return (
          <button
            key={c.id}
            className={'gettone token' + (selezionato === c.id ? ' selezionato' : '')}
            style={pos}
            onClick={() => onCittadino(c)}
            title={`${c.nome} — ${c.umore}`}
          >
            {iniziali(c.nome)}
            <span className="umore-badge">{c.emoji || '🙂'}</span>
          </button>
        )
      })}

      {inCorso && (
        <div className="mappa-velo">
          <Loader2 className="gira" size={30} />
          <span>Il borgo vive…</span>
        </div>
      )}
    </div>
  )
}

function Scena({ entry, perNome }) {
  if (!entry) return null
  return (
    <div className="scena">
      <header>
        {MOMENTO_EMOJI[entry.momento]} Giorno {entry.giorno} — {MOMENTO_LABEL[entry.momento]}
      </header>
      <p className="evento">{entry.evento}</p>
      {entry.dialoghi.map((d, j) => (
        <div key={j} className="bolle">
          {d.luogo && <div className="bolle-luogo">{LUOGHI[d.luogo]?.nome || 'In paese'}</div>}
          {d.battute.map((b, k) => (
            <div key={k} className={'bolla' + (k % 2 === 1 ? ' destra' : '')}>
              <span className="bolla-chi">{perNome[b.chi] || b.chi}</span>
              {b.testo}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SchedaCittadino({ cittadino, stato, onChiudi, onSussurra, onConversa, occupato }) {
  const [mostraSegreto, setMostraSegreto] = useState(false)
  const [mostraRicordi, setMostraRicordi] = useState(false)
  const [modo, setModo] = useState(null) // null | 'sussurro' | 'conversa'
  const [sussurro, setSussurro] = useState('')

  const relazioni = Object.entries(stato.relazioni)
    .filter(([k]) => k.startsWith(cittadino.id + '>'))
    .map(([k, v]) => {
      const altroId = k.split('>')[1]
      const altro = stato.cittadini.find((c) => c.id === altroId)
      return altro ? { altro, ...v } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.valore - a.valore)

  const altri = stato.cittadini.filter((c) => c.id !== cittadino.id)

  return (
    <div className="modal-sfondo" onClick={onChiudi}>
      <div className="scheda" onClick={(e) => e.stopPropagation()}>
        <div className="maniglia" />
        <button className="chiudi" onClick={onChiudi} aria-label="Chiudi">
          <X size={20} />
        </button>

        <div className="scheda-testa">
          <div className="gettone grande">
            {iniziali(cittadino.nome)}
            <span className="umore-badge grande-badge">{cittadino.emoji || '🙂'}</span>
          </div>
          <div>
            <h2>{cittadino.nome}</h2>
            <p className="sotto">
              {cittadino.eta} anni · {cittadino.mestiere}
            </p>
            <p className="umore">
              {cittadino.luogo === 'casa' ? 'A casa' : LUOGHI[cittadino.luogo]?.nome} · {cittadino.umore}
            </p>
          </div>
        </div>

        {/* Azioni: il cuore del gioco */}
        <div className="azioni-cittadino">
          <button
            className={'btn azione' + (modo === 'sussurro' ? ' attivo' : '')}
            disabled={occupato}
            onClick={() => setModo(modo === 'sussurro' ? null : 'sussurro')}
          >
            <Wind size={16} /> Sussurra
          </button>
          <button
            className={'btn azione' + (modo === 'conversa' ? ' attivo' : '')}
            disabled={occupato}
            onClick={() => setModo(modo === 'conversa' ? null : 'conversa')}
          >
            <MessagesSquare size={16} /> Fallo parlare
          </button>
        </div>

        {modo === 'sussurro' && (
          <div className="pannellino">
            <input
              value={sussurro}
              autoFocus
              onChange={(e) => setSussurro(e.target.value)}
              placeholder="Metti un'idea nella sua testa…"
            />
            <button
              className="btn primario"
              disabled={!sussurro.trim() || occupato}
              onClick={() => onSussurra(cittadino.id, sussurro.trim())}
            >
              Sussurra <ChevronRight size={15} />
            </button>
          </div>
        )}

        {modo === 'conversa' && (
          <div className="pannellino colonna">
            <p className="sotto">Con chi? (il turno parte subito)</p>
            <div className="scelta-persone">
              {altri.map((c) => (
                <button
                  key={c.id}
                  className="persona"
                  disabled={occupato}
                  onClick={() => onConversa(cittadino.id, c.id)}
                >
                  <span className="gettone mini">{iniziali(c.nome)}</span>
                  {c.nome.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="chips">
          {cittadino.personalita.map((t, i) => (
            <span key={i} className="chip">{t}</span>
          ))}
        </div>

        <p className="desiderio"><em>Desidera:</em> {cittadino.desiderio}</p>

        <div className="segreto">
          <button className="btn fantasma" onClick={() => setMostraSegreto((v) => !v)}>
            {mostraSegreto ? <EyeOff size={15} /> : <Eye size={15} />}
            {mostraSegreto ? 'Nascondi il segreto' : 'Mostra il segreto'}
          </button>
          {mostraSegreto && <p className="segreto-testo">{cittadino.segreto}</p>}
        </div>

        <h3>Relazioni</h3>
        {relazioni.length === 0 && <p className="sotto">Nessuna relazione registrata.</p>}
        {relazioni.map((r, i) => (
          <div key={i} className="rel-riga">
            <div className="rel-testa">
              <span>{r.altro.nome.split(' ')[0]}</span>
              <span className={r.valore >= 0 ? 'pos' : 'neg'}>
                {r.valore > 0 ? '+' : ''}{r.valore}
              </span>
            </div>
            <BarraRelazione valore={r.valore} />
            {r.descrizione && <p className="rel-motivo">{r.descrizione}</p>}
          </div>
        ))}

        <button className="btn fantasma" onClick={() => setMostraRicordi((v) => !v)}>
          <BookOpen size={15} />
          {mostraRicordi ? 'Nascondi i ricordi' : `Ricordi (${cittadino.memorie.length})`}
        </button>
        {mostraRicordi && (
          <ul className="memorie">
            {cittadino.memorie.slice().reverse().map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Gazzetta({ stato, perNome, onChiudi }) {
  return (
    <div className="modal-sfondo" onClick={onChiudi}>
      <div className="scheda gazzetta" onClick={(e) => e.stopPropagation()}>
        <div className="maniglia" />
        <button className="chiudi" onClick={onChiudi} aria-label="Chiudi">
          <X size={20} />
        </button>
        <h2 className="gazzetta-titolo">
          <ScrollText size={18} /> La Gazzetta del Borgo
        </h2>
        {stato.cronaca.map((e, i) => (
          <Scena key={i} entry={e} perNome={perNome} />
        ))}
      </div>
    </div>
  )
}

function SchermataChiave({ onPronto }) {
  const [chiave, setChiave] = useState('')
  const valida = chiave.trim().startsWith('sk-ant-')
  const salva = () => {
    localStorage.setItem(CHIAVE_API, chiave.trim())
    onPronto()
  }
  return (
    <div className="schermo-pieno">
      <h1 className="titolo">Borgo Vivente</h1>
      <p>
        Per dare vita al borgo serve la tua chiave API di Anthropic
        <br />
        (la crei su console.anthropic.com → API Keys)
      </p>
      <div className="chiave-riga">
        <input
          type="password"
          value={chiave}
          onChange={(e) => setChiave(e.target.value)}
          placeholder="sk-ant-…"
          onKeyDown={(e) => e.key === 'Enter' && valida && salva()}
        />
        <button className="btn primario" disabled={!valida} onClick={salva}>
          Entra nel borgo
        </button>
      </div>
      <p className="nota-chiave">
        La chiave resta solo nel tuo browser (localStorage) e parla direttamente
        con l'API Anthropic: non passa da nessun altro server. Ogni turno della
        simulazione è una chiamata API a tuo carico.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [stato, setStato] = useState(null)
  const [fase, setFase] = useState('caricamento') // caricamento | chiave | genesi | pronto | errore-genesi
  const [turnoInCorso, setTurnoInCorso] = useState(false)
  const [errore, setErrore] = useState(null)
  const [selezionato, setSelezionato] = useState(null)
  const [autoplay, setAutoplay] = useState(false)
  const [velocita, setVelocita] = useState(10000)
  const [menuAperto, setMenuAperto] = useState(false)
  const [gazzettaAperta, setGazzettaAperta] = useState(false)
  const [eventoLibero, setEventoLibero] = useState(null) // null | '' | testo

  const turnoRef = useRef(false)
  const statoRef = useRef(null)
  statoRef.current = stato

  const perNome = useMemo(() => {
    const m = {}
    if (stato) stato.cittadini.forEach((c) => (m[c.id] = c.nome.split(' ')[0]))
    return m
  }, [stato])

  async function salva(s) {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // la persistenza non deve mai bloccare la simulazione
    }
  }

  async function generaVillaggio() {
    setFase('genesi')
    setErrore(null)
    try {
      const parsed = await chiamaClaudeJson(SYSTEM_JSON, promptGenesi(), MAX_TOKENS_GENESI)
      const nuovo = statoDaGenesi(parsed)
      setStato(nuovo)
      setFase('pronto')
      salva(nuovo)
    } catch (err) {
      setErrore(`Il borgo non riesce a nascere: ${err.message}`)
      setFase('errore-genesi')
    }
  }

  // Avvio: ricarica lo stato salvato, altrimenti genera un borgo nuovo.
  // Sul sito statico prima serve la chiave API del visitatore.
  async function avvio() {
    if (ambienteStatico() && !chiaveSalvata()) {
      setFase('chiave')
      return
    }
    try {
      const salvato = await window.storage.get(STORAGE_KEY)
      if (salvato) {
        setStato(JSON.parse(salvato))
        setFase('pronto')
        return
      }
    } catch {
      // stato assente o corrotto: si riparte da zero
    }
    generaVillaggio()
  }

  useEffect(() => {
    avvio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esegue un turno, opzionalmente applicando prima un intervento allo stato
  async function avanzaTurno(preparaStato) {
    if (turnoRef.current || !statoRef.current) return
    turnoRef.current = true
    setTurnoInCorso(true)
    setErrore(null)
    let corrente = statoRef.current
    if (preparaStato) {
      corrente = preparaStato(structuredClone(corrente))
      setStato(corrente)
      statoRef.current = corrente
    }
    try {
      const parsed = await chiamaClaudeJson(SYSTEM_JSON, promptTurno(corrente), MAX_TOKENS_TURNO)
      const nuovo = applicaTurno(corrente, parsed)
      setStato(nuovo)
      salva(nuovo)
    } catch (err) {
      // La simulazione non si blocca mai: il turno viene saltato
      const nuovo = structuredClone(corrente)
      nuovo.cronaca.unshift({
        giorno: nuovo.giorno,
        momento: nuovo.momento,
        evento: 'Il villaggio sonnecchia… (il cronista del borgo ha perso il filo, si riproverà)',
        dialoghi: [],
      })
      setStato(nuovo)
      setErrore(err.message)
    } finally {
      turnoRef.current = false
      setTurnoInCorso(false)
    }
  }

  const avanzaRef = useRef(avanzaTurno)
  avanzaRef.current = avanzaTurno

  useEffect(() => {
    if (!autoplay) return
    const id = setInterval(() => avanzaRef.current(), velocita)
    return () => clearInterval(id)
  }, [autoplay, velocita])

  useEffect(() => {
    if (!errore) return
    const id = setTimeout(() => setErrore(null), 8000)
    return () => clearTimeout(id)
  }, [errore])

  // --- Azioni a un tap: applicano l'intervento E fanno girare il turno ---

  function scatenaEvento(testo) {
    setEventoLibero(null)
    avanzaTurno((s) => {
      s.eventiPendenti.push(testo)
      return s
    })
  }

  function sussurra(id, testo) {
    setSelezionato(null)
    avanzaTurno((s) => {
      const c = s.cittadini.find((x) => x.id === id)
      if (c) c.memorie.push(`Una voce che solo io ho sentito mi ha sussurrato: "${testo}"`)
      return s
    })
  }

  function conversa(id1, id2) {
    setSelezionato(null)
    avanzaTurno((s) => {
      s.conversazioneForzata = [id1, id2]
      return s
    })
  }

  async function nuovoVillaggio() {
    if (!window.confirm('Radere al suolo il borgo e fondarne uno nuovo? Tutto andrà perduto.')) return
    setMenuAperto(false)
    setAutoplay(false)
    setStato(null)
    setSelezionato(null)
    try {
      await window.storage.remove(STORAGE_KEY)
    } catch {
      /* ignora */
    }
    generaVillaggio()
  }

  const cittadinoSelezionato =
    stato && selezionato ? stato.cittadini.find((c) => c.id === selezionato) : null

  return (
    <>
      <Stile />
      {fase === 'caricamento' && (
        <div className="schermo-pieno">
          <Loader2 className="gira" size={36} />
          <p>Si apre il sipario…</p>
        </div>
      )}

      {fase === 'chiave' && <SchermataChiave onPronto={avvio} />}

      {fase === 'genesi' && (
        <div className="schermo-pieno">
          <Loader2 className="gira" size={36} />
          <h1 className="titolo">Borgo Vivente</h1>
          <p>Si fondano le case, si inventano i segreti…</p>
        </div>
      )}

      {fase === 'errore-genesi' && (
        <div className="schermo-pieno">
          <h1 className="titolo">Borgo Vivente</h1>
          <p className="err">{errore}</p>
          <button className="btn primario" onClick={generaVillaggio}>
            <RefreshCw size={15} /> Riprova
          </button>
        </div>
      )}

      {fase === 'pronto' && stato && (
        <div className="pagina">
          <header className="testata">
            <div>
              <h1 className="titolo">{stato.nomeBorgo}</h1>
              <span className="data">
                {MOMENTO_EMOJI[stato.momento]} Giorno {stato.giorno} · {MOMENTO_LABEL[stato.momento]}
              </span>
            </div>
            <div className="testata-dx">
              <button className="btn tonda" onClick={() => setMenuAperto((v) => !v)} aria-label="Menu">
                <MoreVertical size={19} />
              </button>
              {menuAperto && (
                <div className="menu" onClick={() => setMenuAperto(false)}>
                  <button onClick={nuovoVillaggio}>
                    <RefreshCw size={15} /> Nuovo villaggio
                  </button>
                  <div className="menu-sezione">Velocità auto</div>
                  {[
                    [18000, 'Lenta'],
                    [10000, 'Normale'],
                    [5000, 'Veloce'],
                  ].map(([v, l]) => (
                    <button
                      key={v}
                      className={velocita === v ? 'scelto' : ''}
                      onClick={(e) => {
                        e.stopPropagation()
                        setVelocita(v)
                      }}
                    >
                      {velocita === v ? '✓ ' : ''}{l}
                    </button>
                  ))}
                  {ambienteStatico() && (
                    <button
                      onClick={() => {
                        localStorage.removeItem(CHIAVE_API)
                        setAutoplay(false)
                        setFase('chiave')
                      }}
                    >
                      <KeyRound size={15} /> Cambia chiave API
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>

          <p className="suggerimento">
            Tocca un cittadino per agire su di lui, o scatena un evento 👇
          </p>

          <Mappa
            stato={stato}
            selezionato={selezionato}
            inCorso={turnoInCorso}
            onCittadino={(c) => setSelezionato((s) => (s === c.id ? null : c.id))}
          />

          <div className="eventi-rapidi">
            {EVENTI_RAPIDI.map((e) => (
              <button
                key={e.label}
                className="evento-chip"
                disabled={turnoInCorso}
                onClick={() => scatenaEvento(e.testo)}
                title={e.testo}
              >
                <span className="evento-emoji">{e.emoji}</span>
                {e.label}
              </button>
            ))}
            <button
              className="evento-chip"
              disabled={turnoInCorso}
              onClick={() => setEventoLibero(eventoLibero === null ? '' : null)}
            >
              <span className="evento-emoji">✍️</span>
              Inventa…
            </button>
          </div>

          {eventoLibero !== null && (
            <div className="pannellino">
              <input
                value={eventoLibero}
                autoFocus
                onChange={(e) => setEventoLibero(e.target.value)}
                placeholder="Scrivi cosa succede nel borgo…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && eventoLibero.trim()) scatenaEvento(eventoLibero.trim())
                }}
              />
              <button
                className="btn primario"
                disabled={!eventoLibero.trim() || turnoInCorso}
                onClick={() => scatenaEvento(eventoLibero.trim())}
              >
                Via <ChevronRight size={15} />
              </button>
            </div>
          )}

          <div className="ultima-scena">
            <Scena entry={stato.cronaca[0]} perNome={perNome} />
            {stato.cronaca.length > 1 && (
              <button className="btn fantasma gazzetta-link" onClick={() => setGazzettaAperta(true)}>
                <ScrollText size={15} /> Leggi tutta la gazzetta ({stato.cronaca.length})
              </button>
            )}
          </div>

          <div className="barra-azioni">
            <button className="btn primario grande-btn" onClick={() => avanzaTurno()} disabled={turnoInCorso}>
              {turnoInCorso ? <Loader2 size={20} className="gira" /> : <ChevronRight size={20} />}
              {turnoInCorso ? 'Il borgo vive…' : 'Avanza'}
            </button>
            <button
              className={'btn tonda-grande' + (autoplay ? ' attivo' : '')}
              onClick={() => setAutoplay((v) => !v)}
              aria-label={autoplay ? 'Pausa' : 'Auto-play'}
            >
              {autoplay ? <Pause size={20} /> : <Play size={20} />}
            </button>
          </div>

          {cittadinoSelezionato && (
            <SchedaCittadino
              cittadino={cittadinoSelezionato}
              stato={stato}
              occupato={turnoInCorso}
              onChiudi={() => setSelezionato(null)}
              onSussurra={sussurra}
              onConversa={conversa}
            />
          )}

          {gazzettaAperta && (
            <Gazzetta stato={stato} perNome={perNome} onChiudi={() => setGazzettaAperta(false)} />
          )}
        </div>
      )}

      {errore && fase === 'pronto' && (
        <div className="toast" onClick={() => setErrore(null)}>
          ⚠️ {errore}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Stile (mobile-first, una sola colonna)
// ---------------------------------------------------------------------------

function Stile() {
  return (
    <style>{`
      :root {
        --terra: #b85c38;
        --terra-scuro: #8c3f25;
        --ocra: #d9a04b;
        --crema: #f5ebd8;
        --carta: #fbf4e4;
        --oliva: #6b7a46;
        --oliva-scuro: #4c5934;
        --bruno: #3b2a1e;
        --bruno-chiaro: #7a6450;
      }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; padding: 0; }
      body {
        background:
          radial-gradient(1200px 600px at 20% -10%, #fdf6e6 0%, transparent 60%),
          var(--crema);
        color: var(--bruno);
        font-family: 'Lora', Georgia, serif;
        overscroll-behavior-y: none;
      }
      .titolo {
        font-family: 'Fraunces', Georgia, serif;
        font-weight: 800;
        margin: 0;
        letter-spacing: 0.5px;
      }
      h2, h3 { font-family: 'Fraunces', Georgia, serif; }

      .pagina {
        max-width: 680px; margin: 0 auto;
        padding: 12px 14px calc(96px + env(safe-area-inset-bottom));
      }

      .testata {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding-bottom: 10px; margin-bottom: 4px;
        border-bottom: 3px double var(--ocra);
      }
      .testata .titolo { font-size: 24px; color: var(--terra-scuro); }
      .data { font-style: italic; color: var(--bruno-chiaro); font-size: 14px; }
      .testata-dx { position: relative; }
      .menu {
        position: absolute; right: 0; top: 46px; z-index: 40;
        background: var(--carta); border: 2px solid #c9ad79; border-radius: 12px;
        box-shadow: 0 12px 30px rgba(60,35,10,.25);
        display: flex; flex-direction: column; min-width: 190px; overflow: hidden;
      }
      .menu button {
        display: flex; align-items: center; gap: 8px;
        background: none; border: none; cursor: pointer;
        font-family: 'Lora', serif; font-size: 14.5px; color: var(--bruno);
        padding: 11px 14px; text-align: left;
      }
      .menu button:hover { background: #f3e6c6; }
      .menu button.scelto { color: var(--terra-scuro); font-weight: 600; }
      .menu-sezione {
        font-size: 11.5px; text-transform: uppercase; letter-spacing: 1px;
        color: var(--bruno-chiaro); padding: 8px 14px 2px;
        border-top: 1px solid #e2cf9f;
      }

      .suggerimento {
        margin: 8px 2px; font-size: 13.5px; font-style: italic;
        color: var(--bruno-chiaro);
      }

      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        font-family: 'Lora', serif; font-size: 14.5px;
        background: var(--carta); color: var(--bruno);
        border: 1.5px solid var(--ocra); border-radius: 10px;
        padding: 10px 14px; cursor: pointer;
        transition: background .15s, transform .1s;
      }
      .btn:hover:not(:disabled) { background: #f3e6c6; }
      .btn:active:not(:disabled) { transform: translateY(1px); }
      .btn:disabled { opacity: .5; cursor: default; }
      .btn.primario { background: var(--terra); border-color: var(--terra-scuro); color: #fff7ec; }
      .btn.primario:hover:not(:disabled) { background: var(--terra-scuro); }
      .btn.attivo { background: var(--oliva); border-color: var(--oliva-scuro); color: #f5f2e4; }
      .btn.fantasma { border: none; background: transparent; padding: 6px 2px; color: var(--terra-scuro); }
      .btn.tonda { border-radius: 50%; width: 42px; height: 42px; padding: 0; }
      .btn.azione { flex: 1; }

      .mappa {
        position: relative; width: 100%; aspect-ratio: 4 / 3;
        border-radius: 14px; overflow: hidden;
        border: 2px solid #c9ad79;
        box-shadow: 0 8px 24px rgba(80, 55, 25, .15);
        background: #e9dcb8;
      }
      .mappa-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .etichetta {
        font-family: 'Fraunces', serif; font-size: 16px; font-style: italic;
        fill: #6b5232; opacity: .85;
      }
      .mappa-velo {
        position: absolute; inset: 0; z-index: 5;
        background: rgba(245, 235, 216, .55); backdrop-filter: blur(1.5px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 8px; font-style: italic; color: var(--terra-scuro); font-size: 16px;
      }

      .gettone {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        width: 42px; height: 42px; border-radius: 50%;
        background: var(--terra); color: #fff4e3;
        font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px;
        border: 2.5px solid #fff0d6;
        box-shadow: 0 3px 8px rgba(60, 35, 10, .35);
      }
      .gettone.grande { width: 58px; height: 58px; font-size: 19px; }
      .gettone.mini { width: 30px; height: 30px; font-size: 11px; border-width: 2px; }
      .umore-badge {
        position: absolute; right: -7px; bottom: -7px;
        font-size: 15px; line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(60,35,10,.4));
      }
      .grande-badge { font-size: 20px; right: -8px; bottom: -6px; }
      .token {
        position: absolute; transform: translate(-50%, -50%);
        cursor: pointer; padding: 0;
        transition: left 1.4s cubic-bezier(.45,.05,.35,1), top 1.4s cubic-bezier(.45,.05,.35,1), box-shadow .2s;
      }
      .token:hover { box-shadow: 0 0 0 4px rgba(217,160,75,.5), 0 3px 8px rgba(60,35,10,.35); }
      .token.selezionato { box-shadow: 0 0 0 4px var(--ocra), 0 3px 8px rgba(60,35,10,.35); }

      .eventi-rapidi {
        display: flex; gap: 8px; overflow-x: auto; padding: 12px 2px 4px;
        scrollbar-width: none;
      }
      .eventi-rapidi::-webkit-scrollbar { display: none; }
      .evento-chip {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        flex-shrink: 0; min-width: 72px;
        background: var(--carta); border: 1.5px solid #d3bb84; border-radius: 14px;
        padding: 9px 10px 7px; cursor: pointer;
        font-family: 'Lora', serif; font-size: 12.5px; color: var(--bruno);
        transition: background .15s, transform .1s;
      }
      .evento-chip:hover:not(:disabled) { background: #f3e6c6; }
      .evento-chip:active:not(:disabled) { transform: scale(.96); }
      .evento-chip:disabled { opacity: .5; cursor: default; }
      .evento-emoji { font-size: 22px; line-height: 1.1; }

      .pannellino {
        display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
        background: var(--carta); border: 1.5px solid #d3bb84; border-radius: 12px;
        padding: 10px; margin-top: 8px;
      }
      .pannellino.colonna { flex-direction: column; align-items: stretch; }
      .pannellino input {
        flex: 1; min-width: 150px;
        font-family: 'Lora', serif; font-size: 15px;
        border: 1.5px solid #d8c089; border-radius: 8px;
        background: #fffaf0; color: var(--bruno); padding: 10px 12px;
      }
      .pannellino input::placeholder { color: #a8916f; font-style: italic; }

      .scelta-persone { display: flex; flex-wrap: wrap; gap: 8px; }
      .persona {
        display: flex; align-items: center; gap: 7px;
        background: #fffaf0; border: 1.5px solid #d8c089; border-radius: 999px;
        padding: 6px 14px 6px 6px; cursor: pointer;
        font-family: 'Lora', serif; font-size: 14px; color: var(--bruno);
      }
      .persona:hover:not(:disabled) { background: #f3e6c6; }
      .persona:disabled { opacity: .5; }

      .ultima-scena { margin-top: 14px; }
      .gazzetta-link { margin-top: 6px; }

      .scena {
        background: var(--carta); border: 2px solid #c9ad79; border-radius: 14px;
        padding: 12px 16px 14px; margin-bottom: 10px;
        box-shadow: 0 6px 18px rgba(80,55,25,.1);
      }
      .scena header {
        font-family: 'Fraunces', serif; font-size: 12.5px; font-weight: 600;
        color: var(--oliva-scuro); text-transform: uppercase; letter-spacing: .8px;
      }
      .scena .evento { margin: 6px 0 4px; font-style: italic; line-height: 1.5; font-size: 15px; }
      .bolle { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
      .bolle-luogo { font-size: 12px; font-style: italic; color: var(--bruno-chiaro); }
      .bolla {
        max-width: 88%; align-self: flex-start;
        background: #f3e7c8; border: 1px solid #e0cb96;
        border-radius: 14px 14px 14px 4px;
        padding: 8px 12px; font-size: 14.5px; line-height: 1.4;
      }
      .bolla.destra {
        align-self: flex-end;
        background: #e8ecd8; border-color: #c8d0a8;
        border-radius: 14px 14px 4px 14px;
      }
      .bolla-chi {
        display: block; font-family: 'Fraunces', serif; font-weight: 600;
        font-size: 12px; color: var(--terra-scuro); margin-bottom: 2px;
      }
      .bolla.destra .bolla-chi { color: var(--oliva-scuro); }

      .barra-azioni {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
        display: flex; gap: 10px; justify-content: center; align-items: center;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        background: linear-gradient(transparent, rgba(245,235,216,.6) 18%, var(--crema) 55%);
      }
      .grande-btn {
        flex: 1; max-width: 480px; font-size: 18px; padding: 15px 18px;
        border-radius: 16px; font-weight: 600;
        box-shadow: 0 8px 20px rgba(140,63,37,.35);
      }
      .tonda-grande {
        width: 56px; height: 56px; border-radius: 50%; padding: 0; flex-shrink: 0;
        box-shadow: 0 6px 16px rgba(80,55,25,.25);
      }

      .chip {
        display: inline-block; padding: 4px 10px; border-radius: 999px;
        background: #ece0bd; border: 1px solid #d3bb84; font-size: 13px;
      }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 8px; }

      .modal-sfondo {
        position: fixed; inset: 0; background: rgba(45, 28, 12, .55);
        display: flex; align-items: flex-end; justify-content: center;
        z-index: 50;
      }
      .scheda {
        position: relative;
        background: var(--carta); border: 2px solid #c9ad79; border-bottom: none;
        border-radius: 20px 20px 0 0;
        width: min(640px, 100%); max-height: 86vh; overflow-y: auto;
        padding: 10px 20px calc(24px + env(safe-area-inset-bottom));
        box-shadow: 0 -12px 40px rgba(40,22,5,.4);
        animation: sale .22s ease-out;
      }
      @keyframes sale { from { transform: translateY(40px); opacity: .6; } to { transform: none; opacity: 1; } }
      .maniglia {
        width: 44px; height: 5px; border-radius: 3px;
        background: #d3bb84; margin: 4px auto 12px;
      }
      .scheda h2 { margin: 0; font-size: 22px; color: var(--terra-scuro); }
      .scheda h3 {
        margin: 16px 0 8px; font-size: 15px; color: var(--oliva-scuro);
        text-transform: uppercase; letter-spacing: 1px; font-weight: 600;
      }
      .scheda-testa { display: flex; gap: 16px; align-items: center; }
      .sotto { color: var(--bruno-chiaro); font-size: 14px; margin: 3px 0 0; }
      .umore { font-style: italic; margin: 3px 0 0; font-size: 14px; }
      .desiderio { line-height: 1.5; font-size: 14.5px; margin: 8px 0; }
      .chiudi {
        position: absolute; top: 14px; right: 12px;
        background: transparent; border: none; cursor: pointer; color: var(--bruno-chiaro);
        padding: 8px; border-radius: 10px;
      }
      .chiudi:hover { background: #eedfba; }

      .azioni-cittadino { display: flex; gap: 8px; margin-top: 14px; }

      .segreto { margin: 6px 0 4px; }
      .segreto-testo {
        margin: 8px 0 0; padding: 10px 14px;
        background: #f1e0c0; border: 1px dashed var(--terra);
        border-radius: 10px; font-style: italic; line-height: 1.5; font-size: 14.5px;
      }

      .rel-riga { margin-bottom: 10px; }
      .rel-testa { display: flex; justify-content: space-between; font-size: 14.5px; }
      .rel-testa .pos { color: var(--oliva-scuro); font-weight: 600; }
      .rel-testa .neg { color: var(--terra-scuro); font-weight: 600; }
      .rel-barra { display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: #eadfc2; margin-top: 3px; }
      .rel-barra-meta { flex: 1; position: relative; }
      .rel-barra-meta.sinistra { border-right: 1.5px solid #c9ad79; }
      .rel-barra-fill { position: absolute; top: 0; bottom: 0; }
      .rel-barra-fill.positiva { left: 0; background: var(--oliva); }
      .rel-barra-fill.negativa { right: 0; background: var(--terra); }
      .rel-motivo { margin: 3px 0 0; font-size: 13px; color: var(--bruno-chiaro); font-style: italic; }

      .memorie { margin: 6px 0 0; padding-left: 18px; }
      .memorie li { margin-bottom: 6px; line-height: 1.45; font-size: 14px; }

      .gazzetta-titolo {
        display: flex; align-items: center; gap: 8px;
        margin: 0 0 12px; font-size: 21px; color: var(--terra-scuro);
      }

      .schermo-pieno {
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
        text-align: center; padding: 24px;
      }
      .schermo-pieno .titolo { font-size: 38px; color: var(--terra-scuro); }
      .schermo-pieno p { font-style: italic; color: var(--bruno-chiaro); font-size: 16px; margin: 0; }
      .schermo-pieno .err { color: var(--terra-scuro); max-width: 480px; }
      .chiave-riga { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .chiave-riga input {
        font-family: 'Lora', serif; font-size: 15px; width: min(340px, 80vw);
        border: 1.5px solid var(--ocra); border-radius: 8px;
        background: #fffaf0; color: var(--bruno); padding: 10px 12px;
      }
      .nota-chiave { font-size: 13px; max-width: 460px; line-height: 1.5; }

      .gira { animation: gira 1.1s linear infinite; }
      @keyframes gira { to { transform: rotate(360deg); } }

      .toast {
        position: fixed; bottom: calc(94px + env(safe-area-inset-bottom));
        left: 50%; transform: translateX(-50%);
        background: #4a2e1a; color: #f7ecd8; padding: 10px 18px;
        border-radius: 10px; font-size: 14px; cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,.3); z-index: 60;
        max-width: min(620px, calc(100vw - 30px));
      }

      @media (min-width: 700px) {
        .testata .titolo { font-size: 30px; }
      }
    `}</style>
  )
}
