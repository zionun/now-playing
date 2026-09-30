import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HealthIndicator from './HealthIndicator'

let context = {}
vi.mock('../context/WebSocketContext', () => ({
  useWebSocket: () => context
}))

afterEach(cleanup)

describe('HealthIndicator', () => {
  test('hidden when everything works', () => {
    context = { connectionStatus: 'connected', health: { status: 'ok', plex: 'realtime', lastfm: 'ok' } }
    const { container } = render(<HealthIndicator />)
    expect(container.innerHTML).toBe('')
  })

  test('hidden while the kiosk is not connected (the screen already says so)', () => {
    context = {
      connectionStatus: 'disconnected',
      health: { status: 'error', plex: 'unreachable', lastfm: 'ok' }
    }
    const { container } = render(<HealthIndicator />)
    expect(container.innerHTML).toBe('')
  })

  test('red dot when Plex is unreachable, details on tap', () => {
    context = {
      connectionStatus: 'connected',
      health: { status: 'error', plex: 'unreachable', lastfm: 'ok' }
    }
    render(<HealthIndicator />)
    const button = screen.getByRole('button')
    expect(button.className).toContain('error')
    expect(button.querySelector('.health-text')).toBeNull()
    fireEvent.click(button)
    expect(button.querySelector('.health-text')).toBeTruthy()
  })

  test('orange dot when updates fall back to polling', () => {
    context = { connectionStatus: 'connected', health: { status: 'degraded', plex: 'polling', lastfm: 'ok' } }
    render(<HealthIndicator />)
    expect(screen.getByRole('button').className).toContain('degraded')
  })
})
