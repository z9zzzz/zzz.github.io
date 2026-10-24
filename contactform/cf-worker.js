// Cloudflare Worker — contact form → Telegram
// Site: https://zzz.is-a.dev

const BOT_TOKEN = "7775338797:AAHrk5r44ZYQ2Js8SiOxDwtM0FollECvFHg";
const USER_ID = "1985661120";
const SITE_URL = "https://zzz.is-a.dev";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

/** Escape text for Telegram HTML parse_mode */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Clamp + trim user input */
function clean(v, max = 2000) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Root GET → redirect to site
  if (request.method === "GET" && url.pathname === "/") {
    return Response.redirect(SITE_URL, 301);
  }

  // Only POST for the form
  if (request.method !== "POST") {
    return json({ status: false, msg: "Method not allowed" }, 405);
  }

  // Parse body safely
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: false, msg: "Invalid JSON body" }, 400);
  }

  const name = clean(body.name, 100);
  const subject = clean(body.subject, 200);
  const message = clean(body.message, 4000);

  if (!name || !subject || !message) {
    return json({ status: false, msg: "All fields are required" }, 400);
  }

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  const text =
    `<b>New Contact Request</b>\n\n` +
    `<b>IP:</b> <code>${esc(ip)}</code>\n` +
    `<b>Name:</b> <code>${esc(name)}</code>\n` +
    `<b>Subject:</b> <code>${esc(subject)}</code>\n` +
    `<b>Message:</b>\n<code>${esc(message)}</code>`;

  try {
    const tg = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: USER_ID,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    const result = await tg.json();

    if (result.ok) {
      return json({ status: true, msg: "Message sent successfully" });
    }

    console.error("Telegram error:", result);
    return json({ status: false, msg: "Error while sending the message" }, 502);
  } catch (err) {
    console.error("Fetch error:", err);
    return json({ status: false, msg: "Error while sending the message" }, 502);
  }
}