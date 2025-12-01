const tls = require("tls");

const host = "mail.paxcia.net";
const port = 465;
const username = "proxy@paxcia.net";
const password = "22,anOveS,-";

const b64user = Buffer.from(username).toString("base64");
const b64pass = Buffer.from(password).toString("base64");

const socket = tls.connect(
  {
    host,
    port,
    rejectUnauthorized: false
  },
  () => {
    console.log("🔗 Connecté au serveur, envoi EHLO...");
    socket.write("EHLO test\r\n");
  }
);

socket.setEncoding("utf8");

socket.on("data", (data) => {
  console.log("📨 Réponse du serveur :\n", data);

  // Serveur renvoie 250 après EHLO → on lance AUTH LOGIN une seule fois
  if (data.startsWith("250") && !socket.didStartAuth) {
    socket.didStartAuth = true;
    console.log("➡️  Envoi AUTH LOGIN...");
    socket.write("AUTH LOGIN\r\n");
  }

  if (data.includes("VXNlcm5hbWU6")) {
    console.log("➡️  Envoi login...");
    socket.write(b64user + "\r\n");
  }

  if (data.includes("UGFzc3dvcmQ6")) {
    console.log("➡️  Envoi mot de passe...");
    socket.write(b64pass + "\r\n");
  }

  if (data.includes("235")) {
    console.log("✅ Authentification réussie !");
    socket.end("QUIT\r\n");
  }

  if (data.includes("535")) {
    console.log("❌ Échec authentification !");
    socket.end();
  }
});

socket.on("error", (err) => {
  console.error("❌ Erreur connexion :", err.message);
});

socket.on("end", () => {
  console.log("🔌 Connexion fermée");
});
