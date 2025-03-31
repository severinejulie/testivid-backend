// middleware/auth.js
const supabase = require('../config/supabase');

/**
 * Authentication middleware for protected routes
 * Validates the JWT token from the Authorization header
 */
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
 
    // Get user details from your users table
    const { data: userData, error: userError } = await supabase
      .from('user')
      .select('*, company_id')
      .eq('id', user.id)
      .single();
    
    if (userError || !userData) {
      return res.status(401).json({ error: 'Unauthorized - User not found' });
    }
    
    // Add user data to request object
    req.user = userData;
    
    // Continue to the protected route
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = auth;