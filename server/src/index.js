import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ConfigService } from './services/ConfigService.js';
import { LastfmService } from './services/LastfmService.js';
import { PlexAuthService } from './services/PlexAuthService.js';
import { DeviceSetupService } from './services/DeviceSetupService.js';
import { PlexClient } from './plex/PlexClient.js';
import { PlexEventStream } from './plex/PlexEventStream.js';
import { PlayerDirectory } from './plex/PlayerDirectory.js';
import { PlaybackController } from './plex/PlaybackController.js';
import { NowPlayingService } from './app/NowPlayingService.js';
import { attachSocketHandlers } from './realtime/socketHandlers.js';
import lastfmRouter, { setLastfmService } from './routes/lastfm.js';
import configRouter, { setConfigService } from './routes/config.js';
import authRouter, { setAuthServices } from './routes/auth.js';
import { createPlexRouter } from './routes/plex.js';
import { createHealthRouter } from './routes/health.js';
import { createLogger } from './lib/logger.js';

dotenv.config();

const log = createLogger('server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// 📋 CONFIGURAZIONE E SERVIZI
const configService = new ConfigService();
await configService.loadConfig();

const lastfmService = new LastfmService(configService);
const plexAuthService = new PlexAuthService(configService);
const deviceSetupService = new DeviceSetupService(configService);

// La connessione a Plex si legge a ogni richiesta: env > configurazione.
// Nessun token o indirizzo predefinito: senza configurazione l'app aspetta il setup.
function plexConnection() {
  const plex = configService.getConfig().plex || {};
  const baseUrl = process.env.PLEX_SERVER_URL ||
    (plex.url ? `http://${plex.url}:${plex.port || 32400}` : '');
  return {
    baseUrl,
    token: process.env.PLEX_TOKEN || plex.token || '',
    clientIdentifier: plex.clientIdentifier || ''
  };
}

const plexClient = new PlexClient(plexConnection);
const eventStream = new PlexEventStream(() => plexClient.notificationsUrl());
const directory = new PlayerDirectory({
  plexClient,
  getPlayerResources: async () => {
    const { token } = plexConnection();
    return token ? plexAuthService.getPlayerResources(token) : [];
  }
});
const playback = new PlaybackController({ plexClient, directory, getConnection: plexConnection });

const nowPlaying = new NowPlayingService({
  configService,
  plexClient,
  eventStream,
  directory,
  playback,
  lastfm: lastfmService,
  plexAuthService
});

// 📋 EXPRESS
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist')));

const reloadConfig = () => nowPlaying.reloadConfig();

setLastfmService(lastfmService);
app.use('/api/lastfm', lastfmRouter);
setConfigService(configService, reloadConfig, deviceSetupService, () => nowPlaying.filterOptions());
app.use('/api/config', configRouter);
setAuthServices(configService, plexAuthService, reloadConfig, deviceSetupService);
app.use('/api/auth', authRouter);
app.use('/api/health', createHealthRouter({ nowPlaying }));
app.use('/api', createPlexRouter({
  plexClient,
  nowPlaying,
  requireSession: deviceSetupService.requireSession,
  getToken: () => plexConnection().token
}));

// Tutte le altre pagine sono gestite dall'app React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// 📋 SOCKET.IO
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true
});

io.engine.on('connection_error', err => {
  log.debug('Errore connessione Socket.IO:', err.message);
});

attachSocketHandlers(io, nowPlaying);

// 📋 ERRORI NON GESTITI
process.on('uncaughtException', err => {
  if (err.code === 'EPIPE') return; // client disconnesso a metà risposta
  log.error('Errore non gestito:', err);
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  log.error('Promise rifiutata:', reason);
});

// 📋 AVVIO
server.listen(PORT, () => {
  log.info(`Server avviato sulla porta ${PORT}`);
  log.info(`Configurazione dal telefono: ${deviceSetupService.getBaseUrl()}/setup`);

  // Configurazioni create prima del login QR non conoscono l'account Plex
  // del dispositivo, necessario per "Password dimenticata": lo si ricava
  // dal token già salvato.
  const plexConfig = configService.getConfig().plex || {};
  if (plexConfig.token && !plexConfig.accountId) {
    plexAuthService.getAccount(plexConfig.token)
      .then(account => configService.setPlexAccountId(account.id))
      .catch(error => log.warn('Account Plex non recuperato:', error.message));
  }

  if (!nowPlaying.isConfigured()) {
    log.info('Dispositivo non configurato: inquadra il QR sullo schermo');
  }
  nowPlaying.start();
});
