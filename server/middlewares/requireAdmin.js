afunction requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso negado: somente admin" });
  }

  next();
}

module.exports = { requireAdmin };