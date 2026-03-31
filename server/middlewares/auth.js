const jwt = require("jsonwebtoken");
const pool = require("../db"); // ajuste o caminho se seu auth.js estiver em outra pasta

function authRequired(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente." });
  }

  const token = header.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // aqui é só o payload do token
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

async function loadUser(req, res, next) {
  try {
    // precisa do id vindo do token
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Token sem id." });

    const { rows } = await pool.query(
      "SELECT id, email, role, company_id FROM users WHERE id = $1",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Usuário não encontrado." });
    }

    // substitui o payload por dados do banco (fonte da verdade)
    req.user = rows[0];

    return next();
  } catch (err) {
    return res.status(500).json({ error: "Erro ao carregar usuário." });
  }
}

module.exports = { authRequired, loadUser };