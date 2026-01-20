const { ipcMain } = require('electron')
const {TikTokLiveConnection, WebcastEvent} = require("tiktok-live-connector");
const {ConnectState, ControlEvent} = require("tiktok-live-connector/dist/types/events");
const {
  switchGlobalSignProviderHost,
  getCurrentSignHostLabel,
  isSecondaryHostConfigured,
  getSecondarySignHost,
  signEvents
} = require('./signProviderManager')

if (signEvents && !signEvents.listenerCount('signSuccess')) {
  signEvents.on('signSuccess', ({ signHost, originalUrl }) => {
    console.log('TTLiveEvents: sign request succeeded via host', signHost, 'for', originalUrl)
  })
}

function registerTTLiveEvents() {

  let tiktokLiveConnection;
  let viewerCount = 0;
  let disconnectedType = ''
  let streamHasEnded = false;
  let reconnectAttempts = 0;
  let lastConnectionTryTime = 0;
  ipcMain.on('disconnectToTikTok', (event, args) => {
    console.log('disconnectToTikTok disconnectedType ', args.type);
    if (args.type === 'user') {
      disconnectedType = 'user'
    } else {
      disconnectedType = ''
    }
    switchGlobalSignProviderHost(false)
    if(tiktokLiveConnection) {
      tiktokLiveConnection.disconnect();
      tiktokLiveConnection.removeAllListeners(); // Remove all event listeners
      tiktokLiveConnection = null; // Clear the reference
    }

    // Reset all state variables
    viewerCount = 0;
    streamHasEnded = false;
    reconnectAttempts = 0;
    lastConnectionTryTime = 0;

    //console.log('TTLiveEvents: Unsubscribed from all events and reset state');
  })

  ipcMain.on('getGifts', (event, args) => {
    const tiktokUsername = args
    const tiktokLiveConnectionPush = new TikTokLiveConnection(tiktokUsername);
    tiktokLiveConnectionPush.fetchAvailableGifts().then(giftList => {
      event.reply('getGifts', giftList);
    }).catch(err => {
      console.error(err);
    });
  })

  ipcMain.on("connectToTikTok", (event, args) => {
    const { username, byServerSignature } = args
    if (!byServerSignature) return
    console.log("connect to TikTok user,byServerSignature", username, ':', byServerSignature);
    switchGlobalSignProviderHost(false)
    streamHasEnded = false;
    disconnectedType = "";

    const secondarySignHost = getSecondarySignHost()
    const secondaryHostAvailable = isSecondaryHostConfigured()

    let usingSecondarySignHost = false
    let hasTriedSecondarySignHost = false
    let currentSignProviderHostLabel = getCurrentSignHostLabel()
    let suppressAutoReconnect = false

    function subscribeToAllEvents(connection) {
      let lastSendMessageTime = 0;

      connection.on('websocketConnected', websocketClient => {
        event.reply('onTikTokEvent', { type: 'websocketConnected' });
      });

      connection.on(ControlEvent.ERROR, err => {
        event.reply('onTikTokEvent', { type: 'error', data: err });
        console.error('tiktokLiveConnection Error!', err);
      });

      connection.on(WebcastEvent.CHAT, data => {
        if (data?.common?.createTime > lastSendMessageTime) {
          lastSendMessageTime = data?.common?.createTime;
          event.reply('onTikTokEvent', { data, type: 'chat' });
        }
      })

      connection.on(WebcastEvent.GIFT, data => {
        if (!(data.giftDetails.giftType === 1  && data.repeatEnd == 0)) {
          event.reply('onTikTokEvent', { type: 'gift', data: data });
        } else {
          event.reply('onTikTokEvent', { type: 'gift-solo', data: data });
        }
      });

      connection.on(ControlEvent.DISCONNECTED, () => {
        if (disconnectedType === 'user') {
          console.log('disconnectedType by user')
          disconnectedType = ''
          suppressAutoReconnect = true
        } else {
          if (suppressAutoReconnect) {
            console.log('TTLiveEvents: auto reconnect suppressed after previous failure')
            return
          }
          console.log('disconnectedType!!! trying to reconnect')
          reconnectAttempts = 0;
          console.log('sand tryConnectToTikTok from tiktokLiveConnection(disconnected)')
          tryConnectToTikTok(true);
        }
      });

      connection.on(WebcastEvent.STREAM_END, data => {
        streamHasEnded = true
        event.reply('onTikTokEvent', { data: data, type: 'streamEnd' });
      });

      connection.on(WebcastEvent.MEMBER, data => {
        event.reply('onTikTokEvent', { type: 'member', data: data });
      })

      connection.on(WebcastEvent.ROOM_USER, data => {
        event.reply('onTikTokEvent', { type: 'roomUser', data: data });

        viewerCount = data?.viewerCount || 0
      })

      connection.on(WebcastEvent.LIKE, data => {
        event.reply('onTikTokEvent', { type: 'like', data: data });
      })

      connection.on(WebcastEvent.ENVELOPE, data => {
        event.reply('onTikTokEvent', { type: 'envelope', data: data });
      })

      connection.on(WebcastEvent.SUPER_FAN, data => {
        event.reply('onTikTokEvent', { type: 'superFan', data: data });
      })

      connection.on(WebcastEvent.FOLLOW, data => {
        event.reply('onTikTokEvent', { type: 'follow', data: data });
      })

      connection.on(WebcastEvent.SHARE, data => {
        event.reply('onTikTokEvent', { type: 'share', data: data });
      })
    }

    function createTikTokConnection() {
      if (tiktokLiveConnection) {
        try {
          tiktokLiveConnection.removeAllListeners()
        } catch (removeErr) {
          console.warn('TTLiveEvents: failed to remove listeners from previous connection', removeErr?.message)
        }
        try {
          tiktokLiveConnection.disconnect()
        } catch (disconnectErr) {
          console.warn('TTLiveEvents: failed to disconnect previous connection', disconnectErr?.message)
        }
      }

      const shouldUseSecondary = usingSecondarySignHost && secondaryHostAvailable
      currentSignProviderHostLabel = shouldUseSecondary
        ? secondarySignHost
        : getCurrentSignHostLabel()

      const connectionOptions = shouldUseSecondary
        ? { signProviderOptions: { host: secondarySignHost } }
        : undefined

      tiktokLiveConnection = connectionOptions
        ? new TikTokLiveConnection(username, connectionOptions)
        : new TikTokLiveConnection(username)

      subscribeToAllEvents(tiktokLiveConnection)
      console.log('TTLiveEvents: created TikTok connection using sign provider host', currentSignProviderHostLabel)
    }

    function shouldSwitchToSecondary(err) {
      if (!secondaryHostAvailable || usingSecondarySignHost || hasTriedSecondarySignHost) {
        return false
      }

      if (!err) {
        return true
      }

      return true
    }

    function attemptSwitchToSecondary(err) {
      if (!shouldSwitchToSecondary(err)) {
        return false
      }

      switchGlobalSignProviderHost(true)
      usingSecondarySignHost = true
      hasTriedSecondarySignHost = true
      reconnectAttempts = 0;
      lastConnectionTryTime = 0;

      console.warn('TTLiveEvents: switching sign provider host to secondary', secondarySignHost, err?.message)

      createTikTokConnection()
      tryConnectToTikTok(true, { forceImmediate: true })
      return true
    }

    createTikTokConnection()

    async function isReconnectAllowed(reconnect, forceImmediate = false) {
      if (!tiktokLiveConnection) {
        console.log('TTLiveEvents: isReconnectAllowed aborted, connection instance missing')
        return false
      }

      if (tiktokLiveConnection.isConnected) {
        console.log('TikTok live stream already connected');
        return false;
      }

      if (!forceImmediate) {
        if (reconnectAttempts >= 3) {
          console.log('To many reconnect attempts');
          reconnectAttempts = 0;
          return false;
        }
      }

      const currentTime = new Date().getTime();
      const timeSinceLastConnectAttempt = currentTime - lastConnectionTryTime;

      if (!forceImmediate && timeSinceLastConnectAttempt < 3000) {
        console.log('tiktok connect postponed');
        setTimeout(() => {
          tryConnectToTikTok(reconnect);
        }, 3050 - timeSinceLastConnectAttempt);
        return false;
      }

      if (streamHasEnded) {
        console.log("Stream has ended, not attempting to reconnect.");
        return false;
      }

      let isInternetConnected = !!await require('dns').promises.resolve('google.com').catch(() => {
      })
      if (!isInternetConnected) {
        console.log('NO INTERNET CONNECTION, tt connect not possible');
        return false;
      }

      return true;
    }

    async function tryConnectToTikTok(reconnect = false, options = {}) {
      const { forceImmediate = false } = options
      if (disconnectedType === 'user') {
        console.log('TTLiveEvents: tryConnectToTikTok aborted due to user disconnect flag')
        return
      }
      if (!tiktokLiveConnection) {
        console.warn('TTLiveEvents: tryConnectToTikTok aborted, connection instance missing')
        return
      }

      const isConnectionAllowed = await isReconnectAllowed(reconnect);
      if (!isConnectionAllowed) return;

      console.log('tryConnectToTikTok using sign host', currentSignProviderHostLabel, 'reconnect:', reconnect, 'forceImmediate:', forceImmediate);
      lastConnectionTryTime = new Date().getTime();

      if (reconnect) {
        event.reply('onTikTokEvent', { type: 'reconnect' })
      }


      tiktokLiveConnection.connect().then(state => {
        console.info(`Connected to roomId ${state.roomId}`);
        console.info('TTLiveEvents: connected using sign provider host', currentSignProviderHostLabel);
        event.reply('onTikTokEvent', { data: { isConnected: true, reconnect, state }, type: 'connection' });
        reconnectAttempts = 0; // Сбросить счетчик попыток после успешного подключения
      }).catch(err => {
        if (attemptSwitchToSecondary(err)) {
          return;
        }

        if (disconnectedType === 'user') {
          console.log('TTLiveEvents: reconnect skipped after user disconnect')
          return
        }

        if (!tiktokLiveConnection.isConnected) {
          const message = err?.message ? err?.message :'null';
          console.error('TikTokConecctroErrorMessage:', err.message)
          let eventMessage = '';
          if (message.includes('500')) {
            eventMessage = 'ServerErrorRetryInFewMinutes';
          } else if (message.includes('429')) {
            eventMessage = 'ToManyReconnectAttempts';
          } else if (message.includes('LIVE has ended')) {
            eventMessage = 'LiveHasEnded';
          } else if (message.includes('Failed to retrieve')) {
            eventMessage = 'UsernameError';
          } else if (message.includes('code 503')) {
            eventMessage = 'ConncetionServerOffline';
          }
          if (eventMessage) {
            console.log('eventMessage-->>>',eventMessage)
            event.reply('onTikTokEvent', {
              data: { isConnected: false, reconnect: false, msg: eventMessage },
              type: 'connection'
            });
            return;
          }
        }
        event.reply('onTikTokEvent', { data: { isConnected: false, reconnect, err }, type: 'connection' });
        suppressAutoReconnect = true
      })
    }
    tryConnectToTikTok();
  });
}

module.exports = { registerTTLiveEvents: () => registerTTLiveEvents() }
