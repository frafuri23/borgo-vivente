import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Play,
  Pause,
  ChevronRight,
  Sparkles,
  Wind,
  MessagesSquare,
  RefreshCw,
  Eye,
  EyeOff,
  X,
  Loader2,
  Megaphone,
  ScrollText,
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

// Coordinate in uno spazio 800x600 (poi convertite in %)
const LUOGHI = {
  piazza: { nome: 'La Piazza', x: 400, y: 330 },
  chiesa: { nome: 'La Chiesa', x: 400, y: 120 },
  osteria: { nome: "L'Osteria del Cinghiale", x: 645, y: 250 },
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
Ogni cittadino ha: id ("c1"..."c7"), nome (italiano, con cognome), eta, mestiere, personalita (3-4 tratti forti e in tensione tra loro), segreto (concreto, potenzialmente esplosivo), desiderio, umore iniziale, luogo iniziale.
Crea anche relazioni iniziali interessanti e asimmetriche: amicizie, rivalità, debiti, amori non corrisposti. Valori da -100 a +100.
Luoghi validi: ${NOMI_LUOGHI_VALIDI.join(', ')}.

Rispondi SOLO con questo JSON:
{
  "nome_borgo": "nome inventato del borgo",
  "cittadini": [
    {"id":"c1","nome":"...","eta":0,"mestiere":"...","personalita":["...","...","..."],"segreto":"...","desiderio":"...","umore":"...","luogo":"piazza"}
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
- "evento" è la cronaca del turno in 2-3 frasi, stile gazzetta di paese.
- Luoghi validi: ${NOMI_LUOGHI_VALIDI.join(', ')}.
- SII CONCISO: memorie di 1 frase breve, "azione" max 8 parole, "motivo" delle relazioni max 12 parole. JSON compatto su una sola riga, senza indentazione né a capo. La risposta intera deve restare ben sotto i 3500 token.

Rispondi SOLO con questo JSON:
{
  "evento": "cronaca del turno",
  "azioni": [{"id":"c1","luogo":"osteria","azione":"cosa fa, breve","umore":"umore aggiornato"}],
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
// Componenti
// ---------------------------------------------------------------------------

function BarraRelazione({ valore }) {
  const pct = Math.abs(valore)
  const positivo = valore >= 0
  return (
    <div className="rel-barra">
      <div className="rel-barra-meta sinistra">
        {!positivo && (
          <div
            className="rel-barra-fill negativa"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="rel-barra-meta">
        {positivo && (
          <div
            className="rel-barra-fill positiva"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  )
}

function SchedaCittadino({ cittadino, stato, onChiudi }) {
  const [mostraSegreto, setMostraSegreto] = useState(false)
  const relazioni = Object.entries(stato.relazioni)
    .filter(([k]) => k.startsWith(cittadino.id + '>'))
    .map(([k, v]) => {
      const altroId = k.split('>')[1]
      const altro = stato.cittadini.find((c) => c.id === altroId)
      return altro ? { altro, ...v } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.valore - a.valore)

  return (
    <div className="modal-sfondo" onClick={onChiudi}>
      <div className="scheda" onClick={(e) => e.stopPropagation()}>
        <button className="chiudi" onClick={onChiudi} aria-label="Chiudi">
          <X size={18} />
        </button>
        <div className="scheda-testa">
          <div className="gettone grande">{iniziali(cittadino.nome)}</div>
          <div>
            <h2>{cittadino.nome}</h2>
            <p className="sotto">
              {cittadino.eta} anni · {cittadino.mestiere} ·{' '}
              {luogoLabel(cittadino.luogo, cittadino)}
            </p>
            <p className="umore">Umore: {cittadino.umore}</p>
          </div>
        </div>

        <div className="chips">
          {cittadino.personalita.map((t, i) => (
            <span key={i} className="chip">
              {t}
            </span>
          ))}
        </div>

        <p className="desiderio">
          <em>Desidera:</em> {cittadino.desiderio}
        </p>

        <div className="segreto">
          <button
            className="btn fantasma"
            onClick={() => setMostraSegreto((v) => !v)}
          >
            {mostraSegreto ? <EyeOff size={15} /> : <Eye size={15} />}
            {mostraSegreto ? 'Nascondi il segreto' : 'Mostra il segreto'}
          </button>
          {mostraSegreto && <p className="segreto-testo">{cittadino.segreto}</p>}
        </div>

        <h3>Relazioni</h3>
        {relazioni.length === 0 && (
          <p className="sotto">Nessuna relazione registrata.</p>
        )}
        {relazioni.map((r, i) => (
          <div key={i} className="rel-riga">
            <div className="rel-testa">
              <span>{r.altro.nome.split(' ')[0]}</span>
              <span className={r.valore >= 0 ? 'pos' : 'neg'}>
                {r.valore > 0 ? '+' : ''}
                {r.valore}
              </span>
            </div>
            <BarraRelazione valore={r.valore} />
            {r.descrizione && <p className="rel-motivo">{r.descrizione}</p>}
          </div>
        ))}

        <h3>Memorie recenti</h3>
        {cittadino.memorie.length === 0 && (
          <p className="sotto">Ancora nessun ricordo.</p>
        )}
        <ul className="memorie">
          {cittadino.memorie
            .slice()
            .reverse()
            .map((m, i) => (
              <li key={i}>{m}</li>
            ))}
        </ul>
      </div>
    </div>
  )
}

function iniziali(nome) {
  return String(nome || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
}

function luogoLabel(luogo, cittadino) {
  if (luogo === 'casa') return `a casa`
  return LUOGHI[luogo]?.nome || luogo
}

function Mappa({ stato, onCittadino, selezionato }) {
  // Raggruppa i cittadini per luogo per distribuirli intorno al punto
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
    const gruppo =
      c.luogo === 'casa' ? [c] : gruppi[c.luogo] || [c]
    const i = gruppo.findIndex((x) => x.id === c.id)
    const n = gruppo.length
    let dx = 0
    let dy = 0
    if (n > 1) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2
      dx = Math.cos(ang) * 30
      dy = Math.sin(ang) * 22
    }
    return {
      left: `${((base.x + dx) / 800) * 100}%`,
      top: `${((base.y + dy) / 600) * 100}%`,
    }
  }

  return (
    <div className="mappa">
      <svg viewBox="0 0 800 600" preserveAspectRatio="none" className="mappa-svg">
        {/* terreno */}
        <rect x="0" y="0" width="800" height="600" fill="#e9dcb8" />
        <rect x="0" y="0" width="800" height="600" fill="url(#trama)" opacity="0.5" />
        <defs>
          <pattern id="trama" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#d9c79a" />
          </pattern>
        </defs>

        {/* strade */}
        <path
          d="M 400 180 L 400 300 M 400 360 C 400 430 330 470 250 460 M 400 360 C 410 440 520 460 615 455 M 430 320 C 520 300 580 280 630 262 M 370 320 C 290 300 230 270 185 250 M 250 470 C 200 500 150 520 110 540"
          stroke="#cdb88a"
          strokeWidth="26"
          fill="none"
          strokeLinecap="round"
        />

        {/* campi */}
        <g transform="translate(40,495)">
          <rect x="0" y="0" width="130" height="80" rx="6" fill="#8a9a55" />
          {[12, 32, 52, 72, 92, 112].map((x) => (
            <line key={x} x1={x} y1="6" x2={x} y2="74" stroke="#6b7a46" strokeWidth="5" />
          ))}
        </g>

        {/* piazza con fontana */}
        <ellipse cx="400" cy="330" rx="95" ry="58" fill="#d8c290" />
        <ellipse cx="400" cy="330" rx="95" ry="58" fill="none" stroke="#c2ab77" strokeWidth="3" />
        <circle cx="400" cy="330" r="14" fill="#8fa8b8" stroke="#5e7889" strokeWidth="3" />
        <circle cx="400" cy="330" r="5" fill="#dfeaf1" />

        {/* chiesa */}
        <g transform="translate(355,55)">
          <rect x="10" y="38" width="70" height="58" fill="#e7d3ae" stroke="#a98e63" strokeWidth="2" />
          <polygon points="5,40 45,8 85,40" fill="#b85c38" stroke="#8c3f25" strokeWidth="2" />
          <rect x="62" y="0" width="20" height="96" fill="#dec9a2" stroke="#a98e63" strokeWidth="2" />
          <polygon points="58,2 72,-16 86,2" fill="#b85c38" />
          <line x1="72" y1="-16" x2="72" y2="-28" stroke="#6b5232" strokeWidth="2.5" />
          <line x1="66" y1="-23" x2="78" y2="-23" stroke="#6b5232" strokeWidth="2.5" />
          <rect x="36" y="66" width="16" height="30" rx="8" fill="#7a5c38" />
        </g>

        {/* osteria */}
        <g transform="translate(600,205)">
          <rect x="0" y="22" width="86" height="52" fill="#e3c89b" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,24 43,-6 92,24" fill="#a85a32" stroke="#82431f" strokeWidth="2" />
          <rect x="12" y="44" width="14" height="30" fill="#7a5c38" />
          <rect x="52" y="40" width="20" height="16" fill="#f4e6c8" stroke="#a98e63" />
          <circle cx="80" cy="34" r="7" fill="#6b7a46" />
        </g>

        {/* forno */}
        <g transform="translate(118,195)">
          <rect x="0" y="18" width="76" height="46" fill="#e8d2a8" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,20 38,-8 82,20" fill="#c1693f" stroke="#8c3f25" strokeWidth="2" />
          <rect x="50" y="-2" width="12" height="22" fill="#9a7d52" />
          <path d="M 56 -8 q 4 -8 0 -14" stroke="#bbb3a2" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="12" y="36" width="14" height="28" fill="#7a5c38" />
        </g>

        {/* bottega */}
        <g transform="translate(588,415)">
          <rect x="0" y="16" width="80" height="46" fill="#e3cda4" stroke="#a98e63" strokeWidth="2" />
          <polygon points="-6,18 40,-8 86,18" fill="#b85c38" stroke="#8c3f25" strokeWidth="2" />
          <rect x="10" y="34" width="26" height="28" fill="#d9a04b" stroke="#a87830" />
          <rect x="48" y="36" width="22" height="14" fill="#f4e6c8" stroke="#a98e63" />
        </g>

        {/* mercato (tettoia) */}
        <g transform="translate(140,405)">
          <polygon points="0,20 45,-4 90,20" fill="#d9a04b" stroke="#a87830" strokeWidth="2" />
          <line x1="8" y1="20" x2="8" y2="58" stroke="#8a6b40" strokeWidth="4" />
          <line x1="82" y1="20" x2="82" y2="58" stroke="#8a6b40" strokeWidth="4" />
          <rect x="18" y="38" width="54" height="14" fill="#c7a96e" />
        </g>

        {/* casette */}
        {CASE.map((p, i) => (
          <g key={i} transform={`translate(${p.x - 22},${p.y - 14})`}>
            <rect x="0" y="10" width="44" height="26" fill="#ead7ae" stroke="#a98e63" strokeWidth="1.5" />
            <polygon points="-4,12 22,-6 48,12" fill="#b56a45" stroke="#8c4f2e" strokeWidth="1.5" />
            <rect x="17" y="20" width="10" height="16" fill="#7a5c38" />
          </g>
        ))}

        {/* cipressi */}
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

        {/* etichette */}
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
            className={
              'gettone token' + (selezionato === c.id ? ' selezionato' : '')
            }
            style={pos}
            onClick={() => onCittadino(c)}
            title={`${c.nome} — ${c.umore}`}
          >
            {iniziali(c.nome)}
          </button>
        )
      })}
    </div>
  )
}

function Cronaca({ stato }) {
  const perNome = useMemo(() => {
    const m = {}
    stato.cittadini.forEach((c) => (m[c.id] = c.nome.split(' ')[0]))
    return m
  }, [stato.cittadini])

  return (
    <div className="cronaca">
      <h2>
        <ScrollText size={17} /> La Gazzetta del Borgo
      </h2>
      <div className="cronaca-scroll">
        {stato.cronaca.map((e, i) => (
          <article key={i} className="voce">
            <header>
              {MOMENTO_EMOJI[e.momento]} Giorno {e.giorno} —{' '}
              {MOMENTO_LABEL[e.momento]}
            </header>
            <p className="evento">{e.evento}</p>
            {e.dialoghi.map((d, j) => (
              <div key={j} className="dialogo">
                {d.luogo && (
                  <div className="dialogo-luogo">
                    {LUOGHI[d.luogo]?.nome || 'In paese'}
                  </div>
                )}
                {d.battute.map((b, k) => (
                  <p key={k}>
                    <strong>{perNome[b.chi] || b.chi}:</strong> «{b.testo}»
                  </p>
                ))}
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  )
}

function PannelloOsservatore({ stato, onIntervento, disabilitato }) {
  const [evento, setEvento] = useState('')
  const [sussurroA, setSussurroA] = useState('')
  const [sussurro, setSussurro] = useState('')
  const [conv1, setConv1] = useState('')
  const [conv2, setConv2] = useState('')

  return (
    <div className="osservatore">
      <h2>
        <Sparkles size={17} /> La mano dell'osservatore
      </h2>

      <div className="oss-riga">
        <Megaphone size={15} className="oss-icona" />
        <input
          value={evento}
          onChange={(e) => setEvento(e.target.value)}
          placeholder='Lancia un evento: "arriva un forestiero misterioso…"'
          disabled={disabilitato}
        />
        <button
          className="btn"
          disabled={disabilitato || !evento.trim()}
          onClick={() => {
            onIntervento({ tipo: 'evento', testo: evento.trim() })
            setEvento('')
          }}
        >
          Annuncia
        </button>
      </div>

      <div className="oss-riga">
        <Wind size={15} className="oss-icona" />
        <select
          value={sussurroA}
          onChange={(e) => setSussurroA(e.target.value)}
          disabled={disabilitato}
        >
          <option value="">Sussurra a…</option>
          {stato.cittadini.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <input
          value={sussurro}
          onChange={(e) => setSussurro(e.target.value)}
          placeholder="Cosa gli sussurri nell'orecchio?"
          disabled={disabilitato}
        />
        <button
          className="btn"
          disabled={disabilitato || !sussurroA || !sussurro.trim()}
          onClick={() => {
            onIntervento({ tipo: 'sussurro', a: sussurroA, testo: sussurro.trim() })
            setSussurro('')
            setSussurroA('')
          }}
        >
          Sussurra
        </button>
      </div>

      <div className="oss-riga">
        <MessagesSquare size={15} className="oss-icona" />
        <select value={conv1} onChange={(e) => setConv1(e.target.value)} disabled={disabilitato}>
          <option value="">Fai parlare…</option>
          {stato.cittadini.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <select value={conv2} onChange={(e) => setConv2(e.target.value)} disabled={disabilitato}>
          <option value="">…con…</option>
          {stato.cittadini
            .filter((c) => c.id !== conv1)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
        </select>
        <button
          className="btn"
          disabled={disabilitato || !conv1 || !conv2}
          onClick={() => {
            onIntervento({ tipo: 'conversazione', tra: [conv1, conv2] })
            setConv1('')
            setConv2('')
          }}
        >
          Avvia
        </button>
      </div>

      {(stato.eventiPendenti.length > 0 || stato.conversazioneForzata) && (
        <div className="pendenti">
          {stato.eventiPendenti.map((e, i) => (
            <span key={i} className="chip pendente">
              ⚡ {e}
            </span>
          ))}
          {stato.conversazioneForzata && (
            <span className="chip pendente">
              💬 conversazione in arrivo
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function SchermataChiave({ onPronto }) {
  const [chiave, setChiave] = useState('')
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && chiave.trim().startsWith('sk-ant-')) {
              localStorage.setItem('borgo-api-key', chiave.trim())
              onPronto()
            }
          }}
        />
        <button
          className="btn primario"
          disabled={!chiave.trim().startsWith('sk-ant-')}
          onClick={() => {
            localStorage.setItem('borgo-api-key', chiave.trim())
            onPronto()
          }}
        >
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

export default function App() {
  const [stato, setStato] = useState(null)
  const [fase, setFase] = useState('caricamento') // caricamento | chiave | genesi | pronto | errore-genesi
  const [turnoInCorso, setTurnoInCorso] = useState(false)
  const [errore, setErrore] = useState(null)
  const [selezionato, setSelezionato] = useState(null)
  const [autoplay, setAutoplay] = useState(false)
  const [velocita, setVelocita] = useState(10000)

  const turnoRef = useRef(false)
  const statoRef = useRef(null)
  statoRef.current = stato

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
      const parsed = await chiamaClaudeJson(
        SYSTEM_JSON,
        promptGenesi(),
        MAX_TOKENS_GENESI
      )
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

  async function avanzaTurno() {
    if (turnoRef.current || !statoRef.current) return
    turnoRef.current = true
    setTurnoInCorso(true)
    setErrore(null)
    const corrente = statoRef.current
    try {
      const parsed = await chiamaClaudeJson(
        SYSTEM_JSON,
        promptTurno(corrente),
        MAX_TOKENS_TURNO
      )
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

  function gestisciIntervento(intervento) {
    setStato((prev) => {
      const nuovo = structuredClone(prev)
      if (intervento.tipo === 'evento') {
        nuovo.eventiPendenti.push(intervento.testo)
      } else if (intervento.tipo === 'sussurro') {
        const c = nuovo.cittadini.find((x) => x.id === intervento.a)
        if (c) {
          c.memorie.push(
            `Una voce che solo io ho sentito mi ha sussurrato: "${intervento.testo}"`
          )
        }
      } else if (intervento.tipo === 'conversazione') {
        nuovo.conversazioneForzata = intervento.tra
      }
      salva(nuovo)
      return nuovo
    })
  }

  async function nuovoVillaggio() {
    if (
      !window.confirm(
        'Radere al suolo il borgo e fondarne uno nuovo? Tutto andrà perduto.'
      )
    )
      return
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
    stato && selezionato
      ? stato.cittadini.find((c) => c.id === selezionato)
      : null

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
            <div className="testata-sx">
              <h1 className="titolo">{stato.nomeBorgo}</h1>
              <span className="data">
                {MOMENTO_EMOJI[stato.momento]} Giorno {stato.giorno} ·{' '}
                {MOMENTO_LABEL[stato.momento]}
              </span>
            </div>
            <div className="comandi">
              <button
                className="btn primario"
                onClick={avanzaTurno}
                disabled={turnoInCorso}
              >
                {turnoInCorso ? (
                  <Loader2 size={16} className="gira" />
                ) : (
                  <ChevronRight size={16} />
                )}
                {turnoInCorso ? 'Il borgo vive…' : 'Avanza'}
              </button>
              <button
                className={'btn' + (autoplay ? ' attivo' : '')}
                onClick={() => setAutoplay((v) => !v)}
              >
                {autoplay ? <Pause size={15} /> : <Play size={15} />}
                {autoplay ? 'Pausa' : 'Auto'}
              </button>
              <select
                className="velocita"
                value={velocita}
                onChange={(e) => setVelocita(Number(e.target.value))}
              >
                <option value={18000}>Lento</option>
                <option value={10000}>Normale</option>
                <option value={5000}>Veloce</option>
              </select>
              <button className="btn pericolo" onClick={nuovoVillaggio}>
                <RefreshCw size={15} /> Nuovo villaggio
              </button>
              {ambienteStatico() && (
                <button
                  className="btn"
                  title="Cambia chiave API"
                  onClick={() => {
                    localStorage.removeItem('borgo-api-key')
                    setAutoplay(false)
                    setFase('chiave')
                  }}
                >
                  🔑
                </button>
              )}
            </div>
          </header>

          <main className="griglia">
            <div className="colonna-mappa">
              <Mappa
                stato={stato}
                selezionato={selezionato}
                onCittadino={(c) =>
                  setSelezionato((s) => (s === c.id ? null : c.id))
                }
              />
              <PannelloOsservatore
                stato={stato}
                onIntervento={gestisciIntervento}
                disabilitato={turnoInCorso}
              />
            </div>
            <Cronaca stato={stato} />
          </main>

          {cittadinoSelezionato && (
            <SchedaCittadino
              cittadino={cittadinoSelezionato}
              stato={stato}
              onChiudi={() => setSelezionato(null)}
            />
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
// Stile
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
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        background:
          radial-gradient(1200px 600px at 20% -10%, #fdf6e6 0%, transparent 60%),
          var(--crema);
        color: var(--bruno);
        font-family: 'Lora', Georgia, serif;
      }
      .titolo {
        font-family: 'Fraunces', Georgia, serif;
        font-weight: 800;
        margin: 0;
        letter-spacing: 0.5px;
      }
      h2, h3 { font-family: 'Fraunces', Georgia, serif; }

      .pagina { max-width: 1280px; margin: 0 auto; padding: 18px 20px 40px; }
      .testata {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 12px;
        padding-bottom: 14px; margin-bottom: 16px;
        border-bottom: 3px double var(--ocra);
      }
      .testata-sx { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
      .testata .titolo { font-size: 30px; color: var(--terra-scuro); }
      .data { font-style: italic; color: var(--bruno-chiaro); }
      .comandi { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

      .btn {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: 'Lora', serif; font-size: 14px;
        background: var(--carta); color: var(--bruno);
        border: 1.5px solid var(--ocra); border-radius: 8px;
        padding: 8px 14px; cursor: pointer;
        transition: background .15s, transform .1s;
      }
      .btn:hover:not(:disabled) { background: #f3e6c6; }
      .btn:active:not(:disabled) { transform: translateY(1px); }
      .btn:disabled { opacity: .5; cursor: default; }
      .btn.primario { background: var(--terra); border-color: var(--terra-scuro); color: #fff7ec; }
      .btn.primario:hover:not(:disabled) { background: var(--terra-scuro); }
      .btn.attivo { background: var(--oliva); border-color: var(--oliva-scuro); color: #f5f2e4; }
      .btn.pericolo { border-color: #b06a55; color: #8c3f25; }
      .btn.fantasma { border: none; background: transparent; padding: 4px 0; color: var(--terra-scuro); }
      .velocita {
        font-family: 'Lora', serif; font-size: 14px;
        border: 1.5px solid var(--ocra); border-radius: 8px;
        background: var(--carta); color: var(--bruno); padding: 8px 10px;
      }

      .griglia { display: grid; grid-template-columns: 1fr 400px; gap: 18px; align-items: start; }
      @media (max-width: 980px) { .griglia { grid-template-columns: 1fr; } }
      .colonna-mappa { display: flex; flex-direction: column; gap: 16px; }

      .mappa {
        position: relative; width: 100%; aspect-ratio: 4 / 3;
        border-radius: 14px; overflow: hidden;
        border: 2px solid #c9ad79;
        box-shadow: 0 8px 24px rgba(80, 55, 25, .15);
        background: #e9dcb8;
      }
      .mappa-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .etichetta {
        font-family: 'Fraunces', serif; font-size: 15px; font-style: italic;
        fill: #6b5232; opacity: .85;
      }

      .gettone {
        display: flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--terra); color: #fff4e3;
        font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px;
        border: 2.5px solid #fff0d6;
        box-shadow: 0 3px 8px rgba(60, 35, 10, .35);
      }
      .gettone.grande { width: 56px; height: 56px; font-size: 19px; }
      .token {
        position: absolute; transform: translate(-50%, -50%);
        cursor: pointer; padding: 0;
        transition: left 1.4s cubic-bezier(.45,.05,.35,1), top 1.4s cubic-bezier(.45,.05,.35,1), box-shadow .2s;
      }
      .token:hover { box-shadow: 0 0 0 4px rgba(217,160,75,.5), 0 3px 8px rgba(60,35,10,.35); }
      .token.selezionato { box-shadow: 0 0 0 4px var(--ocra), 0 3px 8px rgba(60,35,10,.35); }

      .cronaca {
        background: var(--carta); border: 2px solid #c9ad79; border-radius: 14px;
        box-shadow: 0 8px 24px rgba(80,55,25,.12);
        display: flex; flex-direction: column;
        max-height: calc(100vh - 140px); min-height: 420px;
      }
      .cronaca h2 {
        display: flex; align-items: center; gap: 8px;
        margin: 0; padding: 14px 18px 10px; font-size: 20px; color: var(--terra-scuro);
        border-bottom: 1px solid #e2cf9f;
      }
      .cronaca-scroll { overflow-y: auto; padding: 6px 18px 16px; }
      .voce { padding: 12px 0; border-bottom: 1px dashed #d8c089; }
      .voce header {
        font-family: 'Fraunces', serif; font-size: 13px; font-weight: 600;
        color: var(--oliva-scuro); text-transform: uppercase; letter-spacing: .8px;
      }
      .voce .evento { margin: 6px 0; font-style: italic; line-height: 1.5; }
      .dialogo {
        margin: 8px 0 0; padding: 8px 12px;
        background: #f3e7c8; border-left: 3px solid var(--ocra); border-radius: 0 8px 8px 0;
      }
      .dialogo p { margin: 4px 0; font-size: 14.5px; line-height: 1.45; }
      .dialogo-luogo { font-size: 12px; font-style: italic; color: var(--bruno-chiaro); margin-bottom: 2px; }

      .osservatore {
        background: var(--carta); border: 2px solid #c9ad79; border-radius: 14px;
        padding: 14px 18px 16px; box-shadow: 0 8px 24px rgba(80,55,25,.12);
      }
      .osservatore h2 { margin: 0 0 12px; font-size: 19px; color: var(--terra-scuro); display: flex; align-items: center; gap: 8px; }
      .oss-riga { display: flex; gap: 8px; align-items: center; margin-bottom: 9px; flex-wrap: wrap; }
      .oss-icona { color: var(--oliva-scuro); flex-shrink: 0; }
      .oss-riga input, .oss-riga select {
        flex: 1; min-width: 120px;
        font-family: 'Lora', serif; font-size: 14px;
        border: 1.5px solid #d8c089; border-radius: 8px;
        background: #fffaf0; color: var(--bruno); padding: 8px 10px;
      }
      .oss-riga input::placeholder { color: #a8916f; font-style: italic; }
      .pendenti { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }

      .chip {
        display: inline-block; padding: 4px 10px; border-radius: 999px;
        background: #ece0bd; border: 1px solid #d3bb84; font-size: 13px;
      }
      .chip.pendente { background: #f6e3c0; border-color: var(--ocra); font-style: italic; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }

      .modal-sfondo {
        position: fixed; inset: 0; background: rgba(45, 28, 12, .55);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; z-index: 50;
      }
      .scheda {
        position: relative;
        background: var(--carta); border: 2px solid #c9ad79; border-radius: 16px;
        width: min(560px, 100%); max-height: 86vh; overflow-y: auto;
        padding: 22px 26px; box-shadow: 0 18px 50px rgba(40,22,5,.4);
      }
      .scheda h2 { margin: 0; font-size: 24px; color: var(--terra-scuro); }
      .scheda h3 {
        margin: 18px 0 8px; font-size: 16px; color: var(--oliva-scuro);
        text-transform: uppercase; letter-spacing: 1px; font-weight: 600;
      }
      .scheda-testa { display: flex; gap: 16px; align-items: center; }
      .sotto { color: var(--bruno-chiaro); font-size: 14px; margin: 4px 0 0; }
      .umore { font-style: italic; margin: 4px 0 0; font-size: 14.5px; }
      .desiderio { line-height: 1.5; }
      .chiudi {
        position: absolute; top: 12px; right: 12px;
        background: transparent; border: none; cursor: pointer; color: var(--bruno-chiaro);
        padding: 6px; border-radius: 8px;
      }
      .chiudi:hover { background: #eedfba; }
      .segreto { margin: 8px 0 4px; }
      .segreto-testo {
        margin: 8px 0 0; padding: 10px 14px;
        background: #f1e0c0; border: 1px dashed var(--terra);
        border-radius: 10px; font-style: italic; line-height: 1.5;
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

      .memorie { margin: 0; padding-left: 18px; }
      .memorie li { margin-bottom: 6px; line-height: 1.45; font-size: 14.5px; }

      .schermo-pieno {
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
        text-align: center; padding: 24px;
      }
      .schermo-pieno .titolo { font-size: 40px; color: var(--terra-scuro); }
      .schermo-pieno p { font-style: italic; color: var(--bruno-chiaro); font-size: 17px; }
      .schermo-pieno .err { color: var(--terra-scuro); max-width: 480px; }
      .chiave-riga { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .chiave-riga input {
        font-family: 'Lora', serif; font-size: 15px; width: min(340px, 80vw);
        border: 1.5px solid var(--ocra); border-radius: 8px;
        background: #fffaf0; color: var(--bruno); padding: 10px 12px;
      }
      .nota-chiave { font-size: 13.5px; max-width: 460px; line-height: 1.5; }

      .gira { animation: gira 1.1s linear infinite; }
      @keyframes gira { to { transform: rotate(360deg); } }

      .toast {
        position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
        background: #4a2e1a; color: #f7ecd8; padding: 10px 18px;
        border-radius: 10px; font-size: 14px; cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,.3); z-index: 60;
        max-width: min(620px, calc(100vw - 40px));
      }
    `}</style>
  )
}
