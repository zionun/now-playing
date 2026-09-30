import { Routes, Route } from 'react-router-dom'
import NowPlayingDisplay from './components/NowPlayingDisplay'
import ConfigurationPanel from './components/ConfigurationPanel'
import LoginScreen from './components/LoginScreen'
import SetupPage from './components/phone/SetupPage'
import HealthIndicator from './components/HealthIndicator'
import ScreenSleep from './components/ScreenSleep'
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext'

// Shows the setup QR code instead of the normal interface until the device
// is set up (or when the Plex token has been revoked).
function Home() {
  const { authRequired, authChecked } = useWebSocket()
  if (!authChecked) return null // avoids a flash of the wrong screen
  if (authRequired) return <LoginScreen />
  return (
    <>
      <NowPlayingDisplay />
      <HealthIndicator />
      <ScreenSleep />
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
