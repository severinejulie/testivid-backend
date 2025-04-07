// routes/publicApi.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ storage: multer.memoryStorage() });

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

router.post("/testimonial/save", upload.array("videos"), async (req, res) => {
  try {
    console.log("------ DEBUG: Received testimonial/save request ------");
    console.log("DEBUG: Files received:", req.files ? req.files.length : 0);
    console.log("DEBUG: Request body keys:", Object.keys(req.body));

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No videos uploaded" });
    }

    const { token, testimonialId, name, title } = req.body;

    if (!token || !testimonialId || !name) {
      return res.status(400).json({ error: "Missing required fields: token, testimonialId, or name" });
    }

    // Check if testimonial exists
    const { data: testimonial, error: testimonialError } = await supabase
      .from("testimonial")
      .select("id")
      .eq("access_token", token)
      .single();

    if (testimonialError || !testimonial) {
      return res.status(404).json({ error: "Testimonial not found with the provided token" });
    }

    // Fetch related testimonial_responses
    const { data: responses, error: responsesError } = await supabase
      .from("testimonial_responses")
      .select("id, question_id")
      .eq("testimonial_id", testimonial.id);

    if (responsesError || !responses || responses.length === 0) {
      return res.status(404).json({ error: "No testimonial responses found for this testimonial" });
    }

    // Normalize incoming questionIds from frontend
    const incomingQuestionIds = req.body.questionIds;

    // If only one video uploaded, req.body.questionIds will not be an array
    const questionIdsArray = Array.isArray(incomingQuestionIds)
      ? incomingQuestionIds
      : [incomingQuestionIds];

    if (questionIdsArray.length !== req.files.length) {
      return res.status(400).json({ error: "Mismatch between number of videos and question IDs" });
    }

    const publicUrls = [];

    // For each uploaded video, find the matching testimonial_response by question_id
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const incomingQuestionId = questionIdsArray[i];

      // Find the matching testimonial_response
      const matchingResponse = responses.find(r => r.question_id === incomingQuestionId);

      if (!matchingResponse) {
        console.error(`No testimonial_response found for question_id: ${incomingQuestionId}`);
        return res.status(400).json({ error: `Invalid question ID: ${incomingQuestionId}` });
      }

      const filePath = `testimonial_videos/${testimonial.id}_${matchingResponse.id}.webm`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return res.status(500).json({ error: "Failed to upload video" });
      }

      // Generate public URL
      const { data: publicUrlData } = supabase
        .storage
        .from("videos")
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData.publicUrl;
      publicUrls.push(publicUrl);

      // Update testimonial_response with the video_url
      const { error: updateError } = await supabase
        .from("testimonial_responses")
        .update({ video_url: publicUrl })
        .eq("id", matchingResponse.id);

      if (updateError) {
        console.error("Update response error:", updateError);
        return res.status(500).json({ error: "Failed to update testimonial response" });
      }
    }

    const { error: updateTestimonialError } = await supabase
        .from("testimonial")
        .update({ status: "completed" })
        .eq("id", testimonial.id);

      if (updateTestimonialError) {
        console.error("Update testimonial response error:", updateError);
        return res.status(500).json({ error: "Failed to update testimonial status" });
      }

    return res.status(200).json({
      message: "Videos uploaded and mapped to correct questions successfully",
      videoUrls: publicUrls
    });

  } catch (error) {
    console.error("❌ DEBUG: Server error:", error);
    res.status(500).json({
      error: "Server error",
      message: error.message,
      stack: error.stack
    });
  }
});


module.exports = router;