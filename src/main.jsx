import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Due ambienti possibili:
// - dev locale: c'è il backend Vite (/api/health risponde) → proxy API con
//   chiave da .env.local e persistenza su file via /api/storage
// - GitHub Pages (statico): nessun backend → chiamate dirette ad Anthropic
//   con la chiave del visitatore e persistenza in localStorage
const storageServer = {
  async set(key, value) {
    await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: value,
    })
  },
  async get(key) {
    const r = await fetch(`/api/storage/${encodeURIComponent(key)}`)
    if (!r.ok) return null
    return await r.text()
  },
  async remove(key) {
    await fetch(`/api/storage/${encodeURIComponent(key)}`, { method: 'DELETE' })
  },
}

const storageLocale = {
  async set(key, value) {
    localStorage.setItem('borgo:' + key, value)
  },
  async get(key) {
    return localStorage.getItem('borgo:' + key)
  },
  async remove(key) {
    localStorage.removeItem('borgo:' + key)
  },
}

async function avvia() {
  let statico = true
  try {
    const r = await fetch('/api/health')
    if (r.ok) {
      const j = await r.json()
      if (j && j.ok) statico = false
    }
  } catch {
    // nessun backend raggiungibile → modalità statica
  }
  window.__BORGO_STATICO = statico
  window.storage = statico ? storageLocale : storageServer
  createRoot(document.getElementById('root')).render(<App />)
}

avvia()
