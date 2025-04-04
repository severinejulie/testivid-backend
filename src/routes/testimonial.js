// routes/testimonial.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { sendTestimonialRequest, sendReminderEmail, sendTestTestimonialRequest } = require('../services/mailgun');
const auth = require('../middleware/auth');

/**
 * Create a new testimonial request
 * POST /api/testimonials/request
 */
router.post('/request', auth, async (req, res) => {
  try {
    const {
      customer_email,
      customer_name,
      question_ids,
      expires_days = 30
    } = req.body;

    if (!customer_email || !customer_name || !question_ids || !question_ids.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const company_id = req.user.company_id;

    // Generate unique access token
    const access_token = uuidv4();
    
    // Calculate expiration date
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + parseInt(expires_days));

    // Create testimonial record
    const { data: testimonial, error: testimonialError } = await supabase
      .from('testimonial')
      .insert({
        company_id,
        customer_email,
        status: 'pending',
        access_token,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: expires_at.toISOString()
      })
      .select()
      .single();

    if (testimonialError) {
      console.error('Error creating testimonial:', testimonialError);
      return res.status(500).json({ error: 'Failed to create testimonial request' });
    }

    // Get questions
    const { data: questions, error: questionsError } = await supabase
      .from('question')
      .select('id, text')
      .in('id', question_ids);

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return res.status(500).json({ error: 'Failed to fetch questions' });
    }

    // Store testimonial responses placeholders
    const testimonialResponses = [];
    for (const question of questions) {
      testimonialResponses.push({
        testimonial_id: testimonial.id,
        question_id: question.id,
        video_url: "",
        created_at: new Date().toISOString()
      });
    }

    const { error: responsesError } = await supabase
      .from('testimonial_responses')
      .insert(testimonialResponses);

    if (responsesError) {
      console.error('Error creating response placeholders:', responsesError);
      return res.status(500).json({ error: 'Failed to create response placeholders' });
    }

    // Get company info
    const { data: companyData, error: companyError } = await supabase
      .from('company')
      .select('name')
      .eq('id', company_id)
      .single();

    if (companyError) {
      console.error('Error fetching company:', companyError);
      return res.status(500).json({ error: 'Failed to fetch company details' });
    }

    // Generate submission URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const submissionUrl = `${baseUrl}/testimonial/submit/${access_token}`;

    // Send email
    const emailResult = await sendTestTestimonialRequest({
      to: customer_email,
      customerName: customer_name,
      companyName: companyData.name,
      submissionUrl,
      senderName: req.user.firstname
    });

    if (!emailResult.success) {
      return res.status(500).json({ error: 'Failed to send email', details: emailResult.error });
    }

    // Record email history
    const { error: emailHistoryError } = await supabase
      .from('email_history')
      .insert({
        testimonial_id: testimonial.id,
        email_type: 'initial',
        sent_at: new Date().toISOString(),
        status: 'sent',
        email_id: emailResult.messageId
      });

    if (emailHistoryError) {
      console.error('Error recording email history:', emailHistoryError);
    }

    // Return success with testimonial details
    return res.status(201).json({
      message: 'Testimonial request created and email sent',
      testimonial: {
        id: testimonial.id,
        status: testimonial.status,
        submission_url: submissionUrl,
        expires_at: testimonial.expires_at
      }
    });
  } catch (error) {
    console.error('Error in testimonial request:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Get all testimonial requests for a company
 * GET /api/testimonials/requests
 */
router.get('/requests', auth, async (req, res) => {
  try {
    const company_id = req.user.company_id;
    
    const { status } = req.query;

    let query = supabase
      .from('testimonial')
      .select(`
        *,
        email_history(*)
      `)
      .eq('company_id', company_id)
      .order('created_at', { ascending: false }); // no range/limit anymore
    
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching testimonials:', error);
      return res.status(500).json({ error: 'Failed to fetch testimonial requests' });
    }

    // Just return the array directly
    return res.json(data);
  } catch (error) {
    console.error('Error in getting testimonials:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});



/**
 * Get a single testimonial request
 * GET /api/testimonials/request/:id
 */
router.get('/request/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    
    const { data: testimonial, error } = await supabase
      .from('testimonial')
      .select(`
        *,
        email_history(*),
        testimonial_responses(
          *,
          question(*)
        )
      `)
      .eq('id', id)
      .eq('company_id', company_id)
      .single();
    
    if (error) {
      console.error('Error fetching testimonial:', error);
      return res.status(404).json({ error: 'Testimonial not found' });
    }
    
    return res.json(testimonial);
  } catch (error) {
    console.error('Error in getting testimonial:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Send reminder for a pending testimonial
 * POST /api/testimonials/request/:id/remind
 */
router.post('/request/:id/remind', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    
    // Get testimonial data
    const { data: testimonial, error } = await supabase
      .from('testimonial')
      .select('*, email_history(*)')
      .eq('id', id)
      .eq('company_id', company_id)
      .eq('status', 'pending')
      .single();
    
    if (error) {
      console.error('Error fetching testimonial:', error);
      return res.status(404).json({ error: 'Pending testimonial not found' });
    }
    
    // Get company info
    const { data: companyData, error: companyError } = await supabase
      .from('company')
      .select('name')
      .eq('id', company_id)
      .single();
    
    if (companyError) {
      console.error('Error fetching company:', companyError);
      return res.status(500).json({ error: 'Failed to fetch company details' });
    }
    
    // Calculate reminder count
    const reminderCount = testimonial.email_history.filter(e => e.email_type === 'reminder').length + 1;
    
    // Generate submission URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const submissionUrl = `${baseUrl}/testimonial/submit/${testimonial.access_token}`;
    
    // Send reminder email
    const emailResult = await sendReminderEmail({
      to: testimonial.customer_email,
      customerName: req.body.customer_name || 'Valued Customer',
      companyName: companyData.name,
      submissionUrl,
      reminderCount
    });
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'Failed to send reminder email', details: emailResult.error });
    }
    
    // Record email history
    const { error: emailHistoryError } = await supabase
      .from('email_history')
      .insert({
        testimonial_id: testimonial.id,
        email_type: 'reminder',
        sent_at: new Date().toISOString(),
        status: 'sent',
        email_id: emailResult.messageId
      });
    
    if (emailHistoryError) {
      console.error('Error recording email history:', emailHistoryError);
    }
    
    // Update last_reminder_sent in testimonial
    const { error: updateError } = await supabase
      .from('testimonial')
      .update({
        last_reminder_sent: new Date().toISOString(),
        reminder_count: reminderCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    
    if (updateError) {
      console.error('Error updating testimonial:', updateError);
    }
    
    return res.json({
      message: 'Reminder sent successfully',
      reminderCount
    });
  } catch (error) {
    console.error('Error sending reminder:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Cancel a testimonial request
 * POST /api/testimonials/request/:id/cancel
 */
router.post('/request/:id/cancel', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;
    
    // Update testimonial status
    const { data, error } = await supabase
      .from('testimonial')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('company_id', company_id)
      .select()
      .single();
    
    if (error) {
      console.error('Error cancelling testimonial:', error);
      return res.status(404).json({ error: 'Testimonial not found or already completed' });
    }
    
    return res.json({
      message: 'Testimonial request cancelled successfully',
      testimonial: data
    });
  } catch (error) {
    console.error('Error cancelling testimonial:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Public endpoint to submit a testimonial
 * POST /api/testimonials/submit/:token
 * (No auth middleware as this is accessed by customers)
 */

router.post('/submit/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { responses } = req.body;
    
    if (!responses || !Array.isArray(responses)) {
      return res.status(400).json({ error: 'Invalid response format' });
    }
    
    // Get testimonial by access token
    const { data: testimonial, error: testimonialError } = await supabase
      .from('testimonial')
      .select('*')
      .eq('access_token', token)
      .eq('status', 'pending')
      .single();
    
    if (testimonialError || !testimonial) {
      return res.status(404).json({ 
        error: 'Invalid or expired testimonial link' 
      });
    }
    
    // Check if testimonial has expired
    const expiryDate = new Date(testimonial.expires_at);
    if (expiryDate < new Date()) {
      return res.status(400).json({ error: 'This testimonial request has expired' });
    }
    
    // Get testimonial responses to update
    const { data: existingResponses, error: responsesError } = await supabase
      .from('testimonial_responses')
      .select('*')
      .eq('testimonial_id', testimonial.id);
    
    if (responsesError) {
      console.error('Error fetching responses:', responsesError);
      return res.status(500).json({ error: 'Failed to process submission' });
    }
    
    // Update responses
    for (const response of responses) {
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
      message: 'Testimonial submitted successfully',
      testimonialId: testimonial.id
    });
  } catch (error) {
    console.error('Error submitting testimonial:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Webhook handler for Mailgun events
 * POST /api/testimonials/webhook/mailgun
 */
router.post('/webhook/mailgun', async (req, res) => {
  try {
    const event = req.body;
    
    // Verify the event is from Mailgun (implement proper verification)
    // This is a simplified example
    if (!event || !event['event-data'] || !event['event-data'].event) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    
    const eventData = event['event-data'];
    const eventType = eventData.event; // delivered, opened, clicked, etc.
    const messageId = eventData.message.headers['message-id'];
    
    if (!messageId) {
      return res.status(400).json({ error: 'Missing message ID' });
    }
    
    // Find the email record
    const { data: emailRecord, error } = await supabase
      .from('email_history')
      .select('*')
      .eq('email_id', messageId)
      .single();
    
    if (error || !emailRecord) {
      console.log('Email record not found for message ID:', messageId);
      return res.status(200).json({ status: 'Event received but no matching record' });
    }
    
    // Update the email status
    const { error: updateError } = await supabase
      .from('email_history')
      .update({
        status: eventType,
        updated_at: new Date().toISOString()
      })
      .eq('id', emailRecord.id);
    
    if (updateError) {
      console.error('Error updating email status:', updateError);
    }
    
    return res.status(200).json({ status: 'Event processed successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;