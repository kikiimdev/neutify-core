import type { Boom } from '@hapi/boom'
import { default as _makeWASocket, DisconnectReason, fetchLatestBaileysVersion, isJidBroadcast, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { rm } from "fs/promises"
import type { DefineWhatsAppStorage } from './whatsapp-storage'
import { parseContactId } from './parse-contact-id'

type MakeWASocket = typeof _makeWASocket
export type WASocket = ReturnType<MakeWASocket>
export const makeWASocket = ((_makeWASocket as any)?.default) as MakeWASocket ?? _makeWASocket

type DefineWhatsAppSocketOpts<Device> = {
  storage: Awaited<DefineWhatsAppStorage<Device>>,
  logger?: any
}

export async function defineWhatsAppSocket<Device>(deviceId: string, opts: DefineWhatsAppSocketOpts<Device>) {
  const { storage } = opts
  const device = await storage.device.get(deviceId)
  const { state, saveCreds } = await useMultiFileAuthState(`.whatsapp/${deviceId}/session`)
  // fetch latest version of WA Web
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

  const sock = makeWASocket({
    // @ts-ignore
    browser: [`${process.env.NUXT_APP_NAME} | ${device.name}`, "MacOs", "1.0.0"],
    version,
    logger: opts.logger,
    printQRInTerminal: true,
    auth: state,
    // msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    // ignore all broadcast messages -- to receive the same
    // comment the line below out
    shouldIgnoreJid: jid => isJidBroadcast(jid),
    // implement to handle retries & poll updates
    // getMessage,
  })

  await storage.socket.set(deviceId, sock)

  // the process function lets you process all events that just occurred
  // efficiently in a batch
  sock.ev.process(
    // events is a map for event name => event data
    async (events) => {
      // something about the connection changed
      // maybe it closed, or we received all offline message or connection opened
      if (events['connection.update']) {

        await storage.socket.set(deviceId, sock)

        const update = events['connection.update']
        const { connection, lastDisconnect, qr } = update

        await storage.socket.onConnectionUpdate(deviceId, update)

        if (connection === 'close') {
          const errorOutput = (lastDisconnect?.error as Boom)!.output!
          const isLoggedOut = errorOutput.statusCode === DisconnectReason.loggedOut
          const isConnectionClosed =
            errorOutput.statusCode === DisconnectReason.connectionClosed
          const isTimedOut = errorOutput.statusCode === DisconnectReason.timedOut
          const isConnectionFailure = errorOutput.statusCode === 405
          const isStreamErrored =
            errorOutput.statusCode === DisconnectReason.restartRequired ||
            errorOutput.statusCode === 503
          const isStreamConflict =
            errorOutput.statusCode === 440 &&
            errorOutput.payload.message.includes("conflict")
          const isConnectionLost =
            errorOutput.statusCode === DisconnectReason.connectionLost &&
            errorOutput.payload.message.includes("lost")
          const isRequestTimeout =
            errorOutput.statusCode === DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("timed out")
          const isQrTimeout =
            errorOutput.statusCode === DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("QR refs")
          const isCantConnectToWhatsAppServer = DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("web.whatsapp.com")
          const isWebSocketError = DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("WebSocket Error ")
          const isInternalServerError = errorOutput.statusCode === 500
          // const mustDeleteSession = isConnectionClosed || isLoggedOut
          const mustDeleteSession = isLoggedOut
          const mustRestart =
            mustDeleteSession ||
            isStreamErrored ||
            isStreamConflict ||
            isConnectionClosed ||
            isConnectionLost ||
            isRequestTimeout ||
            isQrTimeout ||
            isInternalServerError ||
            isCantConnectToWhatsAppServer ||
            isWebSocketError

          const ignoreError = false
          const ignoreSendMessage = isQrTimeout

          if (!ignoreError) {
            if (!ignoreSendMessage) {
              // TODO: Send alert if whatsapp is down
            }

            if (mustDeleteSession) {
              rm(`.whatsapp/${deviceId}/session`, { recursive: true })
            }

            if (mustRestart) {
              defineWhatsAppSocket(deviceId, opts)
            }
          }
        }

        if (connection === 'open') {
          const me = sock.authState.creds.me
          if (me) {
            const { jId, phoneNumber } = parseContactId(me.id)
            const profilePictureUrl = await sock.profilePictureUrl(jId).catch(() => '')
            if (profilePictureUrl) {
              me.imgUrl = profilePictureUrl
            }
            await storage.socket.onWhatsAppConnected(deviceId, me)
          }
        }

        console.log('connection update', update)
      }

      // credentials updated -- save them
      if (events['creds.update']) {
        await saveCreds()
      }

      // received a new message
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert']
        // console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

        if (upsert.type === 'notify') {
          for (const upcomingMessage of upsert.messages) {
            // console.log('upcomingMessage ', JSON.stringify(upcomingMessage, undefined, 2));
          }
        }
      }
    }
  )

  return sock
}