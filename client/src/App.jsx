import React from 'react'
import { Routes, Route } from 'react-router-dom'
import NowPlayingDisplay from './components/NowPlayingDisplay'
import ConfigurationPanel from './components/ConfigurationPanel'
import LoginScreen from './components/LoginScreen'
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext'

// Mostra la schermata di login Plex al posto dell'interfaccia normale
// finché Plex non è configurato (o se il token è stato revocato/è scaduto).
function Home() {
  const { authRequired, authChecked } = useWebSocket()
  if (!authChecked) return null // evita un flash dell'interfaccia sbagliata
  return authRequired ? <LoginScreen /> : <NowPlayingDisplay />
}

function App() {
  return (
    <WebSocketProvider>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/config" element={<ConfigurationPanel />} />
        </Routes>
      </div>
    </WebSocketProvider>
  )
}

export default App