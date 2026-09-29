// Sessioni di esempio nel formato di /status/sessions
export function track({ machine, user = 1, state = 'playing', ratingKey = 'r1', title = 'Song', location = 'lan', type = 'track', address = '192.168.1.20' }) {
  return {
    type,
    ratingKey,
    sessionKey: `s-${machine}`,
    title,
    grandparentTitle: 'Artist',
    parentTitle: 'Album',
    duration: '200000',
    viewOffset: '1000',
    thumb: `/library/metadata/${ratingKey}/thumb`,
    User: { id: user, title: `user${user}` },
    Player: { machineIdentifier: machine, title: `Player ${machine}`, product: 'Plexamp', state, address, local: location === 'lan' },
    Session: { location }
  }
}

export function sessions(...items) {
  return { MediaContainer: { size: items.length, Metadata: items } }
}
