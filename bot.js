import NodeCache from 'node-cache'
import makeWASocket, { delay, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState, isJidBroadcast } from '@whiskeysockets/baileys'
import { pino } from 'pino'

const logger = pino({})
logger.level = 'error'

const msgRetryCounterCache = new NodeCache({ stdTTL: 30, checkperiod: 30, useClones: false })

// start a connection
const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    const sock = makeWASocket.default({
        version,
        logger,
        printQRInTerminal: true,
        mobile: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    })

    const sendMessageWTyping = async (msg, jid) => {
        await sock.presenceSubscribe(jid)
        await delay(500)

        await sock.sendPresenceUpdate('composing', jid)
        await delay(2000)

        await sock.sendPresenceUpdate('paused', jid)

        await sock.sendMessage(jid, msg)
    }


    sock.ev.process(
        async (events) => {

            if (events['connection.update']) {
                const update = events['connection.update']
                const { connection, lastDisconnect } = update
                if (connection === 'close') {
                    // reconnect if not logged out
                    if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                        startSock()
                    } else {
                        console.log('Connection closed. You are logged out.')
                    }
                }

                console.log('connection update', update)
            }

            if (events['creds.update']) {
                await saveCreds()
            }

            if (events.call) {
                console.log('recv call event', events.call)
            }

            if (events['messages.upsert']) {
                const upsert = events['messages.upsert']
                console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

                if (upsert.type === 'notify') {
                    for (const msg of upsert.messages) {
                        if (!msg.key.fromMe && doReplies) {
                            console.log('replying to', msg.key.remoteJid)
                            await sock.readMessages([msg.key])
                            await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid)
                        }
                    }
                }
            }
        }
    )

    return sock
}

startSock()