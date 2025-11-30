const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Serve static files (index.html, CSS, JS inside this folder)
app.use(express.static(__dirname));

// Helper: load existing results
const RESULTS_FILE = path.join(__dirname, 'results.json');

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) return [];
  try {
    const data = fs.readFileSync(RESULTS_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (e) {
    console.error('Error reading results.json:', e);
    return [];
  }
}

function saveResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
}

// API: save one result
app.post('/api/save-result', (req, res) => {
  const result = req.body;

  if (!result.studentName || !result.studentRoll || !result.chapterName) {
    return res.status(400).json({ ok: false, message: 'Invalid data' });
  }

  const results = loadResults();
  results.push(result);
  saveResults(results);

  res.json({ ok: true });
});

// API: get all results (for your admin panel)
app.get('/api/results', (req, res) => {
  const results = loadResults();
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
