// routes/testimonial.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { sendTestimonialRequest, sendReminderEmail, sendTestTestimonialRequest } = require('../services/mailgun');
const auth = require('../middleware/auth');
const fs = require("fs");
const path = require("path");
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const uploadDir = path.join(__dirname, "uploads");

/**
 * Create a new testimonial request
 * POST /api/testimonials/request
 */
router.post('/request', auth, async (req, res) => {
  try {
    const {
      customer_email,
      customer_name,
      customer_position,
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
        customer_name,
        customer_position,
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
      .in('id', question_ids)
      .order('order_position', { ascending: true })
      .order('created_at', { ascending: true });

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
      .order('created_at', { ascending: false }); 
    
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

router.get('/stats', auth, async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const [userRes, questionRes, testimonialRes, pendingTestimonial, completedRes] = await Promise.all([
      supabase.from('user').select('*', { count: 'exact' }).eq('company_id', company_id),
      supabase.from('question').select('*', { count: 'exact' }).eq('company_id', company_id),
      supabase.from('testimonial').select('*', { count: 'exact' }).eq('company_id', company_id),
      supabase.from('testimonial').select('*', { count: 'exact' }).eq('company_id', company_id).eq('status', 'pending'),
      supabase.from('testimonial').select('*', { count: 'exact' }).eq('company_id', company_id).eq('status', 'completed'),
    ]);

    if (userRes.error || questionRes.error || testimonialRes.error || completedRes.error) {
      console.error('Error fetching stats:', userRes.error || questionRes.error || testimonialRes.error || completedRes.error);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }

    return res.json({
      users: userRes.count || 0,
      questions: questionRes.count || 0,
      testimonials: testimonialRes.count || 0,
      completed: completedRes.count || 0,
      requested: pendingTestimonial.count || 0,
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    return res.status(500).json({ error: 'Server error while fetching stats' });
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

    testimonial.testimonial_responses.sort((a, b) => {
      return a.question?.order_position - b.question?.order_position;
    });
    
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

/**
 * Merge all videos for a testimonial
 * POST /api/testimonials/:id/merge
 */

function sanitizeDrawText(text = '') {
  // First create a safe version for FFmpeg
  let safeText = text
    .replace(/\\/g, '')                // Remove backslashes
    .replace(/'/g, "\u2019")           // Replace single quotes with Unicode right single quotation mark
    .replace(/"/g, "\u201D")           // Replace double quotes with Unicode right double quotation mark
    .replace(/:/g, ' -')               // Replace colons with spaces and dashes
    .replace(/;/g, ' ')                // Replace semicolons with spaces
    .replace(/\[/g, '(')               // Replace brackets with parentheses
    .replace(/\]/g, ')');              // Replace brackets with parentheses
  
  return safeText;
}

router.post('/:id/merge', auth, async (req, res) => {
  try {
    console.log(`------ Merging videos for testimonial ${req.params.id} ------`);
    const { id } = req.params;
    const company_id = req.user.company_id;

    // 1. Get the testimonial record from DB
    const { data: testimonial, error: testimonialError } = await supabase
      .from('testimonial')
      .select('id, customer_name, customer_position, company_id')
      .eq('id', id)
      .eq('company_id', company_id)
      .single();

    if (testimonialError || !testimonial) {
      console.error('Error fetching testimonial:', testimonialError);
      return res.status(404).json({ error: 'Testimonial not found' });
    }

    // 2. Get all testimonial_responses linked to that testimonial
    const { data: responses, error: responsesError } = await supabase
      .from('testimonial_responses')
      .select(`id, video_url, question_id, question:question_id (id, text)`)
      .eq('testimonial_id', id)

    if (responsesError) {
      console.error('Error fetching testimonial responses:', responsesError);
      return res.status(500).json({ error: 'Failed to fetch testimonial responses' });
    }

    if (!responses || responses.length === 0) {
      return res.status(400).json({ error: 'No video responses found for this testimonial' });
    }

    console.log(`Found ${responses.length} video responses to merge`);

    const downloadedVideos = [];
    for (const response of responses) {
      if (!response.video_url) continue;

      try {
        const videoUrlPath = new URL(response.video_url).pathname;
        const pathWithoutPrefix = videoUrlPath.replace('/storage/v1/object/public/videos/', '');
        const { data: fileData, error: downloadError } = await supabase
          .storage
          .from('videos')
          .download(pathWithoutPrefix);

        if (downloadError || !fileData) {
          console.error(`Failed to download video ${pathWithoutPrefix}:`, downloadError || 'File not found');
          continue;
        }

        const originalPath = path.join(uploadDir, path.basename(pathWithoutPrefix));
        fs.writeFileSync(originalPath, Buffer.from(await fileData.arrayBuffer()));

        const mp4Path = originalPath.replace(/\.webm$/, '.mp4');
        const ffmpegCommandConvert = `ffmpeg -y -i "${originalPath}" -c:v libx264 -preset ultrafast -c:a aac -b:a 128k -ac 2 -ar 44100 -vf "scale='if(gt(a,16/9),1280,-2)':'if(gt(a,16/9),-2,720)',pad=1280:720:(ow-iw)/2:(oh-ih)/2" "${mp4Path}"`;
        await execPromise(ffmpegCommandConvert);
        fs.unlinkSync(originalPath);

        downloadedVideos.push({
          path: mp4Path,
          questionId: response.question_id,
          questionText: response.question.text
        });

      } catch (error) {
        console.error(`Error processing video from URL ${response.video_url}:`, error);
      }
    }

    if (downloadedVideos.length === 0) {
      return res.status(400).json({ error: 'Failed to download any videos for processing' });
    }

    console.log(`Successfully downloaded ${downloadedVideos.length} videos`);

    // 4. Create Intro
    const introPath = path.join(uploadDir, `intro_${id}_${Date.now()}.mp4`);
    const nameText = sanitizeDrawText(testimonial.customer_name || '');
    const positionText = sanitizeDrawText(testimonial.customer_position || '');

    console.log(`Creating intro with name: "${nameText}", position: "${positionText}"`);

    const ffmpegCommandIntro = `ffmpeg -y \
      -f lavfi -i color=c=black:s=1280x720:d=4 \
      -f lavfi -t 4 -i anullsrc=channel_layout=stereo:sample_rate=44100 \
      -filter_complex "[0:v]drawtext=text='${nameText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-30, \
      drawtext=text='${positionText}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+30,trim=duration=4,setpts=PTS-STARTPTS[v]; \
      [1:a]atrim=duration=4,asetpts=PTS-STARTPTS[a]" \
      -map "[v]" -map "[a]" \
      -c:v libx264 -preset ultrafast -r 30 -pix_fmt yuv420p \
      -c:a aac -ar 44100 -b:a 128k \
      -shortest "${introPath}"`;

    await execPromise(ffmpegCommandIntro);
    console.log('Intro video created successfully');

    // 5. Create Question title slides
    const segments = [introPath];

    for (const video of downloadedVideos) {
      const questionPath = path.join(uploadDir, `question_${video.questionId}_${Date.now()}.mp4`);
      const safeQuestion = sanitizeDrawText(video.questionText);
      console.log("safe question: " + safeQuestion);
      
      const ffmpegCommandQuestion = `ffmpeg -y \
  -f lavfi -i "color=c=black:s=1280x720:d=3" \
  -f lavfi -t 3 -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  -vf "drawtext=text='${safeQuestion}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=5, \
       trim=duration=3,setpts=PTS-STARTPTS" \
  -af "atrim=duration=3,asetpts=PTS-STARTPTS" \
  -c:v libx264 -preset ultrafast -r 30 -pix_fmt yuv420p \
  -c:a aac -ar 44100 -b:a 128k \
  -shortest "${questionPath}"`;

      await execPromise(ffmpegCommandQuestion);
      console.log(`Created question title for: "${video.questionText}"`);

      segments.push(questionPath);
      segments.push(video.path);
    }

    // 6. Merge videos
    const concatListPath = path.join(uploadDir, `concat_list_${id}_${Date.now()}.txt`);
    const concatListContent = segments.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(concatListPath, concatListContent);

    const mergedFileName = `testimonial_${id}_${Date.now()}.mp4`;
    const mergedPath = path.join(uploadDir, mergedFileName);

    const ffmpegCommandMerge = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset medium -c:a aac -b:a 128k "${mergedPath}"`;
    await execPromise(ffmpegCommandMerge);

    console.log('Successfully merged all videos');

    // 7. Upload merged video
    const fileBuffer = fs.readFileSync(mergedPath);
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('videos')
      .upload(`merged_testimonials/${mergedFileName}`, fileBuffer, { contentType: 'video/mp4', upsert: true });

    if (uploadError) {
      console.error('Error uploading merged video:', uploadError);
      return res.status(500).json({ error: 'Failed to upload merged video' });
    }

    const { data: publicUrlData } = supabase
      .storage
      .from('videos')
      .getPublicUrl(`merged_testimonials/${mergedFileName}`);

    const mergedVideoUrl = publicUrlData.publicUrl;

    // 8. Update DB
    const { error: updateError } = await supabase
      .from('testimonial')
      .update({ video_url: mergedVideoUrl, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating testimonial:', updateError);
    }

    // 9. Clean up
    [introPath, concatListPath, mergedPath, ...segments.filter(f => f.includes('question_')), ...downloadedVideos.map(v => v.path)].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    return res.json({ mergedVideoUrl, message: 'Videos merged successfully', videosIncluded: downloadedVideos.length });

  } catch (error) {
    console.error('Error merging testimonial videos:', error);
    return res.status(500).json({ error: 'Server error processing testimonial videos', message: error.message });
  }
});


router.post('/response/:id/generate-intro', auth, async (req, res) => {
  try {
    console.log(`------ Generating video with question intro for response ${req.params.id} ------`);
    const { id } = req.params;
    const company_id = req.user.company_id;

    // 1. Get the testimonial_response record from DB with its related question
    const { data: response, error: responseError } = await supabase
      .from('testimonial_responses')
      .select(`
        id,
        video_url,
        testimonial_id,
        question_id,
        question:question_id (id, text)
      `)
      .eq('id', id)
      .single();

    if (responseError || !response) {
      console.error('Error fetching testimonial response:', responseError);
      return res.status(404).json({ error: 'Testimonial response not found' });
    }

    // 2. Get the parent testimonial to check if it belongs to the user's company
    const { data: testimonial, error: testimonialError } = await supabase
      .from('testimonial')
      .select('id, company_id')
      .eq('id', response.testimonial_id)
      .single();

    if (testimonialError || !testimonial) {
      console.error('Error fetching parent testimonial:', testimonialError);
      return res.status(404).json({ error: 'Parent testimonial not found' });
    }

    // Security check - ensure testimonial belongs to user's company
    if (testimonial.company_id !== company_id) {
      return res.status(403).json({ error: 'Unauthorized access to this testimonial' });
    }

    if (!response.video_url) {
      return res.status(400).json({ error: 'No video available for this response' });
    }

    if (!response.question || !response.question.text) {
      return res.status(400).json({ error: 'No question text available for this response' });
    }

    // 3. Download the original video from Supabase Storage
    try {
      const videoUrlPath = new URL(response.video_url).pathname;
      // Remove the prefix
      const pathWithoutPrefix = videoUrlPath.replace('/storage/v1/object/public/videos/', '');

      console.log(`Attempting download from storage path: ${pathWithoutPrefix}`);

      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from('videos')
        .download(pathWithoutPrefix);

      if (downloadError || !fileData) {
        console.error(`Failed to download video ${pathWithoutPrefix}:`, downloadError || 'File not found');
        return res.status(500).json({ error: 'Failed to download original video' });
      }

      console.log(`Successfully downloaded video file: ${pathWithoutPrefix}`);

      const originalPath = path.join(uploadDir, path.basename(pathWithoutPrefix));
      fs.writeFileSync(originalPath, Buffer.from(await fileData.arrayBuffer()));

      // Standard frame size for intro/title cards
      const frameWidth = 1280;
      const frameHeight = 720;

      // Prepare the output path
      const mp4Path = originalPath.replace(/\.webm$/, '.mp4');
      console.log(`Converting ${originalPath} to ${mp4Path} with correct aspect ratio`);

      // Preserve aspect ratio with padding (letterbox/pillarbox)
      const ffmpegCommandConvert = `ffmpeg -y -i "${originalPath}" \
      -c:v libx264 -preset ultrafast \
      -c:a aac -b:a 128k -ac 2 -ar 44100 \
      -vf "scale='if(gt(a,${frameWidth}/${frameHeight}),${frameWidth},-2)':'if(gt(a,${frameWidth}/${frameHeight}),-2,${frameHeight})',pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2" \
      "${mp4Path}"`;

      await execPromise(ffmpegCommandConvert);
      console.log(`Successfully converted video to MP4 format with preserved aspect ratio`);

      // Delete original file if it was webm
      if (originalPath.endsWith('.webm')) {
        fs.unlinkSync(originalPath);
      }

      // Use the converted mp4 path
      const videoPath = mp4Path;

      // 4. Generate question intro video
      const questionText = response.question.text;
      const questionPath = path.join(uploadDir, `question_${response.question_id}_${Date.now()}.mp4`);

      console.log(`Creating question intro with text: "${questionText}"`);
      const safeQuestion = sanitizeDrawText(questionText);
      console.log("safe question: " + safeQuestion);

      const ffmpegCommandQuestion = `ffmpeg -y \
  -f lavfi -i color=c=black:s=${frameWidth}x${frameHeight}:d=3 \
  -f lavfi -t 3 -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -vf "drawtext=text='${safeQuestion}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=5, \
       trim=duration=3,setpts=PTS-STARTPTS" \
  -af "atrim=duration=3,asetpts=PTS-STARTPTS" \
  -c:v libx264 -preset ultrafast -r 30 -pix_fmt yuv420p \
  -c:a aac -ar 44100 -b:a 128k \
  -shortest "${questionPath}"`;

      await execPromise(ffmpegCommandQuestion);
      console.log(`Created question intro for: "${questionText}"`);

      // 5. Concatenate the question intro with the original video
      const concatListPath = path.join(uploadDir, `concat_list_${id}_${Date.now()}.txt`);
      fs.writeFileSync(concatListPath, `file '${questionPath}'\nfile '${videoPath}'`);

      console.log(`Created concat list with question intro and video`);

      // 6. Merge the segments into final video
      const finalFileName = `response_with_intro_${id}_${Date.now()}.mp4`;
      const finalPath = path.join(uploadDir, finalFileName);
      
      const ffmpegCommandMerge = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset medium -c:a aac -b:a 128k "${finalPath}"`;
      await execPromise(ffmpegCommandMerge);
      
      console.log('Successfully merged question intro with video');

      // 7. Upload merged video to Supabase Storage
      const fileBuffer = fs.readFileSync(finalPath);
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from("videos")
        .upload(`responses_with_intro/${finalFileName}`, fileBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (uploadError) {
        console.error("Error uploading video with intro:", uploadError);
        return res.status(500).json({ error: "Failed to upload video with intro" });
      }

      console.log('Successfully uploaded video with intro to Supabase');

      // 8. Get public URL for the video with intro
      const { data: publicUrlData } = supabase
        .storage
        .from("videos")
        .getPublicUrl(`responses_with_intro/${finalFileName}`);

      const videoWithIntroUrl = publicUrlData.publicUrl;

      // 9. Update the testimonial_response with the new video_url and set intro_generated to true
      const { error: updateError } = await supabase
        .from('testimonial_responses')
        .update({
          intro_video_url: videoWithIntroUrl,
          intro_generated: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) {
        console.error('Error updating testimonial response with new video URL:', updateError);
        // Continue anyway since we have the URL
      } else {
        console.log('Updated testimonial response record with intro video URL');
      }

      // 10. Clean up temporary files
      console.log('Cleaning up temporary files');
      
      if (fs.existsSync(questionPath)) fs.unlinkSync(questionPath);
      if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);

      // 11. Return the public URL
      return res.json({ 
        video_url: videoWithIntroUrl,
        message: 'Video with question intro generated successfully'
      });

    } catch (error) {
      console.error(`Error processing video:`, error);
      return res.status(500).json({ error: 'Failed to process video' });
    }

  } catch (error) {
    console.error('Error generating video with question intro:', error);
    return res.status(500).json({ 
      error: 'Server error processing video', 
      message: error.message 
    });
  }
});

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