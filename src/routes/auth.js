const express = require("express");
const supabase = require("../config/supabase");
const router = express.Router();

router.post("/signup", async (req, res) => {
  const { email, password, company_name } = req.body;

  try {
    // Step 1: Sign up the user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // Step 2: Create a new company record
    const { data: companyData, error: companyError } = await supabase
      .from("company")
      .insert([{ name: company_name }])
      .select()
      .single();

    if (companyError) {
      return res.status(400).json({ error: "Failed to create company: " + companyError.message });
    }

    // Step 3: Create a new user record in the database with the company_id
    const { error: userError } = await supabase.from("user").insert([
      {
        id: authData.user.id, // Use the Supabase Auth user ID
        email: email,
        password_hash: "", // Supabase Auth handles passwords securely
        company_id: companyData.id, // Link user to the company
      }
    ]);

    if (userError) {
      return res.status(400).json({ error: "Failed to create user: " + userError.message });
    }

    res.json({
      message: "Signup successful! Check your email for confirmation.",
      user: authData.user,
      company: companyData,
    });

  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Login successful!", token: data.session.access_token });
});

router.post("/signout", async (req, res) => {
  const { error } = await supabase.auth.signOut();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Logged out successfully!" });
});

router.post("/signin-google", async (req, res) => {
  const { provider } = req.body;

  const { data, error } = await supabase.auth.signInWithOAuth({ provider });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ url: data.url });
});

module.exports = router;
