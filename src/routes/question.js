const express = require("express");
const supabase = require("../config/supabase");
const router = express.Router();

router.get("/list", async (req, res) => {
    const { company_id } = req.query;

    if (!company_id) {
        return res.status(400).json({ error: "Missing company_id" });
    }

    try {
        let { data: questionList, error: questionError } = await supabase
        .from("question")
        .select("*")
        .eq("company_id", company_id);

        if (questionError) {
            return res.status(400).json({ error: "Question not found: " + questionError.message });
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
    const { company_id, text } = req.body;

    if (!company_id) {
        return res.status(400).json({ error: "Missing company_id" });
    }

    try {
        let { data: questionData, error: questionError } = await supabase
        .from("question")
        .insert([{ company_id: company_id, text: text }])    
        .select()
        .single();

        if (questionError) {
            return res.status(400).json({ error: "Failed to add question: " + questionError.message });
        }

        res.json(questionData);
    } catch (err) {
        console.error("Error processing list questions:", err);
        return res.status(500).json({ error: "Failed to list questions" });
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
        return res.status(400).json({ error: "Failed to update question: " + updateError.message });
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
        return res.status(400).json({ error: "Failed to delete question: " + deleteError.message });
      }
  
      res.json({ message: "Question deleted", deletedQuestion });
    } catch (err) {
      console.error("Error deleting question:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
  
  
  

module.exports = router;