import dgram from 'dgram'

// 📋 GDM (G'Day Mate) - La discovery nativa di Plex sulla rete locale.
// Si invia un M-SEARCH in broadcast sulla porta UDP 32412 e i player Plex
// (Plexamp, Plex HTPC, app TV...) rispondono con nome, porta e capacità.
// Niente comandi di shell né dipendenze esterne come nmap.
const GDM_PLAYER_PORT = 32412
const SEARCH_MESSAGE = Buffer.from('M-SEARCH * HTTP/1.1\r\n\r\n')

export function parseGdmResponse(text) {
  const lines = String(text).split(/\r?\n/)
  if (!/^HTTP\/1\.[01] 200/.test(lines[0] || '')) return null
  const headers = {}
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':')
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  const machineIdentifier = headers['resource-identifier']
  if (!machineIdentifier) return null
  return {
    machineIdentifier,
    name: headers.name || headers.product || 'Player',
    product: headers.product || '',
    port: parseInt(headers.port, 10) || 32500,
    capabilities: (headers['protocol-capabilities'] || '').split(',').map(s => s.trim()).filter(Boolean),
    deviceClass: headers['device-class'] || ''
  }
}

// Restituisce i player che hanno risposto entro timeoutMs
export function discoverPlayers({ timeoutMs = 2500, broadcastAddress = '255.255.255.255' } = {}) {
  return new Promise(resolve => {
    const found = new Map()
    let socket
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    } catch {
      resolve([])
      return
    }

    const finish = () => {
      try { socket.close() } catch { /* già chiuso */ }
      resolve([...found.values()])
    }

    socket.on('error', finish)
    socket.on('message', (message, remote) => {
      const player = parseGdmResponse(message.toString())
      if (player) found.set(player.machineIdentifier, { ...player, address: remote.address })
    })

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
        socket.send(SEARCH_MESSAGE, GDM_PLAYER_PORT, broadcastAddress)
      } catch {
        finish()
        return
      }
      setTimeout(finish, timeoutMs)
    })
  })
}
