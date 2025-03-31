// routes/publicApi.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

/**
 * Validate testimonial token and get questions
 * GET /api/public/testimonial/validate/:token
 */
router.get('/testimonial/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Get testimonial by token
    const { data: testimonial, error } = await supabase
      .from('testimonial')
      .select(`
        id,
        status,
        expires_at,
        company:company_id(id, name, logo_url)
      `)
      .eq('access_token', token)
      .single();
    
    if (error || !testimonial) {
      return res.status(404).json({ error: 'Invalid testimonial token' });
    }
    
    // Check if testimonial is still pending
    if (testimonial.status !== 'pending') {
      return res.status(400).json({ 
        error: 'This testimonial has already been submitted or expired',
        status: testimonial.status
      });
    }
    
    // Check if testimonial has expired
    const expiryDate = new Date(testimonial.expires_at);
    if (expiryDate < new Date()) {
      return res.status(400).json({ error: 'This testimonial request has expired' });
    }
    
    // Get questions for this testimonial
    const { data: testimonialResponses, error: responsesError } = await supabase
      .from('testimonial_responses')
      .select(`
        id,
        question_id,
        question:question_id(id, text)
      `)
      .eq('testimonial_id', testimonial.id);
    
    if (responsesError) {
      console.error('Error fetching testimonial questions:', responsesError);
      return res.status(500).json({ error: 'Failed to fetch questions' });
    }
    
    // Format questions for the response
    const questions = testimonialResponses.map(tr => ({
      id: tr.question_id,
      text: tr.question.text
    }));
    
    return res.json({
      valid: true,
      testimonial: {
        id: testimonial.id,
        company: testimonial.company,
        expiresAt: testimonial.expires_at
      },
      questions
    });
  } catch (error) {
    console.error('Error validating testimonial token:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Submit testimonial responses
 * POST /api/public/testimonial/submit/:token
 */
router.post('/testimonial/submit/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { responses } = req.body;
    
    if (!responses || !Array.isArray(responses)) {
      return res.status(400).json({ error: 'Invalid response format' });
    }
    
    // Get testimonial by token
    const { data: testimonial, error: testimonialError } = await supabase
      .from('testimonial')
      .select('id, status, expires_at')
      .eq('access_token', token)
      .eq('status', 'pending')
      .single();
    
    if (testimonialError || !testimonial) {
      return res.status(404).json({ error: 'Invalid or expired testimonial link' });
    }
    
    // Check if testimonial has expired
    const expiryDate = new Date(testimonial.expires_at);
    if (expiryDate < new Date()) {
      return res.status(400).json({ error: 'This testimonial request has expired' });
    }
    
    // Get testimonial responses to update
    const { data: existingResponses, error: responsesError } = await supabase
      .from('testimonial_responses')
      .select('id, question_id')
      .eq('testimonial_id', testimonial.id);
    
    if (responsesError) {
      console.error('Error fetching responses:', responsesError);
      return res.status(500).json({ error: 'Failed to process submission' });
    }
    
    // Update responses
    for (const response of responses) {
      if (!response.question_id || !response.answer) continue;
      
      const matchingResponse = existingResponses.find(r => r.question_id === response.question_id);
      
      if (matchingResponse) {
        const { error: updateError } = await supabase
          .from('testimonial_responses')
          .update({
            response: response.answer,
            video_url: response.video_url || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', matchingResponse.id);
        
        if (updateError) {
          console.error('Error updating response:', updateError);
          return res.status(500).json({ error: 'Failed to save responses' });
        }
      }
    }
    
    // Update testimonial status to completed
    const { error: updateError } = await supabase
      .from('testimonial')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', testimonial.id);
    
    if (updateError) {
      console.error('Error updating testimonial status:', updateError);
      return res.status(500).json({ error: 'Failed to update testimonial status' });
    }
    
    return res.status(200).json({
      message: 'Thank you! Your testimonial has been submitted successfully.'
    });
  } catch (error) {
    console.error('Error submitting testimonial:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;