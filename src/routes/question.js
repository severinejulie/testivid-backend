const express = require("express");
const supabase = require("../config/supabase");
const router = express.Router();
const { getFriendlySupabaseError } = require("../utils/supabaseErrorHandler");

router.get("/list", async (req, res) => {
    const { company_id } = req.query;

    if (!company_id) {
        return res.status(400).json({ error: "Missing Company Id" });
    }

    try {
        let { data: questionList, error: questionError } = await supabase
        .from("question")
        .select("*")
        .eq("company_id", company_id)
        .order("order_position", { ascending: true });

        if (questionError) {
          const friendlyMessage = getFriendlySupabaseError(questionError);
          return res.status(400).json({ error: "Question not found: " + friendlyMessage });
        }

        if (questionList && questionList.length > 0) {

        } else {
            questionList = [];
        }

        res.json(questionList);
    } catch (err) {
        console.error("Error processing list questions:", err);
        return res.status(500).json({ error: "Failed to list questions" });
    }
});

router.post("/add", async (req, res) => {
  const { company_id, text, order_position } = req.body;

  if (!company_id) {
      return res.status(400).json({ error: "Missing company Id" });
  }

  try {
      // Get the current max order_position for this company if not provided
      let position = order_position;
      if (!position) {
          const { data: maxPositionData, error: maxPositionError } = await supabase
              .from("question")
              .select("order_position")
              .eq("company_id", company_id)
              .order("order_position", { ascending: false })
              .limit(1);
              
          if (maxPositionError) {
              console.error("Error getting max position:", maxPositionError);
              return res.status(500).json({ error: "Failed to determine question position" });
          }
          
          // If there are existing questions, set position to max + 1, otherwise to 1
          position = maxPositionData.length > 0 ? (maxPositionData[0].order_position || 0) + 1 : 1;
      }
      
      // Insert the new question with order_position
      let { data: questionData, error: questionError } = await supabase
          .from("question")
          .insert([{ 
              company_id: company_id, 
              text: text,
              order_position: position
          }])    
          .select()
          .single();

      if (questionError) {
          const friendlyMessage = getFriendlySupabaseError(questionError);
          return res.status(400).json({ error: "Failed to add question: " + friendlyMessage });
      }

      res.json(questionData);
  } catch (err) {
      console.error("Error processing add question:", err);
      return res.status(500).json({ error: "Failed to add question" });
  }
});

router.post("/edit", async (req, res) => {
    const { id, company_id, text } = req.body;
  
    if (!id || !company_id || !text) {
      return res.status(400).json({ error: "Missing required fields" });
    }
  
    try {
      const { data: updatedQuestion, error: updateError } = await supabase
        .from("question")
        .update({ text: text })
        .eq("id", id)
        .eq("company_id", company_id)
        .select()
        .single();
  
      if (updateError) {
        const friendlyMessage = getFriendlySupabaseError(updateError);
        return res.status(400).json({ error: "Failed to update question: " + friendlyMessage });
      }
  
      res.json(updatedQuestion);
    } catch (err) {
      console.error("Error updating question:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/delete", async (req, res) => { 
    const { id, company_id } = req.body;
  
    if (!id || !company_id) { 
      return res.status(400).json({ error: "Missing required fields" });
    }
  
    try {
      const { data: deletedQuestion, error: deleteError } = await supabase
        .from("question")
        .delete()
        .eq("id", id)
        .eq("company_id", company_id)
        .select()
        .single();
  
      if (deleteError) {
        const friendlyMessage = getFriendlySupabaseError(deleteError);
        return res.status(400).json({ error: "Failed to delete question: " + friendlyMessage });
      }
  
      res.json({ message: "Question deleted", deletedQuestion });
    } catch (err) {
      console.error("Error deleting question:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/update-position", async (req, res) => {
  const { id, company_id, order_position } = req.body;

  if (!id || !company_id || order_position === undefined) {
    return res.status(400).json({ error: "Missing required fields: id, company_id, or order_position" });
  }

  try {
    const { data: questionData, error: questionError } = await supabase
      .from("question")
      .select("id, order_position")
      .eq("id", id)
      .eq("company_id", company_id)
      .single();

    if (questionError || !questionData) {
      return res.status(404).json({ error: "Question not found or does not belong to this company" });
    }

    const currentPosition = questionData.order_position;
    const newPosition = parseInt(order_position);

    if (currentPosition === newPosition) {
      return res.json({ success: true, message: "Question position unchanged" });
    }

    const { data: allQuestions, error: questionsError } = await supabase
      .from("question")
      .select("id, order_position")
      .eq("company_id", company_id)
      .order("order_position", { ascending: true });

    if (questionsError || !allQuestions) {
      return res.status(500).json({ error: "Failed to retrieve company questions" });
    }

    // Build updated list
    const reordered = [];

    allQuestions.forEach((question) => {
      if (question.id === id) {
        reordered.push({ id, order_position: newPosition });
      } else if (currentPosition < newPosition) {
        // Moving down
        if (question.order_position > currentPosition && question.order_position <= newPosition) {
          reordered.push({ id: question.id, order_position: question.order_position - 1 });
        }
      } else {
        // Moving up
        if (question.order_position >= newPosition && question.order_position < currentPosition) {
          reordered.push({ id: question.id, order_position: question.order_position + 1 });
        }
      }
    });

    // Apply each update individually using .update()
    for (const q of reordered) {
      const { error } = await supabase
        .from("question")
        .update({ order_position: q.order_position })
        .eq("id", q.id);

      if (error) {
        console.error("Error updating question:", q.id, error);
        return res.status(500).json({ error: "Failed to update some positions" });
      }
    }

    return res.json({
      success: true,
      message: "Question positions updated successfully",
      updatedCount: reordered.length,
    });

  } catch (err) {
    console.error("Error updating question positions:", err);
    return res.status(500).json({ error: "Failed to update question positions" });
  }
});

module.exports = router;