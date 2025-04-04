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

// Modified route for testimonial/merge endpoint with better debugging
router.post("/testimonial/merge", upload.array("videos"), async (req, res) => {
  try {
    console.log("------ DEBUG: Received testimonial/merge request ------");
    console.log("DEBUG: Files received:", req.files ? req.files.length : 0);
    console.log("DEBUG: Request body keys:", Object.keys(req.body));
    
    // Log all question IDs and other arrays
    const questionIds = [];
    const bgColors = [];
    
    // Extract arrays from request body
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('questionIds[')) {
        const index = key.match(/\[(\d+)\]/)[1];
        questionIds[index] = req.body[key];
      }
      if (key.startsWith('bgColors[')) {
        const index = key.match(/\[(\d+)\]/)[1];
        bgColors[index] = req.body[key];
      }
    });
    
    console.log("DEBUG: Extracted questionIds:", questionIds);
    console.log("DEBUG: Extracted bgColors:", bgColors);
    console.log("DEBUG: Files details:", req.files ? req.files.map(f => `${f.originalname}: ${f.size} bytes`) : 'No files');
    
    // Validate required fields
    if (
      !req.files ||
      req.files.length === 0 ||
      !req.body.name ||
      !req.body.testimonialId ||
      !req.body.token
    ) {
      console.error("DEBUG: Validation failed - missing required fields");
      return res.status(400).json({ 
        error: "Missing required fields: videos, name, testimonialId, or token",
        filesReceived: req.files ? req.files.length : 0,
        bodyReceived: Object.keys(req.body)
      });
    }

    // Process each video file (convert to MP4)
    const videoFiles = req.files;
    const convertedVideos = [];

    console.log(`DEBUG: Processing ${videoFiles.length} video files`);
    for (let i = 0; i < videoFiles.length; i++) {
      const videoFile = videoFiles[i];
      console.log(`DEBUG: Processing video ${i+1}: ${videoFile.originalname}, ${videoFile.size} bytes`);
      
      const webmPath = path.join(uploadDir, `video_${Date.now()}_${i}.webm`);
      fs.writeFileSync(webmPath, videoFile.buffer);
      const mp4Path = webmPath.replace(".webm", ".mp4");

      // Convert to MP4 with strict timestamp control
      const ffmpegCommandConvert = `ffmpeg -y -i "${webmPath}" -fflags +genpts -reset_timestamps 1 -c:v libx264 -preset ultrafast -vf "scale=1280:720,fps=30,setpts=PTS-STARTPTS" -c:a aac -b:a 128k -ar 44100 -af "asetpts=PTS-STARTPTS" "${mp4Path}"`;
      console.log(`DEBUG: Converting video ${i} with ffmpeg`);
      await execPromise(ffmpegCommandConvert);
      convertedVideos.push(mp4Path);
      fs.unlinkSync(webmPath); // Remove the webm file
      console.log(`DEBUG: Video ${i+1} converted successfully`);
    }

    // Generate Intro Video
    console.log("DEBUG: Generating intro video");
    const introPath = path.join(uploadDir, `intro_${Date.now()}.mp4`);
    const nameText = req.body.name;
    const titleText = req.body.title || '';

    const ffmpegCommandIntro = `ffmpeg -y \
      -f lavfi -i color=c=black:s=1280x720:d=4 \
      -f lavfi -t 4 -i anullsrc=channel_layout=stereo:sample_rate=44100 \
      -filter_complex "drawtext=text='${nameText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-30, \
      drawtext=text='${titleText}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+30, \
      trim=duration=4,setpts=PTS-STARTPTS[v]; \
      [1:a]atrim=duration=4,asetpts=PTS-STARTPTS[a]" \
      -map "[v]" -map "[a]" \
      -c:v libx264 -preset ultrafast -r 30 -pix_fmt yuv420p \
      -c:a aac -ar 44100 -b:a 128k \
      -shortest "${introPath}"`;

    await execPromise(ffmpegCommandIntro);
    console.log("DEBUG: Intro video generated successfully");

    // Create concat list file for merging all videos
    console.log("DEBUG: Creating concat list with intro + videos");
    const concatListPath = path.join(uploadDir, `concat_list_${Date.now()}.txt`);
    const concatListContent = [
      `file '${introPath}'`,
      ...convertedVideos.map((v) => `file '${v}'`),
    ].join("\n");
    fs.writeFileSync(concatListPath, concatListContent);
    console.log(`DEBUG: Concat list created with ${convertedVideos.length + 1} entries (intro + videos)`);

    // Merge videos ensuring sync
    console.log("DEBUG: Merging all videos");
    const mergedFile = `merged_${req.body.token}.mp4`;
    const mergedPath = path.join(uploadDir, mergedFile);
    const ffmpegCommandConcat = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset ultrafast -c:a aac -b:a 128k "${mergedPath}"`;
    await execPromise(ffmpegCommandConcat);
    console.log("DEBUG: Videos merged successfully");

    // Upload merged video to Supabase Storage
    console.log("DEBUG: Uploading to Supabase Storage");
    const fileBuffer = fs.readFileSync(mergedPath);
    const { data, error: uploadError } = await supabase
      .storage
      .from("videos")
      .upload(`merged_videos/${mergedFile}`, fileBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      console.error("DEBUG: Supabase Upload Error:", uploadError);
      return res.status(500).json({ error: "Failed to upload video to Supabase" });
    }
    console.log("DEBUG: Uploaded to Supabase successfully");

    // Get public URL for the merged video
    const { data: publicUrlData } = supabase
      .storage
      .from("videos")
      .getPublicUrl(`merged_videos/${mergedFile}`);

    // Cleanup temporary files
    console.log("DEBUG: Cleaning up temporary files");
    fs.unlinkSync(introPath);
    fs.unlinkSync(concatListPath);
    convertedVideos.forEach((v) => fs.unlinkSync(v));
    fs.unlinkSync(mergedPath);

    // Update testimonial status to completed
    // console.log("DEBUG: Updating testimonial status to completed");
    // const { error: updateError } = await supabase
    //   .from('testimonial')
    //   .update({
    //     status: 'completed',
    //     updated_at: new Date().toISOString()
    //   })
    //   .eq('id', req.body.testimonialId);
    
    // if (updateError) {
    //   console.error('DEBUG: Error updating testimonial status:', updateError);
    //   // Don't return error here, just log it
    // }

    console.log("DEBUG: Request processing completed successfully");
    res.json({ 
      mergedVideoUrl: publicUrlData.publicUrl,
      videosProcessed: req.files.length,
      questionIds: questionIds
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