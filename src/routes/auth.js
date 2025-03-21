const express = require("express");
const supabase = require("../config/supabase");
const router = express.Router();

router.post("/signup", async (req, res) => {
  const { firstname, lastname, email, password, companyName, fromGoogle, accessToken } = req.body;

  try {
    // If it's a Google sign-up, forward to the dedicated handler
    if (fromGoogle) {
      // Forward to the Google sign-up handler
      return await signupGoogleHandler(req, res);
    }

    // Regular email/password signup flow
    // Step 1: Sign up the user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // Step 2: Create a new company record
    const { data: companyData, error: companyError } = await supabase
      .from("company")
      .insert([{ name: companyName }])
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
        firstname: firstname,
        lastname: lastname,
        password_hash: "", // Supabase Auth handles passwords securely
        company_id: companyData.id
      }
    ]);

    if (userError) {
      return res.status(400).json({ error: "Failed to create user: " + userError.message });
    }
    let message = "Signup successful! Check your email for confirmation.";

    if(fromGoogle) {
      message = "";
    }
    
    res.json({
      message: message,
      user: authData.user,
      company: companyData,
    });

  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Helper function to handle Google sign-ups
async function signupGoogleHandler(req, res) {
  const { firstname, lastname, email, companyName, accessToken  } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: "Access token is required for Google signup" });
  }

  // Get the current authenticated user
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return res.status(401).json({ error: "Not authenticated or session expired" });
  }

  try {
    // Create a new company record
    const { data: companyData, error: companyError } = await supabase
      .from("company")
      .insert([{ name: companyName }])
      .select()
      .single();

    if (companyError) {
      return res.status(400).json({ error: "Failed to create company: " + companyError.message });
    }

    // Create a new user record in the database with the company_id
    const { error: userError } = await supabase.from("user").insert([
      {
        id: authData.user.id,
        email: email,
        firstname: firstname,
        lastname: lastname,
        password_hash: "", // Google users don't need a password
        company_id: companyData.id,
        auth_provider: "google"
      }
    ]);

    if (userError) {
      return res.status(400).json({ error: "Failed to create user: " + userError.message });
    }

    res.json({
      message: "Google signup successful!",
      user: authData.user,
      company: companyData,
    });
  } catch (error) {
    console.error("Google Signup Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

router.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  // Step 1: Authenticate the user
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

  if (authError) {
    // Check for common authentication errors
    if (authError.message.includes("Invalid login credentials")) {
      return res.status(400).json({ error: "Incorrect email or password." });
    }
    return res.status(400).json({ error: authError.message });
  }

  // Step 2: Check if user is verified
  if (!authData.user.email_confirmed_at) {
    return res.status(400).json({ error: "Please verify your email before signing in." });
  }

  // Step 3: Get user ID from Supabase Auth
  const userId = authData.user.id;

  // Step 4: Fetch the associated user record from the database
  const { data: userRecord, error: userError } = await supabase
    .from("user")
    .select("*")
    .eq("email", email)
    .single();

  if (userError) return res.status(400).json({ error: "User not found: " + userError.message });

  // Step 5: Return the token and user data
  res.json({
    message: "Login successful!",
    token: authData.session.access_token,
    user: userRecord,
  });
});



router.post("/signout", async (req, res) => {
  const { error } = await supabase.auth.signOut();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Logged out successfully!" });
});

router.post("/signin-google", async (req, res) => {
  const { provider } = req.body;

  const { data, error } = await supabase.auth.signInWithOAuth({ 
    provider,
    options: {
      redirectTo: 'http://localhost:3000/auth/callback',
      queryParams: {
        prompt: 'select_account'  // This forces Google to show the account selection screen
      }
    }
  });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ url: data.url });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`, // Ensure this is set correctly
    });

    if (error) {
      return res.status(400).json({ error: "Failed to send reset email: " + error.message });
    }

    res.json({ message: "Password reset email sent. Check your inbox!" });

  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { access_token, new_password } = req.body;

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: access_token,
      refresh_token: access_token, 
    });

    if (sessionError) {
      return res.status(400).json({ error: "Failed to authenticate reset session: " + sessionError.message });
    }

    const { data, error } = await supabase.auth.updateUser({
      password: new_password
    });

    if (error) {
      return res.status(400).json({ error: "Failed to reset password: " + error.message });
    }

    res.json({ message: "Password has been reset successfully. You can now log in." });

  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/signup-google", async (req, res) => {
  const { email, firstname, lastname, companyName } = req.body;

  // Get user data from Supabase auth (user should already be authenticated with Google)
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return res.status(401).json({ error: "Not authenticated or session expired" });
  }

  // User is authenticated with Google, now we can create the company and user records
  try {
    // Step 1: Create a new company record
    const { data: companyData, error: companyError } = await supabase
      .from("company")
      .insert([{ name: companyName }])
      .select()
      .single();

    if (companyError) {
      return res.status(400).json({ error: "Failed to create company: " + companyError.message });
    }

    // Step 2: Create a new user record in the database with the company_id
    const { error: userError } = await supabase.from("user").insert([
      {
        id: authData.user.id, // Use the Supabase Auth user ID
        email: email,
        firstname: firstname,
        lastname: lastname,
        password_hash: "", // Google users don't need a password
        company_id: companyData.id, // Link user to the company
        auth_provider: "google"
      }
    ]);

    if (userError) {
      return res.status(400).json({ error: "Failed to create user: " + userError.message });
    }

    res.json({
      message: "Google signup successful!",
      user: authData.user,
      company: companyData,
    });

  } catch (error) {
    console.error("Google Signup Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/process-auth-callback", async (req, res) => {
  const { hashParams, authAction, accessToken } = req.body;
  try {
    if (!accessToken) {
      return res.status(400).json({ error: "No access token provided" });
    }
    
    // Get user from the provided token
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    const user = data.user;
    const { user_metadata } = user;
    
    // Get user details if they exist in your database
    const { data: userData, error: userError } = await supabase
      .from('user')
      .select('*')
      .eq('id', user.id)
      .single();
    
    // Prepare response with user data
    const responseData = {
      user: {
        id: user.id,
        email: user.email,
        firstname: user_metadata?.name?.split(' ')[0] || '',
        lastname: user_metadata?.name?.split(' ').slice(1).join(' ') || '',
        avatar_url: user_metadata?.picture || '',
        ...(userData || {})
      },
      token: accessToken 
    };
    
    res.json(responseData);
  } catch (error) {
    console.error("Auth callback processing error:", error);
    res.status(500).json({ error: "Failed to process authentication" });
  }
});

module.exports = router;
