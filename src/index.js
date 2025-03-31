require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { initScheduledJobs } = require('./jobs/reminderScheduler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/testimonials", require("./routes/testimonial"));
app.use("/api/questions", require("./routes/question"));

// app.post('/api/testimonials/webhook/mailgun', (req, res, next) => {
//     // In production, verify Mailgun webhook signature here
//     // See: https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
//     next();
// });

if (process.env.ENABLE_SCHEDULED_TASKS === 'true') {
initScheduledJobs();
}

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
