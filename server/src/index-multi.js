import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import axios from 'axios';
import xml2js from 'xml2js';
import { exec } from 'child_process';
import { promisify } from 'util';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 📋 CONFIGURAZIONE AVANZATA - Server principale con funzionalità multi-player
const CONFIG = {
  // Token e server Plex (da variabili ambiente o default)
  PLEX_TOKEN: process.env.PLEX_TOKEN || 'REMOVED',
  PLEX_SERVER_URL: process.env.PLEX_SERVER_URL || 'http://192.168.1.11:32400',
  PLEX_SERVER_PORT: process.env.PLEX_SERVER_PORT || 32400,
  
  // Player IP opzionale (verrà scoperto automaticamente)
  PLAYER_IP: process.env.PLAYER_IP || null,
  
  // Configurazione client
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000"
};

// Cache per i player scoperti
let playerIPCache = new Map();
let availablePlayers = new Map(); // Map: machineIdentifier -> {ip, name, product, version}
let activePlayers = new Map(); // Map: machineIdentifier -> {sessionKey, state, ...playerInfo}

// 🎵 GESTIONE MULTI-PLAYER AVANZATA
let currentDisplayedTrack = null; // {ratingKey, title, artist, machineIdentifier}
let playingTracks = new Map(); // Map: ratingKey -> [{machineIdentifier, sessionKey, state, title, artist}]
let trackPlayerHistory = new Map(); // Map: ratingKey -> machineIdentifier (ultimo player che ha suonato la traccia)
let playerLastActivity = new Map(); // Map: machineIdentifier -> timestamp

// 🔌 PLEX WEBSOCKET - Monitoraggio eventi in tempo reale
let plexWebSocket = null;

// 📋 FUNZIONE NMAP DISCOVERY (sostituisce ARP)
async function nmapDiscovery(baseIP) {
  try {
    // Estrai la rete dalla base IP (es. 192.168.1.11 -> 192.168.1.0/24)
    const networkParts = baseIP.split('.');
    const networkBase = `${networkParts[0]}.${networkParts[1]}.${networkParts[2]}.0/24`;
    
    console.log(`🗺️  Avvio nmap discovery su rete ${networkBase}...`);
    
    const { stdout } = await execAsync(`nmap -sn ${networkBase}`);
    const lines = stdout.split('\n');
    const activeIPs = [];
    
    for (const line of lines) {
      // Cerca righe come "Nmap scan report for 192.168.1.xxx"
      const ipMatch = line.match(/Nmap scan report for (\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) {
        activeIPs.push(ipMatch[1]);
      }
    }
    
    console.log(`🎯 Nmap trovato ${activeIPs.length} IP attivi nella rete`);
    return activeIPs;
  } catch (error) {
    console.error('❌ Errore nmap discovery:', error.message);
    return [];
  }
}

// 📋 DISCOVERY PLEX PLAYERS CON NMAP
async function discoverAllPlexPlayers(baseIP) {
  try {
    console.log('🔍 Avvio discovery completo dei player Plex...');
    
    // Ottieni lista di IP attivi dalla rete usando nmap
    const activeIPs = await nmapDiscovery(baseIP);
    
    console.log(`🎯 Testing ${activeIPs.length} IP per player Plex...`);
    
    const foundPlayers = [];
    
    for (const ip of activeIPs) {
      try {
        console.log(`🔍 Testing ${ip}:32500...`);
        
        const response = await axios.get(`http://${ip}:32500/resources`, {
          timeout: 3000,
          headers: {
            'X-Plex-Token': CONFIG.PLEX_TOKEN
          }
        });
        
        const result = await xml2js.parseStringPromise(response.data);
        
        if (result && result.MediaContainer && result.MediaContainer.Player) {
          const players = Array.isArray(result.MediaContainer.Player) 
            ? result.MediaContainer.Player 
            : [result.MediaContainer.Player];
          
          for (const player of players) {
            const attrs = player.$ || {};
            const playerInfo = {
              ip: ip,
              name: attrs.name || 'Player sconosciuto',
              machineIdentifier: attrs.machineIdentifier,
              product: attrs.product,
              version: attrs.version
            };
            
            console.log(`✅ Player Plex trovato: ${playerInfo.name} su ${ip} (${playerInfo.machineIdentifier})`);
            
            // Salva nella cache dei player disponibili
            availablePlayers.set(attrs.machineIdentifier, playerInfo);
            foundPlayers.push(playerInfo);
          }
        }
      } catch (error) {
        // Continua con il prossimo IP
      }
    }
    
    console.log(`🎮 Discovery completato: ${foundPlayers.length} player Plex trovati`);
    return foundPlayers;
  } catch (error) {
    console.error('❌ Errore discovery:', error.message);
    return [];
  }
}

// 📋 RECUPERO SESSIONI ATTIVE
async function getActiveSessions() {
  try {
    const response = await axios.get(`${CONFIG.PLEX_SERVER_URL}/status/sessions`, {
      headers: {
        'X-Plex-Token': CONFIG.PLEX_TOKEN,
        'Accept': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Errore recupero sessioni:', error.message);
    return null;
  }
}

// 📋 ANALISI SESSIONI E PLAYER ATTIVI
// 🎵 ANALISI SESSIONI AVANZATA CON GESTIONE MULTI-PLAYER
function analyzeActiveSessions(sessions) {
  const activePlayersLocal = new Map();
  const currentPlayingTracks = new Map();
  let primaryPlayer = null;
  
  if (sessions && sessions.MediaContainer && sessions.MediaContainer.Metadata) {
    const tracks = Array.isArray(sessions.MediaContainer.Metadata) 
      ? sessions.MediaContainer.Metadata 
      : [sessions.MediaContainer.Metadata];
    
    for (const track of tracks) {
      if (track.Player && track.Player.machineIdentifier) {
        const ratingKey = track.ratingKey;
        const machineId = track.Player.machineIdentifier;
        
        const playerInfo = {
          machineIdentifier: machineId,
          name: track.Player.title || 'Player sconosciuto',
          state: track.Player.state || 'unknown',
          sessionKey: track.sessionKey,
          ratingKey: ratingKey,
          trackInfo: {
            title: track.title || 'Titolo sconosciuto',
            artist: track.grandparentTitle || 'Artista sconosciuto',
            album: track.parentTitle || '',
            duration: track.duration ? parseInt(track.duration) : 0,
            viewOffset: track.viewOffset ? parseInt(track.viewOffset) : 0,
            thumb: track.thumb,
            art: track.art,
            ratingKey: ratingKey
          }
        };
        
        activePlayersLocal.set(machineId, playerInfo);
        
        // Aggiorna timestamp attività player
        playerLastActivity.set(machineId, Date.now());
        
        // Traccia le tracce in riproduzione per ratingKey
        if (!currentPlayingTracks.has(ratingKey)) {
          currentPlayingTracks.set(ratingKey, []);
        }
        currentPlayingTracks.get(ratingKey).push({
          machineIdentifier: machineId,
          sessionKey: track.sessionKey,
          state: playerInfo.state,
          title: playerInfo.trackInfo.title,
          artist: playerInfo.trackInfo.artist,
          playerName: playerInfo.name
        });
        
        // Logica di selezione del player primario
        if (currentDisplayedTrack && currentDisplayedTrack.ratingKey === ratingKey) {
          // Se la traccia corrente è già visualizzata, controlla se è su un player diverso
          if (playerInfo.state === 'playing' && 
              (!primaryPlayer || currentDisplayedTrack.machineIdentifier !== machineId)) {
            console.log(`🔄 Switch automatico: stessa traccia ora su ${playerInfo.name} (${machineId})`);
            primaryPlayer = playerInfo;
            
            // Aggiorna il tracking della traccia corrente
            currentDisplayedTrack.machineIdentifier = machineId;
            trackPlayerHistory.set(ratingKey, machineId);
          }
        } else if (!primaryPlayer && playerInfo.state === 'playing') {
          // Primo player in "playing" diventa primary
          primaryPlayer = playerInfo;
        }
      }
    }
    
    // Se non c'è nessun player in "playing", prendi il primo disponibile
    if (!primaryPlayer && activePlayersLocal.size > 0) {
      primaryPlayer = Array.from(activePlayersLocal.values())[0];
    }
    
    // Aggiorna currentDisplayedTrack se abbiamo un nuovo primary
    if (primaryPlayer && (!currentDisplayedTrack || 
        currentDisplayedTrack.ratingKey !== primaryPlayer.ratingKey)) {
      currentDisplayedTrack = {
        ratingKey: primaryPlayer.ratingKey,
        title: primaryPlayer.trackInfo.title,
        artist: primaryPlayer.trackInfo.artist,
        machineIdentifier: primaryPlayer.machineIdentifier
      };
      trackPlayerHistory.set(primaryPlayer.ratingKey, primaryPlayer.machineIdentifier);
    }
  }
  
  // Aggiorna le strutture globali
  playingTracks.clear();
  playingTracks = new Map(currentPlayingTracks);
  
  console.log(`🎵 Sessioni analizzate: ${activePlayersLocal.size} player attivi`);
  if (primaryPlayer) {
    const hasControls = availablePlayers.has(primaryPlayer.machineIdentifier) ? '✅' : '❌';
    console.log(`🎯 Player primario: ${primaryPlayer.name} (${primaryPlayer.state}) - ${primaryPlayer.trackInfo.artist} - ${primaryPlayer.trackInfo.title}`);
    console.log(`🎵 Now Playing: ${primaryPlayer.trackInfo.artist} - ${primaryPlayer.trackInfo.title} (${primaryPlayer.state}) - Controls: ${hasControls}`);
    
    // Log di tracce multiple se presenti
    if (playingTracks.size > 1) {
      console.log(`🎮 ${playingTracks.size} tracce diverse in riproduzione:`);
      for (const [ratingKey, players] of playingTracks) {
        const track = players[0];
        console.log(`  📀 ${track.artist} - ${track.title} su ${players.length} player(s)`);
      }
    }
  }
  
  return { activePlayers: activePlayersLocal, primaryPlayer };
}

// 📋 CONTROLLO MEDIA
async function mediaControl(command, sessionKey = null, targetMachineId = null) {
  try {
    let targetIP = null;
    
    // Se specifico un machineIdentifier, uso quello
    if (targetMachineId && availablePlayers.has(targetMachineId)) {
      targetIP = availablePlayers.get(targetMachineId).ip;
      console.log(`🎯 Usando player specifico: ${targetMachineId} su ${targetIP}`);
    } 
    // Altrimenti usa il player configurato o fa discovery
    else if (CONFIG.PLAYER_IP) {
      targetIP = CONFIG.PLAYER_IP;
    } 
    else {
      // Fallback: prova a usare l'IP del server Plex per discovery
      const serverIP = new URL(CONFIG.PLEX_SERVER_URL).hostname;
      await discoverAllPlexPlayers(serverIP);
      
      if (availablePlayers.size > 0) {
        const firstPlayer = Array.from(availablePlayers.values())[0];
        targetIP = firstPlayer.ip;
        CONFIG.PLAYER_IP = targetIP;
        console.log(`🔄 Usando primo player disponibile: ${firstPlayer.name} su ${targetIP}`);
      } else {
        throw new Error('Nessun player Plex trovato');
      }
    }
    
    // 🔄 TRADUZIONE COMANDI: client -> server Plex
    let plexCommand = command;
    switch (command) {
      case 'next':
        plexCommand = 'skipNext';
        break;
      case 'previous':
        plexCommand = 'skipPrevious';
        break;
      case 'play':
      case 'pause':
      case 'stop':
        plexCommand = command; // Questi rimangono uguali
        break;
      default:
        plexCommand = command; // Altri comandi rimangono uguali
    }
    
    // URL di controllo diretto al player
    const controlUrl = `http://${targetIP}:32500/player/playback/${plexCommand}`;
    
    const params = {
      'X-Plex-Token': CONFIG.PLEX_TOKEN
    };
    
    // Aggiungi sessionKey se fornito
    if (sessionKey) {
      params.sessionKey = sessionKey;
    }
    
    console.log(`🎮 Invio comando: ${command} → ${plexCommand} a ${targetIP}:32500`);
    
    const response = await axios.get(controlUrl, {
      params: params,
      timeout: 5000
    });
    
    console.log(`✅ Comando ${command} → ${plexCommand} eseguito con successo`);
    return { success: true, command: command, plexCommand: plexCommand };
  } catch (error) {
    console.error(`❌ Errore comando ${command}:`, error.message);
    
    // Se fallisce, pulisci cache e riprova discovery
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log('🔄 Tentativo di re-discovery...');
      CONFIG.PLAYER_IP = null;
      availablePlayers.clear();
    }
    
    return { success: false, error: error.message };
  }
}

// 📋 SETUP EXPRESS
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist')));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: CONFIG.CLIENT_URL,
    methods: ["GET", "POST"]
  }
});

// 📋 WEBSOCKET HANDLERS
io.on('connection', (socket) => {
  console.log('🔌 Client connesso:', socket.id);
  
  // Handler per controlli media
  socket.on('mediaControl', async (data) => {
    const { command, sessionKey, machineIdentifier } = data;
    console.log(`📨 Ricevuto comando: ${command} per player ${machineIdentifier || 'default'}`);
    
    const result = await mediaControl(command, sessionKey, machineIdentifier);
    socket.emit('mediaControlResponse', result);
  });
  
  // Handler per cambiare player attivo
  socket.on('switchPlayer', async (data) => {
    const { machineIdentifier } = data;
    console.log(`🔄 Richiesto switch a player: ${machineIdentifier}`);
    
    if (availablePlayers.has(machineIdentifier)) {
      const playerInfo = availablePlayers.get(machineIdentifier);
      CONFIG.PLAYER_IP = playerInfo.ip;
      console.log(`✅ Player switched a: ${playerInfo.name} su ${playerInfo.ip}`);
      socket.emit('playerSwitched', { success: true, player: playerInfo });
    } else {
      console.log(`❌ Player non disponibile: ${machineIdentifier}`);
      socket.emit('playerSwitched', { success: false, error: 'Player non disponibile' });
    }
  });
  
  // Handler per ottenere lista player disponibili
  socket.on('getAvailablePlayers', () => {
    const players = Array.from(availablePlayers.values());
    socket.emit('availablePlayers', players);
  });
  
  // Handler per pulizia cache
  socket.on('clearCache', () => {
    console.log('🧹 Pulizia cache player');
    CONFIG.PLAYER_IP = null;
    availablePlayers.clear();
    activePlayers.clear();
    socket.emit('cacheCleared', { success: true });
  });
  
  // Handler per forzare re-discovery
  socket.on('rediscoverPlayers', async () => {
    console.log('🔍 Richiesto re-discovery forzato');
    try {
      const serverIP = new URL(CONFIG.PLEX_SERVER_URL).hostname;
      const foundPlayers = await discoverAllPlexPlayers(serverIP);
      socket.emit('rediscoveryComplete', { success: true, players: foundPlayers });
    } catch (error) {
      socket.emit('rediscoveryComplete', { success: false, error: error.message });
    }
  });
  
  // Handler per configurazione
  socket.on('getConfig', () => {
    socket.emit('configResponse', {
      serverUrl: CONFIG.PLEX_SERVER_URL,
      availablePlayersCount: availablePlayers.size,
      hasToken: !!CONFIG.PLEX_TOKEN
    });
  });
  
  // 🎵 HANDLERS GESTIONE MULTI-PLAYER AVANZATA
  
  // Handler per ottenere stato multi-player completo
  socket.on('getMultiPlayerState', () => {
    socket.emit('multiPlayerState', {
      currentDisplayedTrack,
      playingTracks: Object.fromEntries(playingTracks),
      availablePlayers: Object.fromEntries(availablePlayers),
      trackPlayerHistory: Object.fromEntries(trackPlayerHistory),
      playerLastActivity: Object.fromEntries(playerLastActivity)
    });
  });
  
  // Handler per switch manuale a una specifica traccia su un player
  socket.on('switchToTrack', (data) => {
    const { ratingKey, machineIdentifier } = data;
    console.log(`🎵 Richiesto switch manuale a traccia ${ratingKey} su player ${machineIdentifier}`);
    
    if (playingTracks.has(ratingKey)) {
      const trackPlayers = playingTracks.get(ratingKey);
      const targetPlayer = trackPlayers.find(p => p.machineIdentifier === machineIdentifier);
      
      if (targetPlayer) {
        // Aggiorna la traccia corrente
        currentDisplayedTrack = {
          ratingKey,
          title: targetPlayer.title,
          artist: targetPlayer.artist,
          machineIdentifier
        };
        trackPlayerHistory.set(ratingKey, machineIdentifier);
        
        console.log(`✅ Switch manuale completato: ${targetPlayer.artist} - ${targetPlayer.title} su ${targetPlayer.playerName}`);
        
        // Notifica tutti i client
        io.emit('trackSwitched', {
          ratingKey,
          machineIdentifier,
          trackInfo: targetPlayer,
          reason: 'manual-switch'
        });
        
        socket.emit('switchToTrackResponse', { success: true });
      } else {
        socket.emit('switchToTrackResponse', { 
          success: false, 
          error: 'Player non trovato per questa traccia' 
        });
      }
    } else {
      socket.emit('switchToTrackResponse', { 
        success: false, 
        error: 'Traccia non in riproduzione' 
      });
    }
  });
  
  // Handler per ottenere lista tracce in riproduzione
  socket.on('getPlayingTracks', () => {
    const tracks = [];
    for (const [ratingKey, players] of playingTracks) {
      const track = players[0]; // Prendi info della traccia dal primo player
      tracks.push({
        ratingKey,
        title: track.title,
        artist: track.artist,
        players: players.map(p => ({
          machineIdentifier: p.machineIdentifier,
          playerName: p.playerName,
          state: p.state,
          sessionKey: p.sessionKey
        })),
        isCurrentlyDisplayed: currentDisplayedTrack?.ratingKey === ratingKey
      });
    }
    socket.emit('playingTracks', tracks);
  });
  
  // Handler per forzare refresh stato
  socket.on('refreshMultiPlayerState', async () => {
    try {
      console.log('🔄 Refresh stato multi-player richiesto');
      const sessions = await getActiveSessions();
      if (sessions) {
        const analysis = analyzeActiveSessions(sessions);
        socket.emit('multiPlayerStateRefresh', {
          sessions,
          analysis,
          currentDisplayedTrack,
          availablePlayers: Object.fromEntries(availablePlayers),
          playingTracks: Object.fromEntries(playingTracks)
        });
      }
    } catch (error) {
      socket.emit('refreshError', { error: error.message });
    }
  });
  
  // 🔄 COMPATIBILITÀ CLIENT REACT ORIGINALE
  // Invia dati nel formato che si aspetta il client originale
  socket.emit('nowPlaying', {
    isPlaying: currentDisplayedTrack !== null,
    track: currentDisplayedTrack,
    activeUsers: Array.from(activePlayers.values()),
    selectedUser: currentDisplayedTrack ? currentDisplayedTrack.machineIdentifier : null
  });
  
  // Handler legacy per switchUser (compatibilità)
  socket.on('switchUser', async (userId) => {
    console.log(`🔄 Switch legacy user: ${userId}`);
    if (activePlayers.has(userId)) {
      const playerInfo = activePlayers.get(userId);
      currentDisplayedTrack = {
        ratingKey: playerInfo.ratingKey,
        title: playerInfo.title,
        artist: playerInfo.artist,
        machineIdentifier: userId
      };
      
      // Broadcast aggiornamento
      io.emit('nowPlaying', {
        isPlaying: true,
        track: currentDisplayedTrack,
        activeUsers: Array.from(activePlayers.values()),
        selectedUser: userId
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnesso:', socket.id);
  });
});

// 📋 API ROUTES
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await getActiveSessions();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/control/:command', async (req, res) => {
  try {
    const { command } = req.params;
    const { sessionKey } = req.body;
    
    const result = await mediaControl(command, sessionKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/discover', async (req, res) => {
  try {
    const player = await discoverPlexPlayer();
    res.json(player);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// 🔌 PLEX WEBSOCKET - Connessione agli eventi in tempo reale
function connectToPlexWebSocket() {
  if (plexWebSocket) {
    console.log('🔄 Chiusura WebSocket precedente...');
    plexWebSocket.close();
  }
  
  console.log('🔌 Connessione WebSocket Plex...');
  
  // Costruisci URL WebSocket (sostituisci http con ws) + filtro per eventi playing
  const wsUrl = CONFIG.PLEX_SERVER_URL.replace('http://', 'ws://').replace('https://', 'wss://') + 
                `/:/websockets/notifications?X-Plex-Token=${CONFIG.PLEX_TOKEN}&filters=playing`;
  
  console.log('🔗 URL WebSocket:', wsUrl);
  
  plexWebSocket = new WebSocket(wsUrl);
  
  plexWebSocket.on('open', () => {
    console.log('✅ WebSocket Plex connessa!');
    console.log('📡 Monitoraggio eventi in tempo reale attivo');
    
    // Notifica ai client Socket.io
    io.emit('plexWebSocketStatus', { 
      connected: true, 
      message: 'WebSocket connessa - eventi in tempo reale attivi' 
    });
  });
  
  plexWebSocket.on('message', (data) => {
    try {
      console.log('📡 EVENTO PLEX RAW:', data.toString());
      
      // Prova a parsare come JSON
      let eventData;
      try {
        eventData = JSON.parse(data.toString());
        console.log('🎵 EVENTO PLEX (JSON):', JSON.stringify(eventData, null, 2));
      } catch (parseError) {
        console.log('📄 EVENTO PLEX (TEXT):', data.toString());
        eventData = { type: 'raw', data: data.toString() };
      }
      
      // 🎵 GESTIONE AVANZATA EVENTI DI RIPRODUZIONE
      if (eventData.NotificationContainer && eventData.NotificationContainer.PlaySessionStateNotification) {
        const notifications = Array.isArray(eventData.NotificationContainer.PlaySessionStateNotification)
          ? eventData.NotificationContainer.PlaySessionStateNotification
          : [eventData.NotificationContainer.PlaySessionStateNotification];
          
        for (const notification of notifications) {
          if (notification.clientIdentifier && notification.ratingKey) {
            const machineId = notification.clientIdentifier;
            const ratingKey = notification.ratingKey;
            const state = notification.state;
            
            console.log(`🎯 Notifica: Player ${machineId} → ${state} → Traccia ${ratingKey}`);
            
            // Controlla se è la stessa traccia attualmente visualizzata
            if (currentDisplayedTrack && currentDisplayedTrack.ratingKey === ratingKey) {
              const previousPlayer = currentDisplayedTrack.machineIdentifier;
              
              if (machineId !== previousPlayer && state === 'playing') {
                console.log(`🔄 SWITCH AUTOMATICO: Traccia ${ratingKey} ora su player ${machineId} (prima: ${previousPlayer})`);
                
                // Aggiorna il player corrente per questa traccia
                currentDisplayedTrack.machineIdentifier = machineId;
                trackPlayerHistory.set(ratingKey, machineId);
                
                // Notifica ai client del cambio player
                io.emit('playerSwitched', {
                  ratingKey,
                  newMachineIdentifier: machineId,
                  previousMachineIdentifier: previousPlayer,
                  reason: 'auto-switch-same-track'
                });
                
                console.log(`✅ Controlli ora puntano al player ${machineId}`);
              }
            } else if (state === 'playing') {
              // Nuova traccia in riproduzione
              console.log(`🆕 Nuova traccia in riproduzione: ${ratingKey} su player ${machineId}`);
              
              // Se non abbiamo una traccia corrente o se questa è più recente
              if (!currentDisplayedTrack) {
                console.log(`🎵 Impostazione traccia primaria: ${ratingKey}`);
                currentDisplayedTrack = {
                  ratingKey,
                  machineIdentifier: machineId,
                  title: 'Loading...',
                  artist: 'Loading...'
                };
                trackPlayerHistory.set(ratingKey, machineId);
              }
            }
            
            // Aggiorna timestamp attività
            playerLastActivity.set(machineId, Date.now());
          }
        }
      }
      
      // Trasmetti eventi ai client Socket.io
      io.emit('plexEvent', eventData);
      
      // Trigger refresh delle sessioni per aggiornamento UI
      if (eventData.NotificationContainer) {
        console.log('🔄 Triggering session refresh dopo evento...');
        setTimeout(async () => {
          try {
            const sessions = await getActiveSessions();
            if (sessions) {
              const analysis = analyzeActiveSessions(sessions);
              io.emit('sessionsUpdate', {
                sessions,
                analysis,
                currentDisplayedTrack,
                availablePlayers: Object.fromEntries(availablePlayers),
                playingTracks: Object.fromEntries(playingTracks)
              });
            }
          } catch (error) {
            console.error('❌ Errore refresh sessioni:', error);
          }
        }, 500); // Piccolo delay per permettere a Plex di aggiornare le sessioni
      }
      
    } catch (error) {
      console.error('❌ Errore parsing evento Plex:', error);
    }
  });
  
  plexWebSocket.on('error', (error) => {
    console.error('❌ Errore WebSocket:', error);
    
    // Notifica ai client Socket.io
    io.emit('plexWebSocketStatus', { 
      connected: false, 
      message: 'WebSocket disconnessa - tentativo riconnessione...' 
    });
  });
  
  plexWebSocket.on('close', (code, reason) => {
    console.log(`🔌 WebSocket chiusa - Codice: ${code}, Motivo: ${reason}`);
    
    // Notifica ai client Socket.io
    io.emit('plexWebSocketStatus', { 
      connected: false, 
      message: 'WebSocket disconnessa - tentativo riconnessione...' 
    });
    
    // Riconnessione automatica dopo 5 secondi
    setTimeout(() => {
      console.log('🔄 Tentativo riconnessione WebSocket...');
      connectToPlexWebSocket();
    }, 5000);
  });
}

// �📋 MONITORAGGIO CONTINUO
function startMonitoring() {
  console.log('📡 Avvio monitoraggio sessioni avanzato...');
  
  setInterval(async () => {
    try {
      const sessions = await getActiveSessions();
      
      if (sessions && sessions.MediaContainer && sessions.MediaContainer.Metadata) {
        // Analizza le sessioni per identificare player attivi
        const { activePlayers, primaryPlayer } = analyzeActiveSessions(sessions);
        
        // Emit sessioni complete a tutti i client connessi
        io.emit('sessionsUpdate', sessions);
        
        if (primaryPlayer) {
          const state = primaryPlayer.state;
          const isPlaying = state === 'playing';
          
          // Controlla se abbiamo l'IP per questo player
          const hasPlayerIP = availablePlayers.has(primaryPlayer.machineIdentifier);
          const showControls = hasPlayerIP;
          
          const nowPlayingData = {
            ...primaryPlayer.trackInfo,
            state: state,
            isPlaying: isPlaying,
            sessionKey: primaryPlayer.sessionKey,
            machineIdentifier: primaryPlayer.machineIdentifier,
            playerName: primaryPlayer.name,
            showControls: showControls, // 🎮 Mostra controlli solo se abbiamo l'IP del player
            availablePlayers: Array.from(activePlayers.values()).map(p => ({
              machineIdentifier: p.machineIdentifier,
              name: p.name,
              state: p.state,
              hasIP: availablePlayers.has(p.machineIdentifier)
            }))
          };
          
          console.log(`🎵 Now Playing: ${nowPlayingData.artist} - ${nowPlayingData.title} (${nowPlayingData.state}) - Controls: ${showControls ? '✅' : '❌'}`);
          io.emit('nowPlaying', nowPlayingData);
        } else {
          io.emit('nowPlaying', null);
        }
      } else {
        // Nessuna sessione attiva
        console.log('📭 Nessuna sessione attiva');
        io.emit('nowPlaying', null);
      }
    } catch (error) {
      console.error('❌ Errore monitoraggio:', error.message);
    }
  }, 3000); // Controlla ogni 3 secondi
}

// 📋 STARTUP
const PORT = process.env.PORT || 3001;

server.listen(PORT, async () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`📊 Plex Server: ${CONFIG.PLEX_SERVER_URL}`);
  
  // FASE 1: Controlla sessioni attive per identificare player
  console.log('\n🔍 FASE 1: Controllo sessioni attive...');
  const sessions = await getActiveSessions();
  
  if (sessions && sessions.MediaContainer && sessions.MediaContainer.Metadata) {
    const { activePlayers, primaryPlayer } = analyzeActiveSessions(sessions);
    console.log(`✅ Trovate ${activePlayers.size} sessioni attive`);
    
    if (primaryPlayer) {
      console.log(`🎯 Player primario identificato: ${primaryPlayer.name} (${primaryPlayer.machineIdentifier})`);
      
      // FASE 2: Avvia discovery nmap in background
      console.log('\n�️  FASE 2: Avvio discovery nmap in background...');
      const serverIP = new URL(CONFIG.PLEX_SERVER_URL).hostname;
      
      // Non blocchiamo l'avvio, facciamo discovery in background
      discoverAllPlexPlayers(serverIP).then(foundPlayers => {
        console.log(`🎮 Discovery completato: ${foundPlayers.length} player Plex disponibili`);
        
        // Controlla se abbiamo trovato il player delle sessioni attive
        for (const [machineId, playerInfo] of activePlayers) {
          if (availablePlayers.has(machineId)) {
            const playerIP = availablePlayers.get(machineId).ip;
            console.log(`✅ Player controllabile: ${playerInfo.name} su ${playerIP}`);
          } else {
            console.log(`⚠️  Player non controllabile: ${playerInfo.name} (IP non trovato)`);
          }
        }
      }).catch(error => {
        console.error('❌ Errore discovery background:', error.message);
      });
      
    } else {
      console.log('⚠️  Nessuna sessione attiva trovata');
    }
  } else {
    console.log('📭 Nessuna sessione Plex attiva al momento');
    
    // Se non ci sono sessioni, fai discovery completo
    console.log('\n🔍 Avvio discovery completo...');
    const serverIP = new URL(CONFIG.PLEX_SERVER_URL).hostname;
    await discoverAllPlexPlayers(serverIP);
  }
  
  // FASE 3: Avvia monitoraggio
  console.log('\n📡 FASE 3: Avvio monitoraggio continuo...');
  startMonitoring();
  
  // FASE 4: Connetti WebSocket per eventi in tempo reale
  console.log('\n🔌 FASE 4: Connessione WebSocket Plex...');
  connectToPlexWebSocket();
});

console.log('💾 Sistema Plex Media Control con NMAP avviato');
console.log('📋 Configurazione:', {
  serverUrl: CONFIG.PLEX_SERVER_URL,
  discoveryMethod: 'NMAP Network Scan',
  port: PORT
});
