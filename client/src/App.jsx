import React from 'react'
import { Routes, Route } from 'react-router-dom'
import NowPlayingDisplay from './components/NowPlayingDisplay'
import ConfigurationPanel from './components/ConfigurationPanel'
import { WebSocketProvider } from './context/WebSocketContext'

function App() {
  return (
    <WebSocketProvider>
      <div className="app">
        <Routes>
          <Route path="/" element={<NowPlayingDisplay />} />
          <Route path="/config" element={<ConfigurationPanel />} />
        </Routes>
      </div>
    </WebSocketProvider>
  )
}

export default App