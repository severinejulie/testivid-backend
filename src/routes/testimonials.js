const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");

router.get("/", authMiddleware, (req, res) => {
  res.json({ message: "Testimonials route working!" });
});

module.exports = router;
