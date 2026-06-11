import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve('.borgo-data')

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// Backend locale: proxy verso l'API Anthropic (la chiave resta sul server,
// mai nel browser) + storage chiave/valore su file che fa da window.storage.
function borgoBackend(getApiKey) {
  return {
    name: 'borgo-backend',
    configureServer(server) {
      // Permette al client di capire se c'è un backend (dev locale) o no (GitHub Pages)
      server.middlewares.use('/api/health', (req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
      })

      server.middlewares.use('/api/anthropic', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        const apiKey = getApiKey()
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          return res.end(
            JSON.stringify({
              error:
                'ANTHROPIC_API_KEY non impostata: mettila in un file .env.local (ANTHROPIC_API_KEY=sk-ant-...) e riavvia il server.',
            })
          )
        }
        try {
          const body = await readBody(req)
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body,
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', 'application/json')
          res.end(text)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      server.middlewares.use('/api/storage', async (req, res) => {
        const key = decodeURIComponent((req.url || '/').slice(1)).replace(
          /[^a-zA-Z0-9_-]/g,
          ''
        )
        if (!key) {
          res.statusCode = 400
          return res.end()
        }
        const file = path.join(DATA_DIR, key + '.json')
        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await readBody(req)
          fs.mkdirSync(DATA_DIR, { recursive: true })
          fs.writeFileSync(file, body, 'utf8')
          res.statusCode = 204
          return res.end()
        }
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) {
            res.statusCode = 404
            return res.end()
          }
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          return res.end(fs.readFileSync(file, 'utf8'))
        }
        if (req.method === 'DELETE') {
          if (fs.existsSync(file)) fs.unlinkSync(file)
          res.statusCode = 204
          return res.end()
        }
        res.statusCode = 405
        res.end()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // La chiave può stare in .env.local (non committarlo) o nell'ambiente
  const env = loadEnv(mode, process.cwd(), '')
  const getApiKey = () => env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  return {
    // BASE_PATH è impostato dalla build di GitHub Pages (es. /borgo-vivente/)
    base: process.env.BASE_PATH || '/',
    plugins: [react(), borgoBackend(getApiKey)],
  }
})
