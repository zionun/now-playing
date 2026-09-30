import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TouchOverlay from './TouchOverlay'

const sendMediaControl = vi.fn()
const switchUser = vi.fn()

vi.mock('../context/WebSocketContext', () => ({
  useWebSocket: () => ({ sendMediaControl, switchUser })
}))

afterEach(() => {
  cleanup()
  sendMediaControl.mockClear()
  switchUser.mockClear()
})

const track = { title: 'Song', artist: 'Artist' }

describe('TouchOverlay', () => {
  test('shows the playback controls only when the player accepts commands', () => {
    render(<TouchOverlay show onClose={() => {}} track={track} isPlaying hasControls />)
    expect(screen.getByLabelText('Previous track')).toBeTruthy()
    expect(screen.getByLabelText('Pause')).toBeTruthy()
    expect(screen.getByLabelText('Next track')).toBeTruthy()
  })

  test('without controls: no buttons, only an explanation', () => {
    const { container } = render(
      <TouchOverlay show onClose={() => {}} track={track} isPlaying hasControls={false} />
    )
    expect(screen.queryByLabelText('Pause')).toBeNull()
    expect(container.querySelector('.controls-unavailable')).toBeTruthy()
  })

  test('a control sends the command and closes the overlay', () => {
    const onClose = vi.fn()
    render(<TouchOverlay show onClose={onClose} track={track} isPlaying hasControls />)
    fireEvent.click(screen.getByLabelText('Pause'))
    expect(sendMediaControl).toHaveBeenCalledWith('pause')
    expect(onClose).toHaveBeenCalled()
  })

  test('player switcher appears only with several players of the same user', () => {
    const players = [
      { id: 'a', name: 'Kitchen' },
      { id: 'b', name: 'Living room' }
    ]
    render(
      <TouchOverlay
        show
        onClose={() => {}}
        track={track}
        isPlaying
        hasControls
        multiplePlayers
        activeUsers={players}
        selectedUser="a"
      />
    )
    fireEvent.click(screen.getByText('Living room'))
    expect(switchUser).toHaveBeenCalledWith('b')
  })

  test('renders nothing when hidden', () => {
    const { container } = render(<TouchOverlay show={false} onClose={() => {}} track={track} />)
    expect(container.innerHTML).toBe('')
  })
})
