import type { Boom } from "@hapi/boom";
import {
  default as _makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  useMultiFileAuthState,
  type UserFacingSocketConfig,
  type WAVersion,
} from "@whiskeysockets/baileys";
import { rm } from "fs/promises";
import type { DefineWhatsAppStorage } from "./whatsapp-storage";
import { parseContactId } from "./parse-contact-id";
import https from "https";

type MakeWASocket = typeof _makeWASocket;
export type WASocket = ReturnType<MakeWASocket>;
export const makeWASocket =
  ((_makeWASocket as any)?.default as MakeWASocket) ?? _makeWASocket;

type CustomConfig = Omit<
  UserFacingSocketConfig,
  | "auth"
  | "browser"
  | "version"
  | "generateHighQualityLinkPreview"
  | "shouldIgnoreJid"
>;
type DefineWhatsAppSocketOpts<Device> = CustomConfig & {
  storage: Awaited<DefineWhatsAppStorage<Device>>;
};

export async function defineWhatsAppSocket<Device>(
  deviceId: string,
  opts: DefineWhatsAppSocketOpts<Device>
) {
  const { storage, ...socketConfig } = opts;
  const device = await storage.device.get(deviceId);
  const { state, saveCreds } = await useMultiFileAuthState(
    `.whatsapp/${deviceId}/session`
  );
  // fetch latest version of WA Web
  const { version, isLatest } = await fetchLatestBaileysVersion();
  const manualVersion = [2, 3000, 1025190524] as WAVersion;
  // TODO: create a webhook if whatsapp not latest version
  // console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

  const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // <--- temporarily disable cert validation
  });

  const sock = makeWASocket({
    browser: [
      `${process.env.NUXT_APP_NAME} | ${device.name}`,
      "MacOs",
      "1.0.0",
    ],
    // version: manualVersion,
    version: version,
    // logger: opts.logger,
    // printQRInTerminal: true,
    auth: state,
    // msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    // ignore all broadcast messages -- to receive the same
    // comment the line below out
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    // implement to handle retries & poll updates
    // getMessage,
    //
    fetchAgent: httpsAgent,
    ...socketConfig,
  });

  await storage.socket.set(deviceId, sock);

  // the process function lets you process all events that just occurred
  // efficiently in a batch
  sock.ev.process(
    // events is a map for event name => event data
    async (events) => {
      // something about the connection changed
      // maybe it closed, or we received all offline message or connection opened
      if (events["connection.update"]) {
        await storage.socket.set(deviceId, sock);

        const update = events["connection.update"];
        const { connection, lastDisconnect, qr } = update;

        await storage.socket.onConnectionUpdate(deviceId, update);

        if (connection === "close") {
          const errorOutput = (lastDisconnect?.error as Boom)!.output!;
          const isLoggedOut =
            errorOutput.statusCode === DisconnectReason.loggedOut;
          const isConnectionClosed =
            errorOutput.statusCode === DisconnectReason.connectionClosed;
          const isTimedOut =
            errorOutput.statusCode === DisconnectReason.timedOut;
          const isConnectionFailure = errorOutput.statusCode === 405;
          const isStreamErrored =
            errorOutput.statusCode === DisconnectReason.restartRequired ||
            errorOutput.statusCode === 503;
          const isStreamConflict =
            errorOutput.statusCode === 440 &&
            errorOutput.payload.message.includes("conflict");
          const isConnectionLost =
            errorOutput.statusCode === DisconnectReason.connectionLost &&
            errorOutput.payload.message.includes("lost");
          const isRequestTimeout =
            errorOutput.statusCode === DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("timed out");
          const isQrTimeout =
            errorOutput.statusCode === DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("QR refs");
          const isCantConnectToWhatsAppServer =
            DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("web.whatsapp.com");
          const isWebSocketError =
            DisconnectReason.timedOut &&
            errorOutput.payload.message.includes("WebSocket Error ");
          const isInternalServerError = errorOutput.statusCode === 500;
          // const mustDeleteSession = isConnectionClosed || isLoggedOut
          const mustDeleteSession = isLoggedOut;
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
            isWebSocketError;

          const ignoreError = false;
          const ignoreSendMessage = isQrTimeout;

          if (!ignoreError) {
            if (!ignoreSendMessage) {
              // TODO: Send alert if whatsapp is down
            }

            if (mustDeleteSession) {
              rm(`.whatsapp/${deviceId}/session`, { recursive: true });
            }

            if (mustRestart) {
              defineWhatsAppSocket(deviceId, opts);
            }
          }
        }

        if (connection === "open") {
          const me = sock.authState.creds.me;
          if (me) {
            const { jId, phoneNumber } = parseContactId(me.id);
            const profilePictureUrl = await sock
              .profilePictureUrl(jId)
              .catch(() => "");
            if (profilePictureUrl) {
              me.imgUrl = profilePictureUrl;
            }
            await storage.socket.onWhatsAppConnected(deviceId, me);
          }
        }

        // TODO: create webhook for connection update
        // console.log('connection update', update)
      }

      // credentials updated -- save them
      if (events["creds.update"]) {
        await saveCreds();
      }

      // received a new message
      if (events["messages.upsert"]) {
        const upsert = events["messages.upsert"];

        const m = upsert.messages[0];
        if (!m.message) return; // if there is no text or media message
        if (m.key.fromMe) return;

        const sender = {
          jId: parseContactId(m.key.remoteJid).jId,
          phone: parseContactId(m.key.remoteJid).phoneNumber,
          name: m.verifiedBizName || m.pushName,
        };
        const content: Record<string, unknown> = {};

        const messageType = getContentType(m.message);

        const text =
          m.message.conversation ||
          m.message?.imageMessage?.caption ||
          m.message?.extendedTextMessage?.text;
        if (text) {
          content.text = text;
        }

        // if the message is an image
        if (messageType === "imageMessage") {
          // download the message
          const buffer = await downloadMediaMessage(m, "buffer", {});

          const base64 =
            `data:${m.message?.imageMessage?.mimetype};base64,` +
            buffer.toString("base64");
          const mimetype = m.message?.imageMessage?.mimetype;

          content.image = {
            // base64,
            mimetype,
          };
        }

        if (messageType === "extendedTextMessage") {
          const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const quotedMessageType = getContentType(q);
          const quotedMessage: Record<string, unknown> = {};

          const qText =
            q?.conversation ||
            q?.imageMessage?.caption ||
            q?.extendedTextMessage?.text;
          if (qText) {
            quotedMessage.text = qText;
          }

          content.contextInfo = {
            stanzaId: m.message?.extendedTextMessage?.contextInfo?.stanzaId,
            participant:
              m.message?.extendedTextMessage?.contextInfo?.participant,
            quotedMessageType,
            quotedMessage,
          };
        }

        const data = {
          sender,
          messageType,
          content,
        };

        console.log(`New message from ${sender.name} (${sender.phone})`, data);

        // TODO: create webhook for incoming message
        // console.log('upcomingMessage ', JSON.stringify(m, undefined, 2));
        // console.log('parsedMessage ', JSON.stringify(data, undefined, 2));

        const webhooks =
          (
            (await storage.device.get(deviceId)) as {
              webhooks: Record<string, string>[];
            }
          )?.webhooks || [];
        for (const webhook of webhooks) {
          const isMatch =
            !webhook.match ||
            (webhook.match && typeof webhook.match === "string");

          console.log(
            `Webhook ${webhook.url} match: ${isMatch}`,
            webhook.match
          );
          if (isMatch) {
            if (
              data.content.text &&
              typeof data.content.text === "string" &&
              data.content.text.includes(webhook.match)
            ) {
              let tryCount = 0;
              const sendWebhook = async () => {
                try {
                  await $fetch(webhook.url, {
                    method: "POST",
                    body: JSON.stringify(data),
                  });
                  console.log(`Webhook ${webhook.url} triggered`);
                  tryCount = 0;
                } catch (error) {
                  console.error(
                    `Error triggering webhook ${webhook.url}`,
                    error
                  );
                  tryCount++;
                  if (tryCount < 3) {
                    await sendWebhook();
                  }
                }
              };
              await sendWebhook();
            }
          }
        }
      }
    }
  );

  return sock;
}
