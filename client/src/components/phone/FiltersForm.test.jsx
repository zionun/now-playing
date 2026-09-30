import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import FiltersForm from './FiltersForm'
import { api } from './api'

vi.mock('./api', () => ({ api: vi.fn() }))

afterEach(() => {
  cleanup()
  api.mockReset()
})

const options = {
  users: [
    { id: '1', title: 'Anna' },
    { id: '2', title: 'Marco' }
  ],
  players: [{ machineIdentifier: 'p1', title: 'Kitchen', product: 'Plexamp' }]
}

function mockApi() {
  api.mockImplementation(async (path, request) => {
    if (path === '/api/config/filter-options') return options
    if (path === '/api/config' && request?.method === 'POST') return { success: true }
    throw new Error(`unexpected ${path}`)
  })
}

describe('FiltersForm', () => {
  test('empty lists mean "all"; the checkboxes appear only when restricting', async () => {
    mockApi()
    render(<FiltersForm initialFilters={{ lanOnly: false, users: [], players: [] }} onError={() => {}} />)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/config/filter-options'))
    await screen.findAllByRole('radio')

    expect(screen.queryByLabelText('Anna')).toBeNull()
    const [, restrictUsers] = screen.getAllByRole('radio')
    fireEvent.click(restrictUsers)
    expect(screen.getByLabelText('Anna')).toBeTruthy()
  })

  test('saves LAN, users and players together', async () => {
    mockApi()
    const { container } = render(
      <FiltersForm initialFilters={{ lanOnly: false, users: [], players: [] }} onError={() => {}} />
    )
    await screen.findAllByRole('radio')

    // "Only players on the local network"
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByLabelText('Marco'))
    fireEvent.submit(container.querySelector('form'))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/api/config', {
        method: 'POST',
        body: { config: { filters: { lanOnly: true, users: ['2'], players: [] } } }
      })
    )
  })

  test('starts in "selected only" mode when a filter is already set', async () => {
    mockApi()
    render(<FiltersForm initialFilters={{ lanOnly: false, users: ['1'], players: [] }} onError={() => {}} />)
    const checkbox = await screen.findByLabelText('Anna')
    expect(checkbox.checked).toBe(true)
  })
})
