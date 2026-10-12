import { pool, migrate, rows, write } from "./db/index.js";
import { email, text } from "./domain.js";
import { passwordHash } from "./security.js";
try {
  await migrate();
  const address = email(process.env.OWNER_EMAIL),
    password = process.env.OWNER_PASSWORD;
  if (!password) throw new Error("Definí OWNER_PASSWORD en el entorno.");
  if ((await rows("SELECT id FROM users WHERE email=?", [address])).length)
    throw new Error(
      "La cuenta ya existe. No se modificaron sus permisos ni contraseña.",
    );
  await write(
    "INSERT INTO users(email,name,password_hash,super_admin) VALUES (?,?,?,1)",
    [
      address,
      text(process.env.OWNER_NAME ?? "Administrador de AulaNexo", "Nombre"),
      await passwordHash(password),
    ],
  );
  console.log(
    "Cuenta de superadministrador creada. Usá OWNER_EMAIL y OWNER_PASSWORD del entorno para ingresar.",
  );
} finally {
  await pool.end();
}
