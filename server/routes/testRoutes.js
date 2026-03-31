const express = require("express");
const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");

const router = express.Router();

router.get("/me", authRequired, loadUser, (req, res) => {
  res.json(req.user);
});

router.get("/admin-test", authRequired, loadUser, requireRole("admin"), (req, res) => {
  res.json({ ok: true, message: "Você é admin", user: req.user.email });
});

module.exports = router;