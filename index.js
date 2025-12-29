import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion
} from "@whiskeysockets/baileys"

import axios from "axios"
import P from "pino"
import express from "express" // ⬅️ NEW: Used to run a simple web server
import qrcode from "qrcode" // ⬅️ NEW: Used to convert the QR string into an image

// 🔴 CHANGE THIS ONLY
const WEBHOOK_URL = "https://amik06.app.n8n.cloud/webhook/whatsapp_baileys_only_2025"
// 🔴 NEW: Set the port for the QR server
const PORT = 3000
const QR_SERVER_URL = `http://localhost:${PORT}`

// Create a variable to hold the QR code string
let qrCodeString = null 

// --- QR Code Server Setup ---
const app = express()

// Route to display the QR code image
app.get("/qr", async (req, res) => {
    if (qrCodeString) {
        // Convert the QR code string to a data URL (PNG image)
        const qrImage = await qrcode.toDataURL(qrCodeString, { scale: 10 })
        
        // Render a simple HTML page to display the image
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Bot QR Code</title>
                <style>body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }</style>
            </head>
            <body>
                <h1>Scan This QR Code</h1>
                <p>Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                <img src="${qrImage}" alt="QR Code">
            </body>
            </html>
        `)
    } else {
        res.send("QR Code is not yet generated or the bot is already connected.")
    }
})

app.listen(PORT, () => {
    console.log(`\n🌐 QR Server running at ${QR_SERVER_URL}`)
    console.log("Waiting for WhatsApp connection...")
})
// -----------------------------


async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const { version, isLatest } = await fetchLatestWaWebVersion()
  console.log(`Using WA Web v${version.join('.')}, isLatest: ${isLatest}`)

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    // ⬇️ NEW: Use the 'qr' connection option to receive the QR string
    qrMethod: "qr" 
  })

  // ✅ AUTH SAVE
  sock.ev.on("creds.update", saveCreds)

  // ✅ CONNECTION STATUS
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update

    // 🌟 MANUAL QR CODE HANDLING 🌟
    if (qr) {
        qrCodeString = qr // Save the QR code string to the global variable
        console.log(`\n➡️ NEW QR CODE generated. Open this URL in your browser: ${QR_SERVER_URL}/qr\n`)
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected. You can close the browser page now.")
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      
      console.log("❌ Connection closed. Reconnect:", shouldReconnect)
      if (shouldReconnect) startBot()
    }
  })

  // ✅ MESSAGE LISTENER (no change)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return

    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const name = msg.pushName || "User"

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ""

    if (!text) return

    console.log(`📩 MESSAGE RECEIVED: ${from} -> ${text}`)

    try {
      const response = await axios.post(WEBHOOK_URL, {
        from,
        message: text,
        name
      })

      const reply =
        typeof response.data === "string"
          ? response.data
          : response.data?.reply

      console.log("🧠 n8n reply:", reply)

      if (reply) {
        await sock.sendMessage(from, { text: reply })
        console.log("✅ Reply sent to WhatsApp")
      }
    } catch (err) {
      console.error("❌ Error sending to n8n:", err.message)
    }
  })
}


startBot()