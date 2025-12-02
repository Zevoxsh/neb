console.log("SCRIPT DEMARRE");

const tls = require("tls");

const host = "mail.paxcia.net";
const port = 465;
const username = "proxy@paxcia.net";
const password = "22,anOveS,-";

const b64user = Buffer.from(username).toString("base64");
const b64pass = Buffer.from(password).toString("base64");

console.log("Connexion SSL...");

const socket = tls.connect(
  {
    host,
    port,
    secureProtocol: "TLS_method", // SSL/TLS implicite
    rejectUnauthorized: false,
  },
  () => {
    console.log("Connecté en SSL. Envoi EHLO...");
    socket.write("EHLO test\r\n");
  }
);

socket.setEncoding("utf8");

socket.on("data", (data) => {
  console.log("Réponse du serveur :");
  console.log(data);

  if (data.startsWith("250") && !socket.didStartAuth) {
    socket.didStartAuth = true;
    console.log("Envoi AUTH LOGIN...");
    socket.write("AUTH LOGIN\r\n");
  }

  if (data.includes("VXNlcm5hbWU6")) {
    console.log("Envoi USER...");
    socket.write(b64user + "\r\n");
  }

  if (data.includes("UGFzc3dvcmQ6")) {
    console.log("Envoi PASS...");
    socket.write(b64pass + "\r\n");
  }

  if (data.includes("235")) {
    console.log("AUTH OK");
    socket.end("QUIT\r\n");
  }

  if (data.includes("535")) {
    console.log("AUTH ECHEC");
    socket.end();
  }
});

socket.on("error", (err) => {
  console.log("Erreur connexion :", err);
});

socket.on("end", () => {
  console.log("Connexion fermée");
});
