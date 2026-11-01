import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/security/password.js";
import { pool } from "../src/db.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const username = argValue("--username")?.trim();
const emailArgument = argValue("--email")?.trim();
// Un argument absent ou vide est enregistré comme NULL, pas comme une chaîne vide.
const email = emailArgument || null;

if (!username) {
  console.error("Usage : npm run user:create -- --username identifiant [--email adresse@example.com]");
  process.exitCode = 1;
} else {
  try {
    if (username.length > 100 || (email !== null && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
      throw new Error("Identifiant ou adresse e-mail invalide.");
    }

    // Mot de passe aléatoire généré localement, affiché une seule fois à l'administrateur.
    const password = randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO public.app_users (username, email, password_hash, role)
       VALUES ($1, $2, $3, CASE WHEN lower($1) = 'admin' THEN 'admin' ELSE 'user' END)
       RETURNING user_id, username, email, role`,
      [username, email, passwordHash]
    );
    console.log("Compte créé. Transmets ce mot de passe à son destinataire par un canal privé :\n");
    console.log(`Identifiant : ${result.rows[0].username}`);
    console.log(`E-mail : ${result.rows[0].email ?? "non renseigné"}`);
    console.log(`Rôle : ${result.rows[0].role === "admin" ? "administrateur" : "utilisateur"}`);
    console.log(`Mot de passe initial : ${password}`);
    console.log("\nCe mot de passe ne sera pas réaffiché par la commande.");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      console.error("Impossible de créer le compte : cet identifiant ou cette adresse e-mail existe déjà.");
    } else {
      console.error("Échec de création du compte :", error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
