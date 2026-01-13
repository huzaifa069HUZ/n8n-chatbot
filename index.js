import makeWASocket, {
  DisconnectReason,
  // useMultiFileAuthState, // REMOVED: This causes daily logouts
  fetchLatestWaWebVersion
} from "@whiskeysockets/baileys"

import { usePostgreSQLAuthState } from "postgres-baileys" // ADDED: Required for database storage
import axios from "axios"
import P from "pino"
import express from "express"
import qrcode from "qrcode"

// 🔴 Webhook URL for n8n
const WEBHOOK_URL = "https://n8n-latest-yecs.onrender.com/webhook/whatsapp_baileys_only_2025"

// ✅ Render-safe port
const PORT = process.env.PORT || 3000

let qrCodeString = null

// ---------------- EXPRESS SERVER ----------------
const app = express()

app.get("/", (req, res) => {
  res.send("WhatsApp bot is running")
})

app.get("/health", (req, res) => {
  res.send("ok")
})

app.get("/qr", async (req, res) => {
  if (!qrCodeString) {
    return res.send("QR not generated yet or already connected.")
  }

  const qrImage = await qrcode.toDataURL(qrCodeString, { scale: 10 })

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp QR</title>
      <style>
        body { 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          justify-content: center; 
          height: 100vh; 
          font-family: Arial;
        }
      </style>
    </head>
    <body>
      <h2>Scan WhatsApp QR</h2>
      <img src="${qrImage}" />
      <p>WhatsApp → Linked Devices → Link a Device</p>
    </body>
    </html>
  `)
})

app.listen(PORT, () => {
  console.log("🌐 Server running on port", PORT)
})
// ------------------------------------------------


// ---------------- DATABASE CONFIG ----------------
// 🔴 HARDCODED DATABASE DETAILS
const dbConfig = {
  host: "aws-1-ap-northeast-2.pooler.supabase.com", // YOUR HOST (Always use quotes)
  port: 5432,                                     // Numbers do NOT need quotes
  user: "postgres.uyjbtpgariajlwsjlheg",                               // REPLACE with your Supabase user
  password: "huzaifa786ASHIKA",                 // REPLACE with your Supabase password
  database: "postgres",                           // REPLACE with your Supabase DB name
  ssl: { rejectUnauthorized: false }              // Required for Supabase/Render
}
// ------------------------------------------------


// ---------------- WHATSAPP BOT ------------------
async function startBot() {
  // CHANGED: Uses hardcoded Postgres config instead of a local folder
  // "whatsapp-session-v1" is the unique ID for this session in your DB
  const { state, saveCreds } = await usePostgreSQLAuthState(dbConfig, "whatsapp-session-v1")
  const { version } = await fetchLatestWaWebVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    qrMethod: "qr"
  })

  // Saves login credentials to your Supabase database automatically
  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      qrCodeString = qr
      console.log("➡️ New QR generated. Open /qr on your Render app URL.")
    }

    if (connection === "open") {
      qrCodeString = null
      console.log("✅ WhatsApp connected")
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      console.log("❌ Connection closed. Reconnect:", shouldReconnect)

      if (shouldReconnect) startBot()
    }
  })

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

      if (reply) {
        await sock.sendMessage(from, { text: reply })
      }
    } catch (err) {
      console.error("❌ n8n error:", err.message)
    }
  })
}

startBot()
// ------------------------------------------------