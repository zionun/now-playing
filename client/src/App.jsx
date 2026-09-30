import { Routes, Route } from 'react-router-dom'
import NowPlayingDisplay from './components/NowPlayingDisplay'
import ConfigurationPanel from './components/ConfigurationPanel'
import LoginScreen, { ConfigQrButton } from './components/LoginScreen'
import SetupPage from './components/phone/SetupPage'
import HealthIndicator from './components/HealthIndicator'
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext'

// Mostra il QR di configurazione al posto dell'interfaccia normale finché il
// dispositivo non è configurato (o se il token Plex è stato revocato).
function Home() {
  const { authRequired, authChecked } = useWebSocket()
  if (!authChecked) return null // evita un flash dell'interfaccia sbagliata
  if (authRequired) return <LoginScreen />
  return (
    <>
      <NowPlayingDisplay />
      <ConfigQrButton />
      <HealthIndicator />
    </>
  )
}

function App() {
  return (
    <WebSocketProvider>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/config" element={<ConfigurationPanel />} />
        </Routes>
      </div>
    </WebSocketProvider>
  )
}

export default App
