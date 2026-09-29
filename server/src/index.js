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
import { ConfigService } from './services/ConfigService.js';
import { LastfmService } from './services/LastfmService.js';
import { PlexAuthService } from './services/PlexAuthService.js';
import { DeviceSetupService } from './services/DeviceSetupService.js';
import { filterSessions, hasActiveFilters, normalizeFilters, SeenRegistry } from './services/sessionFilters.js';
import lastfmRouter, { setLastfmService } from './routes/lastfm.js';
import configRouter, { setConfigService } from './routes/config.js';
import authRouter, { setAuthServices } from './routes/auth.js';

dotenv.config();

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 📋 CONFIGURATION SERVICE INITIALIZATION
const configService = new ConfigService();
await configService.loadConfig();
const appConfig = configService.getConfig();

// 📋 SERVICES INITIALIZATION
const lastfmService = new LastfmService(configService);
const plexAuthService = new PlexAuthService(configService);
const deviceSetupService = new DeviceSetupService(configService);

// 📋 ADVANCED CONFIGURATION - Main server with multi-player functionality
// Built from (priority) env vars > config file, with no hardcoded fallback
// secrets or default server IP: without a token/url the app waits for setup
// instead of silently pointing at someone else's server.
function buildConfig(currentAppConfig) {
  return {
    PLEX_TOKEN: process.env.PLEX_TOKEN || currentAppConfig.plex?.token || '',
    PLEX_SERVER_URL: process.env.PLEX_SERVER_URL ||
      (currentAppConfig.plex?.url ? `http://${currentAppConfig.plex.url}:${currentAppConfig.plex?.port || 32400}` : ''),
    PLEX_SERVER_PORT: process.env.PLEX_SERVER_PORT || currentAppConfig.plex?.port || 32400,

    // Player IP opzionale (verrà scoperto automaticamente)
    PLAYER_IP: process.env.PLAYER_IP || null,

    // Configurazione client
    CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",

    // Filtri su LAN, utente e player (vedi services/sessionFilters.js)
    FILTERS: normalizeFilters(currentAppConfig.filters),

    // Configurazione Last.fm
    LASTFM: {
      username: currentAppConfig.lastfm?.username || '',
      apiKey: currentAppConfig.lastfm?.apiKey || process.env.LASTFM_API_KEY || '',
      apiSecret: currentAppConfig.lastfm?.apiSecret || '',
      sessionKey: currentAppConfig.lastfm?.sessionKey || ''
    }
  };
}

let CONFIG = buildConfig(appConfig);

// Utenti e player visti nelle sessioni (prima dei filtri): proposti in /config
const seenRegistry = new SeenRegistry();
// Player ammessi dai filtri nell'ultima lettura delle sessioni: le notifiche
// in tempo reale di Plex degli altri player vengono ignorate.
let allowedMachineIds = new Set();

// 📋 HOT-RELOAD - Rilegge la config da disco dopo un salvataggio da /config,
// così le modifiche hanno effetto subito senza dover riavviare il processo.
async function reloadConfigFromDisk() {
  await configService.loadConfig();
  CONFIG = buildConfig(configService.getConfig());
  lastFmCache = { data: null, fetchedAt: 0 };

  // Il server Plex configurato può essere cambiato: la cache dei player
  // scoperti in precedenza non è più valida.
  availablePlayers.clear();
  activePlayers.clear();
  playerIPCache.clear();

  tokenInvalidHandled = false; // un nuovo login/config è stato appena salvato

  // Il kiosk ricarica i dati che dipendono dalla configurazione (es. Last.fm)
  safeEmit('configUpdated', {});

  // Plex disconnesso dal telefono: il kiosk torna al QR di configurazione
  if (!CONFIG.PLEX_TOKEN || !CONFIG.PLEX_SERVER_URL) {
    safeEmit('authRequired', { reason: 'not_configured' });
  }

  console.log('🔄 Configurazione ricaricata:', {
    serverUrl: CONFIG.PLEX_SERVER_URL || '(non configurato)',
    hasToken: !!CONFIG.PLEX_TOKEN
  });

  if (CONFIG.PLEX_TOKEN && CONFIG.PLEX_SERVER_URL) {
    connectToPlexWebSocket();
    await updateSessionsAndBroadcast();
  }
}

// 📋 GESTIONE TOKEN REVOCATO/SCADUTO - Se Plex risponde 401, il token non è
// più valido (revocato dall'utente o scaduto): torniamo automaticamente alla
// schermata di login invece di continuare a fallire in silenzio.
let tokenInvalidHandled = false;
async function handleInvalidPlexToken() {
  if (tokenInvalidHandled) return; // già gestito, non ripetere a ogni polling
  tokenInvalidHandled = true;

  console.log('⚠️  Token Plex non più valido (401) - richiesto un nuovo login');
  await configService.clearPlexToken();
  CONFIG = buildConfig(configService.getConfig());

  if (plexWebSocket) {
    plexWebSocket.close();
    plexWebSocket = null;
  }

  safeEmit('authRequired', { reason: 'token_invalid' });
}

// Cache per l'ultima traccia Last.fm (fallback quando non c'è nulla in
// riproduzione): evita di interrogare l'API a ogni ciclo di polling (10s).
let lastFmCache = { data: null, fetchedAt: 0 };
const LASTFM_CACHE_TTL_MS = 30000;

// Cache per i player scoperti
let playerIPCache = new Map();
let availablePlayers = new Map(); // Map: machineIdentifier -> {ip, name, product, version}
let activePlayers = new Map(); // Map: machineIdentifier -> {sessionKey, state, ...playerInfo}

// 🎵 ADVANCED MULTI-PLAYER MANAGEMENT
let currentDisplayedTrack = null; // {ratingKey, title, artist, machineIdentifier}
let playingTracks = new Map(); // Map: ratingKey -> [{machineIdentifier, sessionKey, state, title, artist}]
let trackPlayerHistory = new Map(); // Map: ratingKey -> machineIdentifier (ultimo player che ha suonato la traccia)
let manualPlayerSelection = null; // ID del player selezionato manualmente dall'utente
let playerLastActivity = new Map(); // Map: machineIdentifier -> timestamp

// ⏸️ PAUSE AND RESUME MANAGEMENT - New intelligent system
let manualPauseState = null; // {ratingKey, machineIdentifier, sessionKey, timestamp, trackInfo, playerInfo}
let pauseTimer = null; // Timer per 30 secondi dopo pausa manuale
let lastUserAction = null; // Traccia l'ultima azione dell'utente {action, timestamp, machineIdentifier}

// 🔌 PLEX WEBSOCKET - Monitoraggio eventi in tempo reale
let plexWebSocket = null;

// 📋 FUNZIONE NMAP DISCOVERY (sostituisce ARP)
async function nmapDiscovery(baseIP) {
  try {
    // Estrai la rete dalla base IP (es. 192.168.1.11 -> 192.168.1.0/24)
    const networkParts = baseIP.split('.');
    const networkBase = `${networkParts[0]}.${networkParts[1]}.${networkParts[2]}.0/24`;
    
    console.log(`🗺️  Starting nmap discovery on network ${networkBase}...`);
    
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
    console.log('🔍 Starting complete Plex player discovery...');
    
    // Ottieni lista di IP attivi dalla rete usando nmap
    const activeIPs = await nmapDiscovery(baseIP);
    
    console.log(`🎯 Testing ${activeIPs.length} IPs for Plex players...`);
    
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
            
            console.log(`✅ Plex player found: ${playerInfo.name} on ${ip} (${playerInfo.machineIdentifier})`);
            
            // Salva nella cache dei player disponibili
            availablePlayers.set(attrs.machineIdentifier, playerInfo);
            foundPlayers.push(playerInfo);
          }
        }
      } catch (error) {
        // Continua con il prossimo IP
      }
    }
    
    console.log(`🎮 Discovery completed: ${foundPlayers.length} Plex players found`);
    return foundPlayers;
  } catch (error) {
    console.error('❌ Errore discovery:', error.message);
    return [];
  }
}

// 📋 RECUPERO SESSIONI ATTIVE
async function getActiveSessions() {
  if (!CONFIG.PLEX_SERVER_URL || !CONFIG.PLEX_TOKEN) {
    return null; // Plex non ancora configurato, niente da interrogare
  }
  try {
    const response = await axios.get(`${CONFIG.PLEX_SERVER_URL}/status/sessions`, {
      headers: {
        'X-Plex-Token': CONFIG.PLEX_TOKEN,
        'Accept': 'application/json'
      },
      // Senza timeout, un server Plex irraggiungibile (IP sbagliato, rete
      // giù) blocca questa chiamata per minuti; il polling ogni 10s intanto
      // continua ad accodarne altre senza che nessuna finisca mai.
      timeout: 8000
    });

    // I filtri si applicano qui, prima di ogni altra elaborazione: ciò che
    // viene scartato non compare mai (player primario, selettore, pausa).
    seenRegistry.record(response.data);
    const filtered = filterSessions(response.data, CONFIG.FILTERS);
    const metadata = filtered?.MediaContainer?.Metadata;
    allowedMachineIds = new Set(
      (Array.isArray(metadata) ? metadata : metadata ? [metadata] : [])
        .map(item => item?.Player?.machineIdentifier)
        .filter(Boolean)
    );
    return filtered;
  } catch (error) {
    console.error('❌ Errore recupero sessioni:', error.message);
    if (error.response?.status === 401) {
      await handleInvalidPlexToken();
    }
    return null;
  }
}

// 📋 TRASFORMAZIONE URL IMMAGINI PLEX
function transformPlexImageUrl(imageUrl) {
  if (!imageUrl) return null;

  // Se l'URL è già completa, restituiscila così com'è
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // Se è un percorso relativo di Plex, fallo passare per il proxy /api/art
  // invece di mandare il token Plex al browser dentro l'URL dell'immagine.
  if (imageUrl.startsWith('/')) {
    return `/api/art?path=${encodeURIComponent(imageUrl)}`;
  }

  return imageUrl;
}

// 📋 LAST.FM FALLBACK - Integrazione con API Last.fm
async function getLastFmTrack() {
  try {
    // Controlla se Last.fm è configurato
    if (!CONFIG.LASTFM.username || !CONFIG.LASTFM.apiKey) {
      return {
        title: "Last.fm non configurato",
        artist: "Configurazione richiesta",
        album: "Aggiungi username e API key",
        isLastFm: true,
        isPlaying: false
      };
    }

    // Serve dalla cache se recente: questa funzione viene chiamata a ogni
    // ciclo di polling (10s) mentre non c'è nulla in riproduzione.
    if (lastFmCache.data && (Date.now() - lastFmCache.fetchedAt) < LASTFM_CACHE_TTL_MS) {
      return lastFmCache.data;
    }

    // Recupera l'ultima traccia da Last.fm
    const lastFmUrl = `http://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${CONFIG.LASTFM.username}&api_key=${CONFIG.LASTFM.apiKey}&format=json&limit=1`;
    
    const response = await axios.get(lastFmUrl, { timeout: 5000 });

    let result;
    if (response.data && response.data.recenttracks && response.data.recenttracks.track && response.data.recenttracks.track.length > 0) {
      const track = response.data.recenttracks.track[0];

      result = {
        title: track.name || "Titolo sconosciuto",
        artist: track.artist?.['#text'] || track.artist || "Artista sconosciuto",
        album: track.album?.['#text'] || track.album || "",
        thumb: track.image?.[2]?.['#text'] || null, // Immagine media
        isLastFm: true,
        isPlaying: !!track['@attr']?.nowplaying, // true se nowplaying
        lastfmUrl: track.url
      };
    } else {
      result = {
        title: "Nessuna traccia trovata",
        artist: CONFIG.LASTFM.username,
        album: "Last.fm",
        isLastFm: true,
        isPlaying: false
      };
    }

    lastFmCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    console.error('❌ Errore Last.fm:', error.message);
    return {
      title: "Errore Last.fm",
      artist: error.message.includes('timeout') ? "Timeout connessione" : "Errore API",
      album: "Last.fm",
      isLastFm: true,
      isPlaying: false
    };
  }
}

// 📋 ANALISI SESSIONI E PLAYER ATTIVI
// 🎵 ADVANCED SESSION ANALYSIS WITH MULTI-PLAYER MANAGEMENT
function analyzeActiveSessions(sessions) {
  const activePlayersLocal = new Map();
  const currentPlayingTracks = new Map();
  let primaryPlayer = null;
  
  if (sessions && sessions.MediaContainer) {
    // 🎵 ELEGANT FILTER: Search only Track elements in sessions
    const allContent = Array.isArray(sessions.MediaContainer.Metadata) 
      ? sessions.MediaContainer.Metadata 
      : [sessions.MediaContainer.Metadata];
    
    // Filtra solo gli elementi di tipo Track (musica)
    const tracks = allContent.filter(item => {
      if (!item) return false;
      
      // In XML parsing, il nome del tag diventa una proprietà
      // Track = musica, Video = video/episodi
      const isTrack = item.type === 'track' || 
                     (typeof item === 'object' && !item.type && item.grandparentTitle && item.parentTitle);
      
      if (!isTrack) {
        console.log(`🎵 Skipping non-musical content: ${item.type || 'unknown'} - "${item.title || 'unknown'}"`);
      }
      
      return isTrack;
    });
    
    console.log(`🎵 Trovate ${tracks.length} tracce musicali su ${allContent.length} elementi totali`);
    
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
          // Aggiungi informazioni utente se disponibili
          userTitle: track.User?.title || null,
          userId: track.User?.id || null,
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
        
        // Logica di selezione del player primario (priorità a player controllabili in LAN)
        if (manualPlayerSelection && machineId === manualPlayerSelection && playerInfo.state === 'playing') {
          // 🎯 PRIORITÀ ASSOLUTA: Selezione manuale dell'utente
          console.log(`🎯 Respecting manual selection: ${playerInfo.name} (${machineId})`);
          primaryPlayer = playerInfo;
        } else if (!manualPlayerSelection && currentDisplayedTrack && currentDisplayedTrack.ratingKey === ratingKey) {
          // Se la traccia corrente è già visualizzata, controlla se è su un player diverso
          if (playerInfo.state === 'playing' && 
              (!primaryPlayer || currentDisplayedTrack.machineIdentifier !== machineId)) {
            console.log(`🔄 Automatic switch: same track now on ${playerInfo.name} (${machineId})`);
            primaryPlayer = playerInfo;
            
            // Aggiorna il tracking della traccia corrente
            currentDisplayedTrack.machineIdentifier = machineId;
            trackPlayerHistory.set(ratingKey, machineId);
          }
        } else if (!manualPlayerSelection && playerInfo.state === 'playing') {
          // Logica di priorità per player in "playing"
          const isControllable = availablePlayers.has(machineId);
          const currentIsControllable = primaryPlayer ? availablePlayers.has(primaryPlayer.machineIdentifier) : false;
          
          if (!primaryPlayer) {
            // Primo player in "playing" diventa primary
            primaryPlayer = playerInfo;
            console.log(`🎯 Primary player selected: ${playerInfo.name} (${isControllable ? 'controllable' : 'not controllable'})`);
          } else if (isControllable && !currentIsControllable) {
            // Priorità a player controllabili in LAN
            console.log(`🎯 Switch to LAN player: ${playerInfo.name} (from ${primaryPlayer.name})`);
            primaryPlayer = playerInfo;
          }
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
  
  // ⏸️ PULIZIA STATO PAUSA MANUALE SE NECESSARIO (solo se timer scaduto)
  if (manualPauseState && activePlayersLocal.size === 0 && !pauseTimer) {
    // Nessuna sessione attiva, c'era una pausa manuale E il timer è scaduto - fine naturale
    console.log(`🧹 No active music sessions and timer expired - Clearing manual pause state`);
    manualPauseState = null;
  }
  
  // 🧹 RESET MANUAL SELECTION if selected player is no longer active
  if (manualPlayerSelection && !activePlayersLocal.has(manualPlayerSelection)) {
    console.log(`🧹 Manually selected player (${manualPlayerSelection}) no longer active - Resetting manual selection`);
    manualPlayerSelection = null;
  }
  
  console.log(`🎵 Sessions analyzed: ${activePlayersLocal.size} players with active music tracks`);
  if (primaryPlayer) {
    const hasControls = availablePlayers.has(primaryPlayer.machineIdentifier) ? '✅' : '❌';
    console.log(`🎯 Primary music player: ${primaryPlayer.name} (${primaryPlayer.state}) - ${primaryPlayer.trackInfo.artist} - ${primaryPlayer.trackInfo.title}`);
    console.log(`🎵 Now Playing (Music): ${primaryPlayer.trackInfo.artist} - ${primaryPlayer.trackInfo.title} (${primaryPlayer.state}) - Controls: ${hasControls}`);
    
    // Log user information for debug
    if (primaryPlayer.userTitle) {
      console.log(`👤 User: ${primaryPlayer.userTitle} (ID: ${primaryPlayer.userId})`);
    }
    
    // Log di tracce multiple se presenti
    if (playingTracks.size > 1) {
      console.log(`🎮 ${playingTracks.size} different tracks playing:`);
      for (const [ratingKey, players] of playingTracks) {
        const track = players[0];
        console.log(`  📀 ${track.artist} - ${track.title} su ${players.length} player(s)`);
      }
    }
  }
  
  return { activePlayers: activePlayersLocal, primaryPlayer };
}

// 📋 EMISSIONE SICURA - Gestisce errori di connessione
function safeEmit(event, data) {
  try {
    console.log(`📡 Emitting ${event} to ${io.engine.clientsCount} clients`);
    if (event === 'nowPlaying') {
      console.log(`🎵 NowPlaying data:`, {
        isPlaying: data?.isPlaying,
        hasTrack: !!data?.track,
        trackTitle: data?.track?.title,
        trackArtist: data?.track?.artist,
        activeUsers: data?.activeUsers?.length || 0
      });
    }
    io.emit(event, data);
    console.log(`✅ Successfully emitted ${event}`);
  } catch (error) {
    console.error(`❌ Errore emissione ${event}:`, error.message);
    console.error('❌ Stack trace:', error.stack);
    // Non rilanciare l'errore per evitare crash
  }
}

// 📋 AGGIORNAMENTO COUNTDOWN - Solo per pausa manuale (senza interrogare Plex)
async function updateCountdownAndBroadcast() {
  try {
    // Controlla se c'è una pausa manuale attiva
    if (!manualPauseState || !pauseTimer) {
      return; // Nessun countdown da aggiornare
    }
    
    console.log('⏱️ Aggiornamento countdown pausa manuale...');
    
    const track = {
      title: manualPauseState.trackInfo.title,
      artist: manualPauseState.trackInfo.artist,
      album: manualPauseState.trackInfo.album,
      duration: manualPauseState.trackInfo.duration,
      viewOffset: manualPauseState.trackInfo.viewOffset,
      thumb: transformPlexImageUrl(manualPauseState.trackInfo.thumb),
      art: transformPlexImageUrl(manualPauseState.trackInfo.art),
      ratingKey: manualPauseState.trackInfo.ratingKey,
      isLastFm: false
    };
    
    const pauseTimeRemaining = Math.max(0, 30000 - (Date.now() - manualPauseState.timestamp));
    
    const nowPlayingData = {
      isPlaying: false, // In pausa
      track: track,
      activeUsers: [{
        id: manualPauseState.machineIdentifier,
        name: manualPauseState.playerInfo.name,
        title: manualPauseState.playerInfo.name,
        state: 'paused',
        sessionKey: manualPauseState.sessionKey
      }],
      selectedUser: manualPauseState.machineIdentifier,
      isPaused: true, // Flag per indicare pausa manuale
      pauseTimeRemaining: pauseTimeRemaining,
      hasControls: availablePlayers.has(manualPauseState.machineIdentifier),
      multiplePlayers: false // Solo un player in pausa manuale
    };
    
    console.log(`⏱️ Countdown: ${Math.ceil(pauseTimeRemaining / 1000)}s remaining`);
    
    // Broadcast solo del countdown aggiornato
    safeEmit('nowPlaying', nowPlayingData);
    
    return nowPlayingData;
  } catch (error) {
    console.error('❌ Errore aggiornamento countdown:', error.message);
    return null;
  }
}

// 📋 AGGIORNAMENTO SESSIONI E BROADCAST COMPATIBILE
async function updateSessionsAndBroadcast() {
  try {
    console.log('🔄 Starting updateSessionsAndBroadcast...');
    const sessions = await getActiveSessions();
    console.log('📊 Sessions received:', sessions ? 'OK' : 'NULL');
    
    const analysis = analyzeActiveSessions(sessions);
    const { activePlayers: activePlayersLocal, primaryPlayer } = analysis;
    
    console.log(`🎯 Analysis result: ${activePlayersLocal.size} players, primary: ${primaryPlayer ? primaryPlayer.name : 'NONE'}`);
    
    // Aggiorna le mappe globali
    activePlayers.clear();
    for (const [machineId, playerInfo] of activePlayersLocal) {
      activePlayers.set(machineId, playerInfo);
    }
    
    // Emit sessioni complete a tutti i client connessi (per compatibilità)
    if (sessions) {
      safeEmit('sessionsUpdate', sessions);
    }
    
    let nowPlayingData = null;
    
    // ⏸️ GESTIONE PAUSA MANUALE - Priorità MASSIMA
    if (manualPauseState && pauseTimer) {
      // L'utente ha messo manualmente in pausa, mantieni interfaccia per 30s
      const track = {
        title: manualPauseState.trackInfo.title,
        artist: manualPauseState.trackInfo.artist,
        album: manualPauseState.trackInfo.album,
        duration: manualPauseState.trackInfo.duration,
        viewOffset: manualPauseState.trackInfo.viewOffset,
        thumb: transformPlexImageUrl(manualPauseState.trackInfo.thumb),
        art: transformPlexImageUrl(manualPauseState.trackInfo.art),
        ratingKey: manualPauseState.trackInfo.ratingKey,
        isLastFm: false
      };
      
    nowPlayingData = {
      isPlaying: false, // In pausa
      track: track,
      activeUsers: [{
        id: manualPauseState.machineIdentifier,
        name: manualPauseState.playerInfo.name,
        title: manualPauseState.playerInfo.name,
        state: 'paused',
        sessionKey: manualPauseState.sessionKey
      }],
      selectedUser: manualPauseState.machineIdentifier,
      isPaused: true, // Flag per indicare pausa manuale
      pauseTimeRemaining: Math.max(0, 30000 - (Date.now() - manualPauseState.timestamp)),
      hasControls: availablePlayers.has(manualPauseState.machineIdentifier),
      multiplePlayers: false // Only one player in manual pause
    };      console.log(`⏸️ Maintaining interface for manual pause (${Math.ceil(nowPlayingData.pauseTimeRemaining / 1000)}s remaining)`);
    }
    // ⏸️ CHECK IF THERE'S AN EXPIRED MANUAL PAUSE
    else if (manualPauseState && !pauseTimer) {
      // Manual pause expired - show idle with resume option
      console.log(`⏰ Manual pause expired - Showing idle with resume`);
      
      const lastFmTrack = await getLastFmTrack();
      
      nowPlayingData = {
        isPlaying: false,
        isPaused: false, // La pausa è scaduta, ora siamo in idle
        track: lastFmTrack,
        activeUsers: [],
        selectedUser: null,
        hasResumeOption: true, // Flag per mostrare opzione resume
        hasControls: availablePlayers.has(manualPauseState.machineIdentifier),
        multiplePlayers: false, // Nessun player attivo
        resumeTrack: {
          title: manualPauseState.trackInfo.title,
          artist: manualPauseState.trackInfo.artist,
          album: manualPauseState.trackInfo.album,
          thumb: transformPlexImageUrl(manualPauseState.trackInfo.thumb),
          ratingKey: manualPauseState.ratingKey,
          machineIdentifier: manualPauseState.machineIdentifier,
          sessionKey: manualPauseState.sessionKey,
          playerName: manualPauseState.playerInfo.name
        }
      };
    }
    else if (primaryPlayer && primaryPlayer.state === 'playing') {
      // Traccia in riproduzione normale
      const track = {
        title: primaryPlayer.trackInfo.title,
        artist: primaryPlayer.trackInfo.artist,
        album: primaryPlayer.trackInfo.album,
        duration: primaryPlayer.trackInfo.duration,
        viewOffset: primaryPlayer.trackInfo.viewOffset,
        thumb: transformPlexImageUrl(primaryPlayer.trackInfo.thumb),
        art: transformPlexImageUrl(primaryPlayer.trackInfo.art),
        ratingKey: primaryPlayer.trackInfo.ratingKey,
        isLastFm: false
      };
      
      // Analizza se ci sono più utenti o più player dello stesso utente
      const playersByUser = new Map();
      const allPlayers = Array.from(activePlayers.values());
      
      // Raggruppa i player per utente
      for (const player of allPlayers) {
        const userKey = player.userTitle || 'unknown-user';
        if (!playersByUser.has(userKey)) {
          playersByUser.set(userKey, []);
        }
        playersByUser.get(userKey).push(player);
      }
      
      // Filtra solo le sessioni dell'utente primario (quello del primary player)
      const primaryUserKey = primaryPlayer.userTitle || 'unknown-user';
      const sameUserPlayers = playersByUser.get(primaryUserKey) || [primaryPlayer];
      
      console.log(`👤 Users found: ${playersByUser.size}, Primary user's players: ${sameUserPlayers.length}`);
      console.log('🔍 Debug sameUserPlayers:', sameUserPlayers.map(p => ({ id: p.machineIdentifier, name: p.name, state: p.state })));
      
      nowPlayingData = {
        isPlaying: true,
        isPaused: false,
        track: track,
        activeUsers: sameUserPlayers.map(player => ({
          id: player.machineIdentifier,
          name: player.name, // Nome del player, non dell'utente
          title: player.name, // Per compatibilità
          state: player.state,
          sessionKey: player.sessionKey,
          userTitle: player.userTitle
        })),
        selectedUser: primaryPlayer.machineIdentifier,
        hasControls: availablePlayers.has(primaryPlayer.machineIdentifier),
        multipleUsers: playersByUser.size > 1,  // Flag per sapere se ci sono più utenti
        multiplePlayers: sameUserPlayers.length > 1  // Flag per sapere se ci sono più player dello stesso utente
      };
      
      console.log('🔍 Debug nowPlayingData.activeUsers:', nowPlayingData.activeUsers);
      console.log('🔍 Debug nowPlayingData.multiplePlayers:', nowPlayingData.multiplePlayers);
    }
    else if (primaryPlayer && primaryPlayer.state === 'paused') {
      // Traccia in pausa - mostrar IdleScreen con opzione resume
      console.log(`⏸️ Existing paused track - Showing idle with resume`);
      
      const lastFmTrack = await getLastFmTrack();
      
      nowPlayingData = {
        isPlaying: false,
        isPaused: false, // Per IdleScreen
        track: lastFmTrack,
        activeUsers: [],
        selectedUser: null,
        hasResumeOption: true,
        hasControls: availablePlayers.has(primaryPlayer.machineIdentifier),
        multiplePlayers: false, // Nessun player attivo
        resumeTrack: {
          title: primaryPlayer.trackInfo.title,
          artist: primaryPlayer.trackInfo.artist,
          album: primaryPlayer.trackInfo.album,
          thumb: transformPlexImageUrl(primaryPlayer.trackInfo.thumb),
          ratingKey: primaryPlayer.trackInfo.ratingKey,
          machineIdentifier: primaryPlayer.machineIdentifier,
          sessionKey: primaryPlayer.sessionKey,
          playerName: primaryPlayer.name
        }
      };
    } else {
      // Fine naturale della riproduzione - Last.fm normale
      const lastFmTrack = await getLastFmTrack();
      
      nowPlayingData = {
        isPlaying: false,
        track: lastFmTrack,
        activeUsers: [],
        selectedUser: null,
        hasControls: false, // Nessun player attivo, controlli disabilitati
        multiplePlayers: false // Nessun player attivo
      };
    }
    
    // Broadcast ai client nel formato corretto
    console.log('📤 Invio nowPlayingData:', {
      type: nowPlayingData ? 'DATA' : 'NULL',
      isPlaying: nowPlayingData?.isPlaying,
      hasTrack: !!nowPlayingData?.track,
      isPaused: nowPlayingData?.isPaused,
      hasResumeOption: nowPlayingData?.hasResumeOption,
      hasControls: nowPlayingData?.hasControls
    });
    
    safeEmit('nowPlaying', nowPlayingData);
    
    return nowPlayingData;
  } catch (error) {
    console.error('❌ Errore aggiornamento sessioni:', error.message);
    console.error('❌ Stack trace completo:', error.stack);
    return null;
  }
}

// 📋 MEDIA CONTROL
async function mediaControl(command, sessionKey = null, targetMachineId = null) {
  try {
    let targetIP = null;
    
    // Se specifico un machineIdentifier, uso quello
    if (targetMachineId && availablePlayers.has(targetMachineId)) {
      targetIP = availablePlayers.get(targetMachineId).ip;
      console.log(`🎯 Usando player specifico: ${targetMachineId} su ${targetIP}`);
    } 
    // OTTIMIZZAZIONE: Se non specifico un player, uso quello attivo corrente
    else if (activePlayers.size > 0) {
      // Trova il player primario attivo
      const activePlayersList = Array.from(activePlayers.values());
      const playingPlayer = activePlayersList.find(p => p.state === 'playing') || activePlayersList[0];
      
      if (playingPlayer && availablePlayers.has(playingPlayer.machineIdentifier)) {
        targetIP = availablePlayers.get(playingPlayer.machineIdentifier).ip;
        targetMachineId = playingPlayer.machineIdentifier; // Salva per il sessionKey
        console.log(`🎯 Usando player attivo: ${playingPlayer.name} (${playingPlayer.machineIdentifier}) su ${targetIP}`);
      }
    }
    // Usa il player configurato se disponibile
    else if (CONFIG.PLAYER_IP) {
      targetIP = CONFIG.PLAYER_IP;
      console.log(`🎯 Usando player configurato: ${targetIP}`);
    } 
    else {
      // Fallback: prova a usare l'IP del server Plex per discovery
      console.log(`🔍 Nessun player disponibile in cache, avvio discovery...`);
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
    
    // Aggiungi sessionKey se fornito, altrimenti usa quello del player attivo
    if (sessionKey) {
      params.sessionKey = sessionKey;
    } else if (targetMachineId && activePlayers.has(targetMachineId)) {
      const activePlayer = activePlayers.get(targetMachineId);
      if (activePlayer.sessionKey) {
        params.sessionKey = activePlayer.sessionKey;
        console.log(`🔑 Usando sessionKey del player attivo: ${activePlayer.sessionKey}`);
      }
    }
    
    console.log(`🎮 Invio comando: ${command} → ${plexCommand} a ${targetIP}:32500${params.sessionKey ? ` (session: ${params.sessionKey})` : ''}`);
    
    const response = await axios.get(controlUrl, {
      params: params,
      timeout: 5000
    });
    
    // ⏸️ TRACCIA AZIONI MANUALI DELL'UTENTE
    lastUserAction = {
      action: command,
      timestamp: Date.now(),
      machineIdentifier: targetMachineId,
      sessionKey: params.sessionKey
    };
    
    // ⏸️ GESTIONE PAUSA MANUALE
    if (command === 'pause' && targetMachineId && activePlayers.has(targetMachineId)) {
      const activePlayer = activePlayers.get(targetMachineId);
      manualPauseState = {
        ratingKey: activePlayer.ratingKey,
        machineIdentifier: targetMachineId,
        sessionKey: params.sessionKey,
        timestamp: Date.now(),
        trackInfo: { ...activePlayer.trackInfo },
        playerInfo: {
          name: activePlayer.name,
          ip: targetIP
        }
      };
      
      console.log(`⏸️ Pausa manuale registrata: ${activePlayer.trackInfo.artist} - ${activePlayer.trackInfo.title}`);
      
      // Avvia timer di 30 secondi
      if (pauseTimer) {
        clearTimeout(pauseTimer);
      }
      
      pauseTimer = setTimeout(() => {
        console.log(`⏰ Timer pausa scaduto (30s) - Passaggio a idle...`);
        
        // Cancella lo stato di pausa manuale e il timer
        manualPauseState = null;
        pauseTimer = null;
        
        // Forza aggiornamento per passare a idle
        updateSessionsAndBroadcast();
      }, 30000); // 30 secondi
    }
    
    // ⏸️ CANCELLA PAUSA MANUALE SE L'UTENTE RIPRENDE
    if (command === 'play' && manualPauseState) {
      console.log(`▶️ Ripresa da pausa manuale`);
      manualPauseState = null;
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
    }
    
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

// 📋 REGISTRAZIONE ROUTE API
setLastfmService(lastfmService);
app.use('/api/lastfm', lastfmRouter);
setConfigService(configService, reloadConfigFromDisk, deviceSetupService);
app.use('/api/config', configRouter);
setAuthServices(configService, plexAuthService, reloadConfigFromDisk, deviceSetupService);
app.use('/api/auth', authRouter);

// Test di connessione usato dal pannello /config prima di salvare. Richiede
// la sessione: senza token esplicito usa quello salvato, che non deve poter
// essere inviato a un indirizzo scelto da chiunque.
app.post('/api/plex/test-connection', deviceSetupService.requireSession, async (req, res) => {
  try {
    const { url, port } = req.body;
    const token = req.body.token || CONFIG.PLEX_TOKEN;
    if (!url || !token) {
      return res.status(400).json({ error: 'URL e token sono obbligatori' });
    }

    const response = await axios.get(`http://${url}:${port || 32400}/identity`, {
      headers: { 'X-Plex-Token': token, 'Accept': 'application/json' },
      timeout: 5000
    });

    const server = response.data?.MediaContainer;
    res.json({ success: true, server: server?.friendlyName || server?.machineIdentifier || url });
  } catch (error) {
    res.status(400).json({ error: error.response?.status === 401 ? 'Token non valido' : error.message });
  }
});

// Opzioni per i filtri mostrate in /config: utenti del server Plex e player
// noti (dal server, da plex.tv e dalle sessioni viste di recente).
app.get('/api/config/filter-options', deviceSetupService.requireSession, async (req, res) => {
  const users = new Map();
  const players = new Map();
  const addPlayer = (machineIdentifier, data) => {
    if (!machineIdentifier) return;
    const id = String(machineIdentifier);
    players.set(id, { machineIdentifier: id, ...players.get(id), ...data });
  };

  if (CONFIG.PLEX_SERVER_URL && CONFIG.PLEX_TOKEN) {
    const plexGet = path => axios.get(`${CONFIG.PLEX_SERVER_URL}${path}`, {
      headers: { 'X-Plex-Token': CONFIG.PLEX_TOKEN, 'Accept': 'application/json' },
      timeout: 5000
    });

    const [accounts, clients, resources] = await Promise.allSettled([
      plexGet('/accounts'),
      plexGet('/clients'),
      plexAuthService.getPlayerResources(CONFIG.PLEX_TOKEN)
    ]);

    if (accounts.status === 'fulfilled') {
      const list = accounts.value.data?.MediaContainer?.Account || [];
      for (const account of Array.isArray(list) ? list : [list]) {
        // L'account 0 è quello di sistema del server, non un utente reale
        if (account?.id === undefined || String(account.id) === '0' || !account.name) continue;
        users.set(String(account.id), { id: String(account.id), title: account.name });
      }
    }
    if (clients.status === 'fulfilled') {
      const list = clients.value.data?.MediaContainer?.Server || [];
      for (const client of Array.isArray(list) ? list : [list]) {
        addPlayer(client?.machineIdentifier, { title: client.name, product: client.product || '' });
      }
    }
    if (resources.status === 'fulfilled') {
      for (const player of resources.value) {
        addPlayer(player.machineIdentifier, { title: player.title, product: player.product });
      }
    }
  }

  for (const user of seenRegistry.recentUsers()) {
    users.set(user.id, { id: user.id, title: user.title, ...users.get(user.id) });
  }
  for (const player of seenRegistry.recentPlayers()) {
    // I nomi visti nelle sessioni sono i più aggiornati
    addPlayer(player.machineIdentifier, { title: player.title, product: player.product, local: player.local });
  }

  // Gli elementi già selezionati restano sempre in elenco, anche se ora
  // non sono raggiungibili
  for (const id of CONFIG.FILTERS.users) {
    if (!users.has(id)) users.set(id, { id, title: `Utente ${id} (non trovato)` });
  }
  for (const id of CONFIG.FILTERS.players) {
    if (!players.has(id)) addPlayer(id, { title: `Player ${id.slice(0, 8)}… (non trovato)`, product: '' });
  }

  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '');
  res.json({
    users: [...users.values()].sort(byTitle),
    players: [...players.values()].map(p => ({ product: '', ...p, title: p.title || p.product || p.machineIdentifier })).sort(byTitle)
  });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: CONFIG.CLIENT_URL,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true
});

// Gestione errori del server Socket.io
io.engine.on('connection_error', (err) => {
  console.error('❌ Errore connessione Socket.io:', err.req ? `${err.req.method} ${err.req.url}` : 'Unknown');
  console.error('❌ Dettagli errore:', err.message);
});

// Gestione globale errori EPIPE per evitare crash
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    console.log('⚠️ EPIPE ignorato (client disconnesso)');
    return;
  }
  console.error('❌ Errore non gestito:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rifiutata:', reason);
});

// 📋 WEBSOCKET HANDLERS
io.on('connection', (socket) => {
  console.log('🔌 Client connesso:', socket.id);
  console.log(`👥 Totale client connessi: ${io.engine.clientsCount}`);
  
  // Gestione errori del socket
  socket.on('error', (error) => {
    console.error(`❌ Errore socket ${socket.id}:`, error.message);
  });
  
  // Se il dispositivo non è (ancora) configurato, il client deve mostrare
  // subito il QR di configurazione invece della grafica "idle" di Last.fm.
  if (!CONFIG.PLEX_TOKEN || !CONFIG.PLEX_SERVER_URL || !configService.hasConfigPassword()) {
    socket.emit('authRequired', { reason: 'not_configured' });
  }

  // Invia immediatamente lo stato al nuovo client
  console.log('📨 Invio stato iniziale al nuovo client...');
  updateSessionsAndBroadcast();
  
  // Handler per controlli media compatibile con il client React originale
  socket.on('mediaControl', async (data) => {
    // Supporta sia il formato nuovo {command, sessionKey} che quello vecchio {type}
    const command = data.command || data.type;
    const sessionKey = data.sessionKey;
    const machineIdentifier = data.machineIdentifier;
    
    console.log(`📨 Ricevuto comando: ${command} per player ${machineIdentifier || 'default'}`);
    
    const result = await mediaControl(command, sessionKey, machineIdentifier);
    socket.emit('mediaControlResponse', result);
    
    // Aggiorna le sessioni dopo il comando
    setTimeout(async () => {
      await updateSessionsAndBroadcast();
    }, 1000);
  });

  // ⏸️ Handler per resume da pausa manuale o esistente
  socket.on('resumeFromPause', async () => {
    let sessionKey = null;
    let machineIdentifier = null;
    let trackInfo = null;
    
    if (manualPauseState) {
      // Resume da pausa manuale
      console.log(`▶️ Resume richiesto per pausa manuale: ${manualPauseState.trackInfo.artist} - ${manualPauseState.trackInfo.title}`);
      sessionKey = manualPauseState.sessionKey;
      machineIdentifier = manualPauseState.machineIdentifier;
      trackInfo = manualPauseState.trackInfo;
    } else {
      // Cerca un player in pausa per resume da pausa esistente
      const pausedPlayer = Array.from(activePlayers.values()).find(p => p.state === 'paused');
      
      if (pausedPlayer) {
        console.log(`▶️ Resume richiesto per traccia in pausa: ${pausedPlayer.trackInfo.artist} - ${pausedPlayer.trackInfo.title}`);
        sessionKey = pausedPlayer.sessionKey;
        machineIdentifier = pausedPlayer.machineIdentifier;
        trackInfo = pausedPlayer.trackInfo;
      }
    }
    
    if (sessionKey && machineIdentifier) {
      const result = await mediaControl(
        'play', 
        sessionKey, 
        machineIdentifier
      );
      
      socket.emit('resumeResponse', result);
      
      // Pulisci stato di pausa manuale se era una pausa manuale
      if (result.success && manualPauseState) {
        manualPauseState = null;
        if (pauseTimer) {
          clearTimeout(pauseTimer);
          pauseTimer = null;
        }
      }
      
      // Aggiorna le sessioni
      setTimeout(async () => {
        await updateSessionsAndBroadcast();
      }, 1000);
    } else {
      socket.emit('resumeResponse', { success: false, error: 'Nessuna traccia in pausa trovata' });
    }
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
      hasToken: !!CONFIG.PLEX_TOKEN,
      lastfm: {
        configured: !!(CONFIG.LASTFM.username && CONFIG.LASTFM.apiKey),
        username: CONFIG.LASTFM.username || null,
        hasApiKey: !!CONFIG.LASTFM.apiKey
      }
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
        safeEmit('trackSwitched', {
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
  
  // 🔄 ORIGINAL REACT CLIENT COMPATIBILITY
  // Legacy handler for switchUser (compatibility)
  socket.on('switchUser', async (userId) => {
    console.log(`🔄 RECEIVED Switch legacy user request: ${userId}`);
    console.log(`🔍 availablePlayers:`, Array.from(availablePlayers.keys()));
    console.log(`🔍 activePlayers:`, Array.from(activePlayers.keys()));
    console.log(`🔍 availablePlayers has userId: ${availablePlayers.has(userId)}`);
    console.log(`🔍 activePlayers has userId: ${activePlayers.has(userId)}`);
    
    if (activePlayers.has(userId)) {
      const playerInfo = activePlayers.get(userId);
      console.log(`🔄 Switching to player:`, playerInfo);
      
      // 🎯 SET MANUAL SELECTION - This prevents automatic override
      manualPlayerSelection = userId;
      console.log(`🎯 Set manualPlayerSelection to: ${manualPlayerSelection}`);
      
      currentDisplayedTrack = {
        ratingKey: playerInfo.ratingKey,
        title: playerInfo.trackInfo.title,
        artist: playerInfo.trackInfo.artist,
        machineIdentifier: userId
      };
      console.log(`🔄 Updated currentDisplayedTrack:`, currentDisplayedTrack);
      
      // Update and broadcast
      console.log(`🔄 Calling updateSessionsAndBroadcast...`);
      await updateSessionsAndBroadcast();
      console.log(`✅ updateSessionsAndBroadcast completed`);
    } else {
      console.log(`❌ Player ${userId} not found in activePlayers`);
      console.log(`📋 Available activePlayers:`, Array.from(activePlayers.entries()).map(([id, info]) => ({ id, title: info.trackInfo?.title })));
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
    const serverIP = new URL(CONFIG.PLEX_SERVER_URL).hostname;
    const players = await discoverAllPlexPlayers(serverIP);
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 PROXY IMMAGINI PLEX - Il token non deve mai raggiungere il browser:
// il client chiede sempre /api/art?path=..., il server aggiunge il token
// e inoltra la richiesta al server Plex.
app.get('/api/art', async (req, res) => {
  try {
    const { path: imagePath } = req.query;

    // Accetta solo percorsi relativi dello stesso server Plex configurato,
    // mai un URL assoluto o un percorso protocol-relative (evita SSRF).
    if (!imagePath || typeof imagePath !== 'string' || !imagePath.startsWith('/') || imagePath.startsWith('//')) {
      return res.status(400).json({ error: 'Percorso immagine non valido' });
    }
    if (!CONFIG.PLEX_SERVER_URL || !CONFIG.PLEX_TOKEN) {
      return res.status(503).json({ error: 'Plex non configurato' });
    }

    const response = await axios.get(`${CONFIG.PLEX_SERVER_URL}${imagePath}`, {
      params: { 'X-Plex-Token': CONFIG.PLEX_TOKEN },
      responseType: 'stream',
      timeout: 10000
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    response.data.pipe(res);
  } catch (error) {
    console.error('❌ Errore proxy immagine:', error.message);
    res.status(502).json({ error: 'Impossibile recuperare l\'immagine da Plex' });
  }
});

// 📋 ENDPOINT LAST.FM PER IDLE SCREEN
app.get('/api/lastfm/idle-data', async (req, res) => {
  try {
    // Controlla se Last.fm è configurato
    if (!CONFIG.LASTFM.username || !CONFIG.LASTFM.apiKey) {
      return res.status(400).json({ 
        error: 'Last.fm not configured',
        message: 'Please configure Last.fm username and API key' 
      });
    }

    // Recupera informazioni utente
    const userInfoUrl = `http://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${CONFIG.LASTFM.username}&api_key=${CONFIG.LASTFM.apiKey}&format=json`;
    
    // Recupera tracce recenti
    const recentTracksUrl = `http://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${CONFIG.LASTFM.username}&api_key=${CONFIG.LASTFM.apiKey}&format=json&limit=1`;
    
    // Recupera album più ascoltati
    const topAlbumsUrl = `http://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${CONFIG.LASTFM.username}&api_key=${CONFIG.LASTFM.apiKey}&format=json&period=1month&limit=12`;

    const [userResponse, recentResponse, albumsResponse] = await Promise.all([
      axios.get(userInfoUrl, { timeout: 5000 }),
      axios.get(recentTracksUrl, { timeout: 5000 }),
      axios.get(topAlbumsUrl, { timeout: 5000 })
    ]);

    const userData = userResponse.data;
    const recentData = recentResponse.data;
    const albumsData = albumsResponse.data;

    // Costruisci la risposta nel formato atteso dal client
    const idleData = {
      username: CONFIG.LASTFM.username,
      scrobbles: parseInt(userData.user?.playcount || 0),
      lastTrack: null,
      topAlbums: []
    };

    // Ultima traccia
    if (recentData.recenttracks && recentData.recenttracks.track && recentData.recenttracks.track.length > 0) {
      idleData.lastTrack = recentData.recenttracks.track[0];
    }

    // Album più ascoltati
    if (albumsData.topalbums && albumsData.topalbums.album) {
      idleData.topAlbums = Array.isArray(albumsData.topalbums.album) 
        ? albumsData.topalbums.album 
        : [albumsData.topalbums.album];
    }

    res.json(idleData);
  } catch (error) {
    console.error('❌ Errore endpoint Last.fm:', error.message);
    res.status(500).json({ 
      error: 'Last.fm API error',
      message: error.message 
    });
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
  
  if (!CONFIG.PLEX_SERVER_URL || !CONFIG.PLEX_TOKEN) {
    console.log('⚠️  Plex non configurato, WebSocket non avviata');
    return;
  }

  console.log('🔌 Connessione WebSocket Plex...');

  // Costruisci URL WebSocket (sostituisci http con ws) + filtro per eventi playing
  const wsUrl = CONFIG.PLEX_SERVER_URL.replace('http://', 'ws://').replace('https://', 'wss://') +
                `/:/websockets/notifications?X-Plex-Token=${CONFIG.PLEX_TOKEN}&filters=playing`;

  // Non stampare mai il token nei log
  console.log('🔗 URL WebSocket:', wsUrl.replace(CONFIG.PLEX_TOKEN, '***'));
  
  plexWebSocket = new WebSocket(wsUrl);
  
  plexWebSocket.on('open', () => {
    console.log('✅ WebSocket Plex connessa!');
    console.log('📡 Monitoraggio eventi in tempo reale attivo');
    
    // Notifica ai client Socket.io
    safeEmit('plexWebSocketStatus', { 
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
          // Player escluso dai filtri: la notifica non deve spostare nulla
          if (hasActiveFilters(CONFIG.FILTERS) && !allowedMachineIds.has(notification.clientIdentifier)) {
            continue;
          }
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
                safeEmit('playerSwitched', {
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
      safeEmit('plexEvent', eventData);
      
      // Trigger refresh delle sessioni per aggiornamento UI
      if (eventData.NotificationContainer) {
        console.log('🔄 Triggering session refresh dopo evento...');
        setTimeout(async () => {
          await updateSessionsAndBroadcast();
        }, 500); // Piccolo delay per permettere a Plex di aggiornare le sessioni
      }
      
    } catch (error) {
      console.error('❌ Errore parsing evento Plex:', error);
    }
  });
  
  plexWebSocket.on('error', (error) => {
    console.error('❌ Errore WebSocket:', error);
    
    // Notifica ai client Socket.io
    safeEmit('plexWebSocketStatus', { 
      connected: false, 
      message: 'WebSocket disconnessa - tentativo riconnessione...' 
    });
  });
  
  plexWebSocket.on('close', (code, reason) => {
    console.log(`🔌 WebSocket chiusa - Codice: ${code}, Motivo: ${reason}`);
    
    // Notifica ai client Socket.io
    safeEmit('plexWebSocketStatus', { 
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

// 📋 MONITORAGGIO CONTINUO - Doppia frequenza
let monitoringInterval = null;
let countdownInterval = null;

function startMonitoring() {
  console.log('📡 Avvio monitoraggio sessioni avanzato (solo contenuti musicali)...');

  // Monitoraggio normale ogni 10 secondi. La guardia evita che i cicli si
  // accumulino se una chiamata a Plex è più lenta dell'intervallo stesso.
  let sessionsCheckInFlight = false;
  monitoringInterval = setInterval(async () => {
    if (sessionsCheckInFlight) return;
    sessionsCheckInFlight = true;
    try {
      // Usa la logica completa che gestisce correttamente la pausa manuale
      await updateSessionsAndBroadcast();
    } catch (error) {
      console.error('❌ Errore monitoraggio:', error.message);
    } finally {
      sessionsCheckInFlight = false;
    }
  }, 10000); // Controlla ogni 10 secondi per sessioni Plex
  
  // Monitoraggio countdown ogni secondo (solo quando necessario)
  countdownInterval = setInterval(async () => {
    try {
      // Aggiorna solo se c'è un countdown attivo (pausa manuale)
      if (manualPauseState && pauseTimer) {
        await updateCountdownAndBroadcast();
      }
    } catch (error) {
      console.error('❌ Errore monitoraggio countdown:', error.message);
    }
  }, 1000); // Controlla ogni 1 secondo solo per countdown
  
  console.log('📡 Monitoring started: 10s for sessions, 1s for countdown');
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  console.log('📡 Monitoraggio arrestato');
}

// 📋 STARTUP
const PORT = process.env.PORT || 3001;

server.listen(PORT, async () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`📱 Configurazione dal telefono: ${deviceSetupService.getBaseUrl()}/setup`);

  // Configurazioni create prima del login QR non conoscono l'account Plex
  // del dispositivo, necessario per "Password dimenticata": lo si ricava
  // dal token già salvato.
  const plexConfig = configService.getConfig().plex || {};
  if (plexConfig.token && !plexConfig.accountId) {
    plexAuthService.getAccount(plexConfig.token)
      .then(account => configService.setPlexAccountId(account.id))
      .catch(error => console.log('⚠️  Account Plex non recuperato:', error.message));
  }

  if (!CONFIG.PLEX_SERVER_URL || !CONFIG.PLEX_TOKEN) {
    console.log('⚠️  Plex non configurato: inquadra il QR sullo schermo per la configurazione iniziale.');
    startMonitoring();
    return;
  }

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

console.log('💾 Plex Media Control System with NMAP started');
console.log('📋 Configurazione:', {
  serverUrl: CONFIG.PLEX_SERVER_URL,
  discoveryMethod: 'NMAP Network Scan',
  port: PORT
});
